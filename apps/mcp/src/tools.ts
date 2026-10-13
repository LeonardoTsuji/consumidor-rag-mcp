import { SearchInput, Filters, type SearchResult, type ResearchResult } from '@consumidor/shared';
import { z } from 'zod';
export const DocumentInput=z.object({id:z.string().regex(/^[a-z0-9-]+$/),version:z.string().regex(/^[a-zA-Z0-9_-]+$/).optional()}).strict();
export const toolDefinitions={
  buscar_legislacao:{description:'Busca dispositivos legais do acervo oficial por pergunta e filtros.',schema:SearchInput},
  buscar_jurisprudencia:{description:'Busca trechos de acórdãos do STJ selecionados no acervo, com metadados e referências.',schema:SearchInput},
  pesquisar_consumidor:{description:'Produz pesquisa fundamentada em Direito do Consumidor com referências verificadas.',schema:SearchInput},
  obter_documento:{description:'Obtém texto, metadados e trechos de um documento pela versão do acervo.',schema:DocumentInput},
} as const;
export type ToolName=keyof typeof toolDefinitions;
export async function callTool(name:ToolName,input:unknown,apiUrl:string,fetcher:typeof fetch=fetch):Promise<SearchResult|ResearchResult|Record<string,unknown>> {
  let path:string;let body:unknown;let method='POST';
  if(name==='obter_documento'){const parsed=DocumentInput.parse(input);method='GET';path=`/api/documents/${parsed.id}${parsed.version?`?version=${encodeURIComponent(parsed.version)}`:''}`;}
  else {const parsed=SearchInput.parse(input);body= name==='buscar_legislacao'?{...parsed,filters:Filters.parse({...parsed.filters,type:'legislacao'})}:name==='buscar_jurisprudencia'?{...parsed,filters:Filters.parse({...parsed.filters,type:'jurisprudencia'})}:parsed;path=name==='pesquisar_consumidor'?'/api/research':'/api/search';}
  const response=await fetcher(new URL(path,apiUrl),{method,headers:{'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});
  const result=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(JSON.stringify(result));return result;
}
