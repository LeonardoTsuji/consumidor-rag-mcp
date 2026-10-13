import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { Filters, SearchInput } from '@consumidor/shared';
import type { Research } from './research.js';
import { AppError } from './errors.js';
export function createApp(research:Research,logging=true){
  const app=Fastify({logger:logging?{level:'info'}:false,disableRequestLogging:true,bodyLimit:16000,requestTimeout:60000});
  const Query=z.object({topic:z.string().optional(),type:z.string().optional(),publishedFrom:z.string().optional(),publishedTo:z.string().optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
  app.setErrorHandler((error,_request,reply)=>{
    if(error instanceof ZodError)return reply.status(400).send({error:{code:'INVALID_INPUT',message:'Confira os campos e filtros da pesquisa.',details:error.flatten()}});
    if(error instanceof AppError)return reply.status(error.statusCode).send({error:{code:error.code,message:error.message}});
    const status=(error as {statusCode?:number}).statusCode??500;
    return reply.status(status).send({error:{code:status<500?'INVALID_INPUT':'INTERNAL_ERROR',message:status<500?'Requisição inválida.':'Falha interna. Consulte os registros do serviço.'}});
  });
  app.get('/api/health',()=>({status:'ok',index:research.store.corpus()?'ready':'empty'}));
  app.get('/api/corpus',()=>({corpus:research.store.corpus()}));
  app.get('/api/documents',async request=>{const {page,pageSize,...filters}=Query.parse(request.query);return research.store.list(Filters.parse(filters),page,pageSize);});
  app.get('/api/documents/:id',async request=>{
    const {id}=z.object({id:z.string().regex(/^[a-z0-9-]+$/)}).parse(request.params);
    const {version}=z.object({version:z.string().regex(/^[a-zA-Z0-9_-]+$/).optional()}).strict().parse(request.query);
    const document=research.store.document(id,version);if(!document)throw new AppError('NOT_FOUND','Documento não encontrado.',404);return {document};
  });
  app.post('/api/search',async request=>research.search(SearchInput.parse(request.body)));
  app.post('/api/research',async request=>{
    const answer=await research.research(SearchInput.parse(request.body));
    app.log.info({requestId:request.id,version:answer.corpus?.version,model:answer.model,latencyMs:answer.latencyMs,usage:answer.usage,status:answer.status},'research');return answer;
  });
  return app;
}
