import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { Agent } from 'undici';
import type { Chunk, Document, ManifestEntry } from '@consumidor/shared';
import { AppError } from './errors.js';

const officialHosts = new Set(['www.planalto.gov.br','planalto.gov.br','www.stj.jus.br','stj.jus.br','scon.stj.jus.br','processo.stj.jus.br']);
export function validateUrl(value:string, authority?:ManifestEntry['authority']):URL {
  let url:URL;
  try { url = new URL(value); } catch { throw new AppError('SOURCE_FORBIDDEN','URL inválida',400); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !officialHosts.has(url.hostname))
    throw new AppError('SOURCE_FORBIDDEN',`Fonte não permitida: ${url.hostname}`,400);
  if (authority === 'Planalto' && !['www.planalto.gov.br','planalto.gov.br'].includes(url.hostname)) throw new AppError('SOURCE_FORBIDDEN','Redirecionamento para órgão diferente.',400);
  if (authority === 'STJ' && !url.hostname.endsWith('stj.jus.br')) throw new AppError('SOURCE_FORBIDDEN','Redirecionamento para órgão diferente.',400);
  return url;
}
const planaltoAgent=new Agent({connect:{maxVersion:'TLSv1.2'}});
const officialFetch:typeof fetch=(url,init)=>fetch(url,{...init,...(new URL(String(url)).hostname.endsWith('planalto.gov.br')?{dispatcher:planaltoAgent}:{})} as RequestInit);
export async function fetchOfficial(entry:ManifestEntry, fetcher:typeof fetch=officialFetch):Promise<{bytes:Buffer;finalUrl:string}> {
  let url = validateUrl(entry.url,entry.authority);
  for (let redirects=0; redirects<=5; redirects++) {
    const response = await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(45000),headers:{'User-Agent':'Mozilla/5.0 (compatible; consumidor-rag-mcp/0.1; pesquisa em fontes oficiais)','Accept':'text/html,application/pdf','Connection':'close'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new AppError('SOURCE_REDIRECT','Redirecionamento sem destino.');
      url = validateUrl(new URL(next,url).href,entry.authority); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new AppError('SOURCE_HTTP',`${entry.id}: HTTP ${response.status}`); }
    const mime = response.headers.get('content-type') ?? '';
    if (entry.format === 'pdf' && !mime.includes('pdf')) throw new AppError('SOURCE_FORMAT','O servidor não retornou PDF.');
    if (entry.format === 'html' && !mime.includes('html')) throw new AppError('SOURCE_FORMAT','O servidor não retornou HTML.');
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('SOURCE_EMPTY','Documento vazio.');
    const parts:Uint8Array[]=[]; let total=0;
    try {
      while (true) { const {done,value} = await reader.read(); if (done) break; total += value.byteLength;
        if (total>20*1024*1024) throw new AppError('SOURCE_SIZE','Documento excede 20 MB.'); parts.push(value); }
    } finally { await reader.cancel(); }
    return {bytes:Buffer.concat(parts),finalUrl:url.href};
  }
  throw new AppError('SOURCE_REDIRECT','Limite de redirecionamentos excedido.');
}
export const hash = (bytes:Buffer|string) => createHash('sha256').update(bytes).digest('hex');
export function decodeHtml(bytes:Buffer):string {
  const hint = bytes.subarray(0,4000).toString('latin1');
  const encoding = /charset\s*=\s*["']?\s*(windows-1252|iso-8859-1)/i.test(hint) ? 'windows-1252' : 'utf-8';
  // Decode Windows-1252 deterministically, independently of the host ICU build.
  const c1=['€','\u0081','‚','ƒ','„','…','†','‡','ˆ','‰','Š','‹','Œ','\u008d','Ž','\u008f','\u0090','‘','’','“','”','•','–','—','˜','™','š','›','œ','\u009d','ž','Ÿ'];
  const western=()=>bytes.toString('latin1').replace(/[\u0080-\u009f]/g,char=>c1[char.charCodeAt(0)-128]);
  if(encoding==='windows-1252')return western();
  const utf8=bytes.toString('utf8');return utf8.includes('\uFFFD')?western():utf8;
}
export function htmlText(html:string):string {
  const $=load(html); $('script,style,nav,header,footer,s,strike,del').remove();
  $('br').replaceWith('\n'); $('p,div,tr,h1,h2,h3,h4').each((_,el)=>{$(el).append('\n');});
  return $('body').text().replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function legislationChunks(entry:ManifestEntry,text:string):Chunk[] {
  const boundaries = [...text.matchAll(/(?:^|\n)\s*Art\.?\s*(\d+[A-Z]?(?:-[A-Z])?)[ºo°.]?\s*[.\-–]?/g)];
  if (boundaries.length<2) throw new AppError('PARSING_FAILED',`${entry.id}: artigos não identificados.`);
  const chunks:Chunk[]=[]; const seen=new Set<string>();
  for (let i=0;i<boundaries.length;i++) {
    const match=boundaries[i]; const article=match[1];
    let body = text.slice(match.index!,boundaries[i+1]?.index ?? text.length).trim();
    body = body.split(/\n(?:Brasília|Este texto não substitui)/i)[0].trim();
    if (seen.has(article)) throw new AppError('PARSING_FAILED',`Artigo duplicado ${article}: revisão necessária.`);
    seen.add(article);
    if (body.length>18000) throw new AppError('PARSING_FAILED',`Artigo ${article} excede orçamento; revisar parser.`);
    chunks.push({id:`${entry.id}-art-${article.toLowerCase()}`,documentId:entry.id,text:body,location:`Art. ${article}`,topics:entry.topics});
  }
  return chunks;
}
export function judgmentChunks(entry:ManifestEntry,pages:{text:string;num:number}[]):Chunk[] {
  const chunks:Chunk[]=[];
  for (const page of pages) {
    const clean = page.text.replace(/Documento:[^\n]*|Página\s+\d+\s+de\s+\d+/gi,'').trim();
    for (const paragraph of clean.split(/\n\s*\n/)) {
      if (paragraph.trim().length<60) continue;
      // Long PDF paragraphs are split at sentence boundaries; each segment retains its page.
      const sentences=paragraph.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [paragraph];
      let group='';
      const push=()=>{ if (group.trim()) {const n=chunks.length+1; chunks.push({id:`${entry.id}-p${page.num}-${n}`,documentId:entry.id,text:group.trim(),location:`Página ${page.num}, trecho ${n}`,page:page.num,topics:entry.topics}); group='';} };
      for (const sentence of sentences) { if (group.length+sentence.length>3500) push();
        if (sentence.length>5000) { for(let i=0;i<sentence.length;i+=3500){group=sentence.slice(i,i+3500);push();} } else group+=sentence; }
      push();
    }
  }
  if (chunks.length===0) throw new AppError('PARSING_FAILED',`${entry.id}: texto insuficiente.`);
  return chunks;
}
export async function normalize(entry:ManifestEntry,bytes:Buffer,finalUrl:string,collectedAt:string):Promise<Document> {
  validateUrl(finalUrl,entry.authority);
  let chunks:Chunk[];
  if (entry.format === 'pdf') {
    const parser=new PDFParse({data:bytes});
    try { const result=await parser.getText();
      if(result.text.length<300 || result.pages.some(p => p.text.trim().length<30)) throw new AppError('PARSING_FAILED','PDF sem texto digital confiável.');
      chunks=judgmentChunks(entry,result.pages);
    } finally {await parser.destroy();}
  } else {
    const text=htmlText(decodeHtml(bytes));
    if (/captcha|access denied|just a moment|acesso negado/i.test(text.slice(0,1500))) throw new AppError('PARSING_FAILED','Página de bloqueio recebida.');
    chunks=entry.type==='legislacao' ? legislationChunks(entry,text) : judgmentChunks(entry,[{text,num:1}]).map(c=>({...c,page:undefined,location:c.location.replace('Página 1, ','HTML, ')}));
  }
  if (entry.type === 'jurisprudencia' && entry.process) {
    const digits=entry.process.replace(/\D/g,'');
    const found=chunks.some(c=>c.text.replace(/\D/g,'').includes(digits));
    if (!found) throw new AppError('PARSING_FAILED',`Processo ${entry.process} não confirmado no texto.`);
  }
  return {...entry,hash:hash(bytes),collectedAt,finalUrl,chunks};
}
