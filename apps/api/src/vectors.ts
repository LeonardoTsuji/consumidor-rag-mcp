import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'node:crypto';
import type { Chunk, Document, FilterInput } from '@consumidor/shared';
import type { AIProvider } from './gemini.js';
import { config } from './config.js';
export function vectorFilter(filters:FilterInput) {
  const must:object[]=[];
  if(filters.type)must.push({key:'type',match:{value:filters.type}});
  if(filters.topic)must.push({key:'topics',match:{value:filters.topic}});
  const dates:object[]=[];
  if(filters.publishedFrom)dates.push({key:'publishedAt',range:{gte:Date.parse(filters.publishedFrom)}});
  if(filters.publishedTo)dates.push({key:'publishedAt',range:{lte:Date.parse(filters.publishedTo)}});
  if(dates.length)must.push({should:[{key:'type',match:{value:'legislacao'}},{must:[{key:'type',match:{value:'jurisprudencia'}},...dates]}]});
  return {must};
}
export function pointId(chunk:Chunk):string {
  const h=createHash('sha256').update(chunk.id).digest('hex').slice(0,32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export class Vectors {
  readonly client = new QdrantClient({url:config.QDRANT_URL,timeout:15000,checkCompatibility:false});
  async create(collection:string,documents:Document[],ai:AIProvider) {
    await this.client.createCollection(collection,{vectors:{size:config.EMBEDDING_DIMENSIONS,distance:'Cosine'}});
    const chunks=documents.flatMap(d=>d.chunks.map(c=>({c,d})));
    for(let i=0;i<chunks.length;i+=32){
      const batch=chunks.slice(i,i+32);const vectors=await ai.embed(batch.map(({c,d})=>`${d.title}\n${c.location}\n${c.text}`));
      await this.client.upsert(collection,{wait:true,points:batch.map(({c,d},j)=>({id:pointId(c),vector:vectors[j],payload:{chunkId:c.id,documentId:c.documentId,type:d.type,topics:c.topics,publishedAt:d.publishedAt?Date.parse(d.publishedAt):0}}))});
    }
    const count=await this.client.count(collection,{exact:true});
    if(count.count!==chunks.length)throw new Error('Índice vetorial incompleto.');
  }
  async search(collection:string,vector:number[],filters:FilterInput):Promise<string[]>{
    const result=await this.client.query(collection,{query:vector,limit:20,filter:vectorFilter(filters),with_payload:true});
    return result.points.map(p=>String(p.payload?.chunkId));
  }
}
