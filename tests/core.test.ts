import { describe,it,expect,vi,afterEach } from 'vitest';
import { Filters, SearchInput, type Corpus, type Document, type Source } from '../packages/shared/src/index.js';
import { validateUrl, fetchOfficial, htmlText, decodeHtml, legislationChunks, judgmentChunks } from '../apps/api/src/sources.js';
import { Store } from '../apps/api/src/store.js';
import { fuse, validateAnswer, Research } from '../apps/api/src/research.js';
import { indexCorpus } from '../apps/api/src/ingestion.js';
import { createApp } from '../apps/api/src/app.js';
import { providerError } from '../apps/api/src/errors.js';
import { vectorFilter } from '../apps/api/src/vectors.js';
import { callTool } from '../apps/mcp/src/tools.js';
import type { AIProvider } from '../apps/api/src/gemini.js';

const entry={id:'cdc',title:'Código de Defesa do Consumidor',type:'legislacao' as const,url:'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm',authority:'Planalto' as const,format:'html' as const,topics:['arrependimento' as const],rationale:'Texto legal para pesquisa sobre arrependimento.'};
const chunks=legislationChunks(entry,'Art. 49. O consumidor pode desistir do contrato no prazo de sete dias.\nParágrafo único. Os valores pagos serão devolvidos.\nArt. 50. A garantia contratual é complementar à legal.');
const doc:Document={...entry,hash:'hash',collectedAt:'2026-10-13T12:00:00Z',finalUrl:entry.url,chunks};
const corpus:Corpus={version:'v_test',collectedAt:doc.collectedAt,activatedAt:doc.collectedAt,count:1,chunks:chunks.length,embeddingModel:null,dimensions:null,generationModel:'test',collection:null,coverage:{}};
const source:Source={...chunks[0],title:entry.title,url:entry.url,type:'legislacao',authority:'Planalto',collectedAt:doc.collectedAt,hash:'hash',score:1};
const validAnswer={status:'answered' as const,sections:{synthesis:[{text:'O texto prevê prazo de sete dias.',references:[source.id],quotations:[{sourceId:source.id,text:'no prazo de sete dias'}]}],legislation:[],jurisprudence:[]},limitations:['Pesquisa limitada ao acervo.']};
const ai:AIProvider={embed:vi.fn(async()=>[[1,0]]),generate:vi.fn(async()=>({answer:validAnswer,usage:{inputTokens:1,outputTokens:1}}))};
const stores:Store[]=[];function newStore(){const store=new Store(':memory:');stores.push(store);return store;}afterEach(()=>stores.splice(0).forEach(s=>s.close()));
describe('fontes e extração',()=>{
 it('decodifica Windows-1252 igualmente em macOS e Linux',()=>{expect(decodeHtml(Buffer.concat([Buffer.from('<meta charset="windows-1252">'),Buffer.from([0x93,0x96,0x94])]))).toBe('<meta charset="windows-1252">“–”');});
 it.each(['http://www.stj.jus.br/a','https://stj.jus.br.evil.test/a','https://127.0.0.1','https://user@www.stj.jus.br/a','https://www.stj.jus.br:8000/a','file:///etc/passwd'])('rejeita URL %s',url=>expect(()=>validateUrl(url)).toThrow());
 it('valida destino antes de seguir redirecionamento',async()=>{const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}}));await expect(fetchOfficial(entry,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);});
 it('rejeita redirecionamento de órgão diferente',()=>expect(()=>validateUrl('https://www.stj.jus.br/a','Planalto')).toThrow());
 it('remove texto revogado e mantém parágrafos e incisos',()=>{const text=htmlText('<p><strike>Art. 49. Texto antigo</strike></p><p>Art. 49. Vigente</p><p>§ 1º Primeiro</p><p>I - Inciso</p><p>Art. 50. Outro</p>');const result=legislationChunks(entry,text);expect(result).toHaveLength(2);expect(result[0].text).toContain('§ 1º');expect(result[0].text).toContain('I - Inciso');expect(result[0].text).not.toContain('antigo');});
 it('rejeita parsing sem dispositivos confiáveis',()=>expect(()=>legislationChunks(entry,'Página não disponível.')).toThrow());
 it('preserva localização no PDF',()=>{const result=judgmentChunks({...entry,type:'jurisprudencia'},[{num:3,text:'EMENTA\n'+('Trecho relevante sobre restituição ao consumidor. '.repeat(20))}]);expect(result[0].page).toBe(3);expect(result[0].location).toContain('Página 3');});
});
describe('persistência, versões e recuperação',()=>{
 it('reingestão não duplica e mantém versões anteriores',()=>{const s=newStore();s.activate(corpus,[doc]);s.activate(corpus,[doc]);expect(s.list().total).toBe(1);s.activate({...corpus,version:'v_next'},[{...doc,hash:'next'}]);expect(s.document('cdc','v_test')?.hash).toBe('hash');expect(s.document('cdc')?.hash).toBe('next');});
 it('falha durante indexação vetorial preserva versão ativa',async()=>{const s=newStore();s.activate(corpus,[doc]);await expect(indexCorpus(s,[{...doc,hash:'changed'}],ai,{create:async()=>{throw new Error('Indexação falhou');}})).rejects.toThrow('Indexação falhou');expect(s.corpus()?.version).toBe('v_test');});
 it('rollback de transação preserva documentos e índice',()=>{const s=newStore();s.activate(corpus,[doc]);expect(()=>s.activate({...corpus,version:'bad'},[doc,doc])).toThrow();expect(s.corpus()?.version).toBe('v_test');expect(s.db.prepare('SELECT 1 FROM versions WHERE id=?').get('bad')).toBeUndefined();});
 it('aplica filtros de tema, tipo e período',()=>{const s=newStore();const judgment:Document={...doc,id:'resp-test',type:'jurisprudencia',authority:'STJ',topics:['garantia'],publishedAt:'2020-01-01',chunks:doc.chunks.map(c=>({...c,id:`j-${c.id}`,documentId:'resp-test'}))};s.activate(corpus,[doc,judgment]);expect(s.search('sete dias',{},corpus.version)).toHaveLength(2);expect(s.search('sete dias',{topic:'garantia'},corpus.version)).toHaveLength(1);expect(s.search('sete dias',{publishedFrom:'2021-01-01'},corpus.version).map(s=>s.type)).toEqual(['legislacao']);expect(s.search('sete dias',{type:'jurisprudencia',publishedTo:'2019-01-01'},corpus.version)).toEqual([]);});
 it('mesmas regras de data vetorial e textual preservam legislação',()=>{expect(vectorFilter({publishedFrom:'2021-01-01'}).must).toEqual([{should:[{key:'type',match:{value:'legislacao'}},{must:[{key:'type',match:{value:'jurisprudencia'}},{key:'publishedAt',range:{gte:Date.parse('2021-01-01')}}]}]}]);});
 it('fusão elimina duplicação e combina ranking',()=>{const another={...source,id:'other'};const result=fuse([[source,another],[source]],10);expect(result).toHaveLength(2);expect(result[0].id).toBe(source.id);expect(result[0].score).toBeCloseTo(2/61);});
});
describe('respostas e API/MCP',()=>{
 it('aceita referências e citações conferíveis',()=>expect(validateAnswer(validAnswer,[source]).status).toBe('answered'));
 it.each(['legislation','jurisprudence'] as const)('rejeita fonte incompatível em %s, inclusive referências mistas',section=>{
   const judgment:Source={...source,id:'judgment',type:'jurisprudencia'};
   const answer=structuredClone(validAnswer);
   answer.sections[section]=[{text:'Conclusão mista.',references:[source.id,judgment.id],quotations:[]}];
   expect(()=>validateAnswer(answer,[source,judgment])).toThrow('Tipo de fonte incompatível');
 });
 it('aceita síntese que combina legislação e jurisprudência',()=>{
   const judgment:Source={...source,id:'judgment',type:'jurisprudencia'};
   const answer=structuredClone(validAnswer);
   answer.sections.synthesis[0].references.push(judgment.id);
   expect(validateAnswer(answer,[source,judgment]).status).toBe('answered');
 });
 it('rejeita referência inventada',()=>{const a=structuredClone(validAnswer);a.sections.synthesis[0].references=['inventada'];expect(()=>validateAnswer(a,[source])).toThrow('referência');});
 it('rejeita transcrição adulterada',()=>{const a=structuredClone(validAnswer);a.sections.synthesis[0].quotations[0].text='prazo de trinta dias';expect(()=>validateAnswer(a,[source])).toThrow('literal');});
 it('insuficiência não pode incluir conclusões',()=>expect(()=>validateAnswer({...validAnswer,status:'insufficient_evidence'},[source])).toThrow());
 it.each([401,403,429,504,500])('diferencia falha Gemini %s',status=>expect(providerError({status}).code).toBe({401:'PROVIDER_AUTH',403:'PROVIDER_AUTH',429:'PROVIDER_QUOTA',504:'PROVIDER_TIMEOUT',500:'PROVIDER_UNAVAILABLE'}[status]));
 it('datas reais e intervalos válidos',()=>{expect(Filters.safeParse({publishedFrom:'2026-02-31'}).success).toBe(false);expect(Filters.safeParse({publishedFrom:'2026-01-02',publishedTo:'2026-01-01'}).success).toBe(false);});
 it('API e MCP retornam a mesma busca, sem rede',async()=>{const store=newStore();store.activate(corpus,[doc]);const app=createApp(new Research(store,ai,{search:async()=>[]}),false);const input=SearchInput.parse({question:'prazo de sete dias',filters:{type:'legislacao'}});const direct=await app.inject({method:'POST',url:'/api/search',payload:input});const fetcher:typeof fetch=async(url,init)=>{const path=new URL(String(url)).pathname;const r=await app.inject({method:(init?.method??'GET') as 'POST'|'GET',url:path,payload:init?.body as string,headers:{'content-type':'application/json'}});return new Response(r.body,{status:r.statusCode,headers:{'Content-Type':'application/json'}});};const mcp=await callTool('buscar_legislacao',input,'http://localhost:3001',fetcher);expect(mcp).toEqual(direct.json());await app.close();});
 it('rejeita pergunta inválida e trata ausência de evidências sem gerar',async()=>{const store=newStore();const generate=vi.fn(ai.generate);const app=createApp(new Research(store,{...ai,generate},{search:async()=>[]}),false);const bad=await app.inject({method:'POST',url:'/api/research',payload:{question:'oi'}});expect(bad.statusCode).toBe(400);const empty=await app.inject({method:'POST',url:'/api/research',payload:{question:'Regras de tributação municipal?'}});expect(empty.json().status).toBe('insufficient_evidence');expect(generate).not.toHaveBeenCalled();await app.close();});
});
