import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isDeepStrictEqual } from 'node:util';
const apiUrl=process.env.API_URL??'http://127.0.0.1:3001';
const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/main.ts'],env:{...Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>pair[1]!==undefined)),API_URL:apiUrl}});
const client=new Client({name:'consumidor-smoke',version:'0.1.0'});
try{
  await client.connect(transport);const available=await client.listTools();
  if(available.tools.length!==4)throw new Error('Ferramentas MCP incompletas.');
  const input={question:'Prazo de arrependimento na devolução do produto',filters:{type:'legislacao'},limit:10};
  const direct=await fetch(new URL('/api/search',apiUrl),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>r.json());
  const result=await client.callTool({name:'buscar_legislacao',arguments:input});
  if(result.isError||!isDeepStrictEqual(result.structuredContent,direct))throw new Error('Resultado MCP diverge da API.');
  console.log('MCP stdio: quatro ferramentas registradas; resposta equivalente à API.');
}finally{await client.close();}
