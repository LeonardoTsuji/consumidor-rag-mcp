import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Manifest, topics, type Corpus, type Document } from '@consumidor/shared';
import { fetchOfficial, hash, normalize, validateUrl } from './sources.js';
import { config } from './config.js';
import type { Store } from './store.js';
import type { AIProvider } from './gemini.js';
import type { Vectors } from './vectors.js';
import { AppError } from './errors.js';
export function validateManifest(value:unknown,requireCoverage=true):Manifest {
  const manifest=Manifest.parse(value);const ids=new Set<string>();const urls=new Set<string>();const processes=new Set<string>();
  for(const entry of manifest.documents){validateUrl(entry.url,entry.authority);if(entry.qualifiedPrecedent)validateUrl(entry.qualifiedPrecedent.officialUrl,'STJ');
    if(ids.has(entry.id)||urls.has(entry.url))throw new AppError('MANIFEST_INVALID','IDs ou URLs duplicados.');ids.add(entry.id);urls.add(entry.url);
    if(entry.process){if(processes.has(entry.process))throw new AppError('MANIFEST_INVALID','Acórdãos duplicados.');processes.add(entry.process);}
  }
  if(requireCoverage){const judgments=manifest.documents.filter(d=>d.type==='jurisprudencia');
    if(judgments.length<15||topics.some(t=>judgments.filter(d=>d.topics.includes(t)).length<3))throw new AppError('MANIFEST_COVERAGE','Acervo exige 15 acórdãos distintos e três por tema.');}
  return manifest;
}
export async function collect(manifest:Manifest,directory:string):Promise<Document[]> {
  await mkdir(directory,{recursive:true});const documents:Document[]=[];const report:{id:string;status:string;message?:string}[]=[];
  for(const entry of manifest.documents){
    try {const {bytes,finalUrl}=await fetchOfficial(entry);const collectedAt=new Date().toISOString();
      const document=await normalize(entry,bytes,finalUrl,collectedAt);documents.push(document);
      await writeFile(join(directory,`${entry.id}.${entry.format}`),bytes,{flag:'wx'});
      report.push({id:entry.id,status:'collected'});
    }catch(e){report.push({id:entry.id,status:'failed',message:e instanceof Error?e.message:'Falha de coleta'});}
  }
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
  if(documents.length!==manifest.documents.length)throw new AppError('COLLECTION_FAILED',`Coleta incompleta. Consulte ${join(directory,'report.json')}`);
  await writeFile(join(directory,'documents.json'),JSON.stringify(documents,null,2));
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  return documents;
}
export async function loadSnapshot(directory:string,requireCoverage=true):Promise<Document[]> {
  const manifest=validateManifest(JSON.parse(await readFile(join(directory,'manifest.json'),'utf-8')),requireCoverage);
  const recorded=JSON.parse(await readFile(join(directory,'documents.json'),'utf-8')) as Document[];
  if(!Array.isArray(recorded)||recorded.length!==manifest.documents.length)throw new AppError('SNAPSHOT_INVALID','Quantidade de documentos diverge do manifesto.');
  const result:Document[]=[];
  for(const entry of manifest.documents){const d=recorded.find(d=>d.id===entry.id);if(!d)throw new AppError('SNAPSHOT_INVALID',`Documento ausente: ${entry.id}`);
    const bytes=await readFile(join(directory,`${entry.id}.${entry.format}`));
    if(hash(bytes)!==d.hash)throw new AppError('SNAPSHOT_INVALID',`Hash inválido: ${entry.id}`);
    if(!d.collectedAt||Number.isNaN(Date.parse(d.collectedAt)))throw new AppError('SNAPSHOT_INVALID','Data de coleta inválida.');
    const normalized=await normalize(entry,bytes,d.finalUrl,d.collectedAt);
    if(JSON.stringify(normalized)!==JSON.stringify(d))throw new AppError('SNAPSHOT_INVALID',`Texto normalizado divergente: ${entry.id}`);
    result.push(normalized);
  }
  return result;
}
export async function indexCorpus(store:Store,documents:Document[],ai:AIProvider,vectors:Pick<Vectors,'create'>,textOnly=false):Promise<{corpus:Corpus;changes:{id:string;change:string}[]}> {
  const fingerprint=hash(JSON.stringify({documents:documents.map(d=>({id:d.id,hash:d.hash,chunks:d.chunks,metadata:{...d,collectedAt:undefined,chunks:undefined}})),embeddingModel:textOnly?null:config.EMBEDDING_MODEL,dimensions:textOnly?null:config.EMBEDDING_DIMENSIONS})).slice(0,24);
  const version=`v_${fingerprint}`;const previous=store.corpus();
  const changes=documents.map(d=>{const old=previous?store.document(d.id,previous.version):null;return {id:d.id,change:!old?'added':old.hash===d.hash?'unchanged':'changed'};});
  if(previous){for(const old of store.list({},1,100,previous.version).documents)if(!documents.some(d=>d.id===old.id))changes.push({id:old.id,change:'removed'});}
  const existing=store.db.prepare('SELECT metadata FROM versions WHERE id=?').get(version) as {metadata:string}|undefined;
  if(existing){const corpus=JSON.parse(existing.metadata) as Corpus;store.activate(corpus,[]);return {corpus,changes};}
  const collection=textOnly?null:`consumidor_${fingerprint}_${randomUUID().replaceAll('-','').slice(0,8)}`;
  // Index vectors first. No failure before the SQLite transaction can change the active version.
  if(collection)await vectors.create(collection,documents,ai);
  const corpus:Corpus={version,collectedAt:documents.map(d=>d.collectedAt).sort()[0],activatedAt:new Date().toISOString(),count:documents.length,chunks:documents.reduce((n,d)=>n+d.chunks.length,0),embeddingModel:textOnly?null:config.EMBEDDING_MODEL,dimensions:textOnly?null:config.EMBEDDING_DIMENSIONS,generationModel:config.GEMINI_MODEL,collection,coverage:Object.fromEntries(topics.map(t=>[t,documents.filter(d=>d.type==='jurisprudencia'&&d.topics.includes(t)).length]))};
  store.activate(corpus,documents);return {corpus,changes};
}
