import type { Source } from '@consumidor/shared';

export function generatedAnswerSchema(sources:ReadonlyArray<Pick<Source,'id'|'type'>>){
  // Keep the provider schema small; GeneratedAnswer validates text and array limits locally.
  const section=(type?:Source['type'])=>{
    const ids=[...new Set(sources.filter(s=>!type||s.type===type).map(s=>s.id))];
    const sourceId={type:'string',...(ids.length?{enum:ids}:{})};
    return {
      type:'array',...(ids.length?{}:{maxItems:0}),
      items:{
        type:'object',
        properties:{
          text:{type:'string'},
          references:{type:'array',items:sourceId},
          quotations:{type:'array',items:{
            type:'object',
            properties:{sourceId,text:{type:'string'}},required:['sourceId','text'],
          }},
        },required:['text','references','quotations'],
      },
    };
  };
  return {
    type:'object',
    properties:{
      status:{type:'string',enum:['answered','insufficient_evidence']},
      sections:{
        type:'object',
        properties:{synthesis:section(),legislation:section('legislacao'),jurisprudence:section('jurisprudencia')},
        required:['synthesis','legislation','jurisprudence'],
      },
      limitations:{type:'array',items:{type:'string'}},
    },required:['status','sections','limitations'],
  };
}
