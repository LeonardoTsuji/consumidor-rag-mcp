import { loadSnapshot, indexCorpus } from '../../apps/api/src/ingestion.js';
import { projectRoot } from '../../apps/api/src/config.js';
import { Store } from '../../apps/api/src/store.js';
import { Research } from '../../apps/api/src/research.js';
import { createApp } from '../../apps/api/src/app.js';
import { AppError } from '../../apps/api/src/errors.js';
import { resolve } from 'node:path';
import type { AIProvider } from '../../apps/api/src/gemini.js';
const store=new Store(':memory:');
// Deterministic provider only for browser tests. Production always calls Gemini.
const provider:AIProvider={embed:async()=>[[1]],generate:async(question,sources)=>{
  if(question.includes('quota'))throw new AppError('PROVIDER_QUOTA','Quota do Gemini excedida.',429);
  const first=sources[0];return {answer:{status:'answered',sections:{synthesis:[{text:'Consulte o dispositivo e seu contexto no trecho citado.',references:[first.id],quotations:[{sourceId:first.id,text:first.text.slice(0,80)}]}],legislation:[],jurisprudence:[]},limitations:['Resposta de teste determinística; revisão semântica não realizada.']},usage:{inputTokens:100,outputTokens:20}};
}};
const docs=await loadSnapshot(resolve(projectRoot,'data/snapshot'));
await indexCorpus(store,docs,provider,{create:async()=>{}},true);
const app=createApp(new Research(store,provider,{search:async()=>[]}),false);
await app.listen({host:'127.0.0.1',port:3199});
