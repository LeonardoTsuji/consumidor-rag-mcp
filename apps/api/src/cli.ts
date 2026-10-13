import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, projectRoot } from './config.js';
import { validateManifest, collect, loadSnapshot, indexCorpus } from './ingestion.js';
import { Store } from './store.js';
import { Gemini } from './gemini.js';
import { Vectors } from './vectors.js';
const args=process.argv.slice(2);const command=args[0];const textOnly=args.includes('--text-only');
const option=(flag:string,fallback:string)=>{const i=args.indexOf(flag);return i<0?fallback:resolve(args[i+1]??fallback);};
const manifestPath=option('--manifest',resolve(projectRoot,'data/manifest.json'));
let directory=option('--snapshot',resolve(projectRoot,'data/snapshot'));
try {
  if(command==='validate') {
    const manifest=validateManifest(JSON.parse(await readFile(manifestPath,'utf8')));
    const docs=await loadSnapshot(directory);console.log(JSON.stringify({valid:true,manifestDocuments:manifest.documents.length,documents:docs.length,chunks:docs.reduce((n,d)=>n+d.chunks.length,0)},null,2));
  }else if(command==='collect'||command==='update'){
    const manifest=validateManifest(JSON.parse(await readFile(manifestPath,'utf8')));
    directory=resolve(config.DATA_DIR,'snapshots',`${new Date().toISOString().replaceAll(':','-')}_${randomUUID().slice(0,8)}`);
    const documents=await collect(manifest,directory);console.log(`Coleta salva em ${directory}`);
    if(command==='update'){
      const store=new Store(join(config.DATA_DIR,'corpus.sqlite'));try {const result=await indexCorpus(store,documents,new Gemini(),new Vectors(),textOnly);await writeFile(join(directory,'changes.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}finally{store.close();}
    }
  }else if(command==='index'){
    const documents=await loadSnapshot(directory);const store=new Store(join(config.DATA_DIR,'corpus.sqlite'));
    try {const result=await indexCorpus(store,documents,new Gemini(),new Vectors(),textOnly);await mkdir(config.DATA_DIR,{recursive:true});await writeFile(join(config.DATA_DIR,'last-index-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}finally{store.close();}
  }else{console.log('Uso: pnpm corpus <collect|validate|index|update> [--manifest arquivo] [--snapshot pasta] [--text-only]');process.exitCode=1;}
}catch(e){console.error(e instanceof Error?e.message:'Falha de ingestão');process.exitCode=1;}
