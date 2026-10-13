import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SearchInput } from '@consumidor/shared';
import { callTool, DocumentInput, toolDefinitions, type ToolName } from './tools.js';
const apiUrl=process.env.API_URL??'http://127.0.0.1:3001';
const server=new McpServer({name:'consumidor-rag-mcp',version:'0.1.0'});
for(const name of Object.keys(toolDefinitions) as ToolName[]) {
  server.registerTool(name,{description:toolDefinitions[name].description,inputSchema:name==='obter_documento'?DocumentInput.shape:SearchInput.shape,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async (input:unknown)=>{
    try {const result=await callTool(name,input,apiUrl);return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result as Record<string,unknown>};}
    catch(e){return {isError:true,content:[{type:'text' as const,text:e instanceof Error?e.message:'Falha ao consultar API'}]};}
  });
}
await server.connect(new StdioServerTransport());
