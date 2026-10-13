import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { SearchInput, type ResearchResult } from '@consumidor/shared';
import { config, projectRoot } from './config.js';
import { Store } from './store.js';
import { Research } from './research.js';
import { Gemini } from './gemini.js';
import { Vectors } from './vectors.js';
import { fuse } from './research.js';
const Dataset=z.object({schemaVersion:z.literal(1),cases:z.array(z.object({id:z.string(),category:z.enum(['answerable','ambiguous','unsupported','adversarial']),question:z.string(),filters:SearchInput.shape.filters,expected:z.array(z.string()),expectedStatus:z.string().optional()})).length(60)});
const dataset=Dataset.parse(JSON.parse(await readFile(resolve(projectRoot,'data/evaluation/questions.json'),'utf8')));
const live=process.argv.includes('--live');const textual=process.argv.includes('--text-only');
if(live&&!config.GEMINI_API_KEY){console.error('A avaliação de geração requer GEMINI_API_KEY.');process.exit(1);}
const store=new Store(join(config.DATA_DIR,'corpus.sqlite'));const corpus=store.corpus();if(!corpus){console.error('Indexe o acervo antes de avaliar.');store.close();process.exit(1);}
const research=new Research(store,new Gemini(),new Vectors());
const rows:{id:string;category:string;hit:boolean|null;sourceIds:string[];latencyMs:number;response?:ResearchResult;error?:string}[]=[];
try{
  for(const item of dataset.cases){const started=performance.now();const input=SearchInput.parse({question:item.question,filters:item.filters,limit:10});
    try{const sources=textual?fuse([store.search(input.question,input.filters,corpus.version)],10):(await research.search(input)).sources;
      const hit=item.category==='answerable'?sources.some(s=>item.expected.some(id=>s.id===id||s.documentId===id)):null;
      const response=live?await research.research(input):undefined;rows.push({id:item.id,category:item.category,hit,sourceIds:sources.map(s=>s.id),latencyMs:Math.round(performance.now()-started),response});
    }catch(e){rows.push({id:item.id,category:item.category,hit:item.category==='answerable'?false:null,sourceIds:[],latencyMs:Math.round(performance.now()-started),error:e instanceof Error?e.message:'Falha'});}
  }
  const answered=rows.filter(r=>r.category==='answerable');const successful=rows.filter(r=>r.response);
  const allClaims=successful.flatMap(r=>Object.values(r.response!.sections).flat());
  const validClaims=successful.flatMap(r=>Object.values(r.response!.sections).flat().filter(c=>c.references.every(id=>r.response!.sources.some(s=>s.id===id))));
  const unanswerable=rows.filter(r=>r.category==='unsupported');
  const summary={createdAt:new Date().toISOString(),corpus:corpus.version,mode:textual?'textual':'configured',generationEvaluated:live,hitAt10:answered.filter(r=>r.hit).length/answered.length,referenceValidity:allClaims.length?validClaims.length/allClaims.length:null,unsupportedAbstention:live?unanswerable.filter(r=>r.response?.status==='insufficient_evidence').length/unanswerable.length:null,semanticSupport:null,humanReview:'pending',generationFailures:live?rows.filter(r=>r.error).length:null,medianLatencyMs:rows.map(r=>r.latencyMs).sort((a,b)=>a-b)[Math.floor(rows.length/2)],inputTokens:successful.reduce((n,r)=>n+r.response!.usage.inputTokens,0),outputTokens:successful.reduce((n,r)=>n+r.response!.usage.outputTokens,0),cost:null};
  const output=resolve(projectRoot,live?'data/evaluation/results-live':'data/evaluation/results-textual');await mkdir(output,{recursive:true});
  await writeFile(join(output,'results.json'),JSON.stringify({summary,rows},null,2));
  await writeFile(join(output,'REPORT.md'),`# Avaliação do acervo\n\nExecutada em ${summary.createdAt}. Versão: ${corpus.version}.\n\n- 40 perguntas respondíveis; 8 ambíguas; 8 sem suporte; 4 adversariais.\n- Hit@10: ${(summary.hitAt10*100).toFixed(1)}%. Meta: 90%.\n- Mediana da latência: ${summary.medianLatencyMs} ms.\n- Geração avaliada: ${live?'sim':'não — sem chamadas ao Gemini'}.\n- Suporte semântico: revisão humana pendente.\n- Custo monetário: não calculado; os tokens da execução são registrados em results.json.\n\nResultados de recuperação não certificam qualidade jurídica da geração. Perguntas e rubrica estão nesta pasta de avaliação.\n`);
  console.log(JSON.stringify(summary,null,2));if(summary.hitAt10<0.9||(live&&((summary.generationFailures??0)>0||(summary.unsupportedAbstention??0)<0.9||(summary.referenceValidity??0)<1)))process.exitCode=1;
}finally{store.close();}
