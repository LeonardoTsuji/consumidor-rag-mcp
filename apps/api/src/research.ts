import { GeneratedAnswer, type ResearchResult, type SearchInput, type SearchResult, type Source } from '@consumidor/shared';
import type { Store } from './store.js';
import type { AIProvider } from './gemini.js';
import type { Vectors } from './vectors.js';
import { config } from './config.js';
import { AppError } from './errors.js';
export function fuse(lists:Source[][],limit:number):Source[] {
  const map=new Map<string,Source>();
  for(const list of lists)list.forEach((source,index)=>{const old=map.get(source.id);map.set(source.id,{...source,score:(old?.score??0)+1/(60+index+1)});});
  const sorted=[...map.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  // Cap total context and per-document dominance without modifying quoted text.
  const result:Source[]=[];let characters=0;const perDoc=new Map<string,number>();
  for(const source of sorted){if(result.length>=limit)break;if(characters+source.text.length>36000||(perDoc.get(source.documentId)??0)>=4)continue;result.push(source);characters+=source.text.length;perDoc.set(source.documentId,(perDoc.get(source.documentId)??0)+1);}
  return result;
}
const canonical=(s:string)=>s.normalize('NFC').replace(/\s+/g,' ').trim();
export function validateAnswer(value:unknown,sources:Source[]):GeneratedAnswer {
  const answer=GeneratedAnswer.parse(value);const byId=new Map(sources.map(s=>[s.id,s]));
  const all=Object.values(answer.sections).flat();
  if(answer.status==='insufficient_evidence'&&all.length)throw new AppError('INVALID_CITATION','Resposta insuficiente deve ter seções vazias.',502);
  if(answer.status==='answered'&&(!answer.sections.synthesis.length||!all.length))throw new AppError('INVALID_CITATION','Resposta fundamentada vazia.',502);
  for(const [section,claims] of Object.entries(answer.sections))for(const claim of claims){
    for(const id of claim.references){const source=byId.get(id);if(!source)throw new AppError('INVALID_CITATION','O modelo emitiu referência não recuperada.',502);
      if(section==='legislation'&&source.type!=='legislacao'||section==='jurisprudence'&&source.type!=='jurisprudencia')throw new AppError('INVALID_CITATION','Tipo de fonte incompatível com seção.',502);}
    for(const quotation of claim.quotations){const source=byId.get(quotation.sourceId);if(!source||!claim.references.includes(quotation.sourceId)||!canonical(source.text).includes(canonical(quotation.text)))throw new AppError('INVALID_CITATION','Citação literal não corresponde à fonte.',502);}
  }
  return answer;
}
export class Research {
  constructor(readonly store:Store,readonly ai:AIProvider,readonly vectors:Pick<Vectors,'search'>){}
  async search(input:SearchInput):Promise<SearchResult>{
    const corpus=this.store.corpus();if(!corpus)return {sources:[],corpus:null,mode:'textual',warnings:['Acervo ainda não indexado.']};
    const lexical=this.store.search(input.question,input.filters,corpus.version);let semantic:Source[]=[];const warnings:string[]=[];let mode:'textual'|'hybrid'='textual';
    if(corpus.collection&&config.GEMINI_API_KEY){
      if(corpus.embeddingModel!==config.EMBEDDING_MODEL||corpus.dimensions!==config.EMBEDDING_DIMENSIONS) warnings.push('O modelo de embeddings mudou. Reindexe o acervo para habilitar a busca vetorial.');
      else try {const [vector]=await this.ai.embed([input.question],true);const ids=await this.vectors.search(corpus.collection,vector,input.filters);semantic=this.store.sources(ids,corpus.version,input.filters);mode='hybrid';}
      catch {warnings.push('Busca vetorial indisponível; resultados provenientes do índice textual.');}
    } else warnings.push('Busca textual. O índice vetorial requer Gemini e Qdrant.');
    return {sources:fuse([lexical,semantic],input.limit),corpus,mode,warnings};
  }
  async research(input:SearchInput):Promise<ResearchResult>{
    const started=performance.now();const found=await this.search(input);
    const base={sources:found.sources,corpus:found.corpus,model:config.GEMINI_MODEL,usage:{inputTokens:0,outputTokens:0},latencyMs:0,searchMode:found.mode,warnings:found.warnings};
    if(!found.sources.length)return {...base,status:'insufficient_evidence',sections:{synthesis:[],legislation:[],jurisprudence:[]},limitations:['Nenhum trecho do acervo sustenta esta pesquisa.'],latencyMs:Math.round(performance.now()-started)};
    const generated=await this.ai.generate(input.question,found.sources);const answer=validateAnswer(generated.answer,found.sources);
    const referenced=new Set(Object.values(answer.sections).flat().flatMap(c=>c.references));
    return {...base,...answer,sources:found.sources.filter(s=>referenced.has(s.id)),usage:generated.usage,latencyMs:Math.round(performance.now()-started)};
  }
}
