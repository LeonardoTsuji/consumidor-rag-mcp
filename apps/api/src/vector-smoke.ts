import { randomUUID } from 'node:crypto';
import { Vectors } from './vectors.js';
import { config, projectRoot } from './config.js';
import { loadSnapshot } from './ingestion.js';
import { resolve } from 'node:path';
const docs=await loadSnapshot(resolve(projectRoot,'data/snapshot'));
const subset=docs.filter(d=>d.id==='cdc'||d.id==='resp-1340604').map(d=>({...d,chunks:d.chunks.slice(0,1)}));
const vectors=new Vectors();const collection=`test_${randomUUID().replaceAll('-','')}`;
const vector=Array.from({length:config.EMBEDDING_DIMENSIONS},(_,i)=>i===0?1:0);
try{
  await vectors.create(collection,subset,{embed:async texts=>texts.map(()=>vector),generate:async()=>{throw new Error('Geração não usada');}});
  const legal=await vectors.search(collection,vector,{type:'legislacao'});
  const past=await vectors.search(collection,vector,{publishedTo:'2012-01-01'});
  const current=await vectors.search(collection,vector,{publishedFrom:'2014-01-01'});
  if(legal.length!==1||past.length!==1||current.length!==1||!past[0].startsWith('cdc-')||!current[0].startsWith('cdc-'))throw new Error('Filtros vetoriais divergentes.');
  console.log('Qdrant real: indexação, contagem, busca, tipos e filtros de data conferidos com embeddings determinísticos.');
}finally{await vectors.client.deleteCollection(collection);}
