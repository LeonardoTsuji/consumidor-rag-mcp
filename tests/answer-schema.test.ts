import { describe,it,expect } from 'vitest';
import { generatedAnswerSchema } from '../apps/api/src/answer-schema.js';

const sources=[{id:'cdc-art49',type:'legislacao' as const},{id:'resp-trecho',type:'jurisprudencia' as const}];
describe('referências permitidas na geração',()=>{
  it('restringe referências e transcrições por tipo, permitindo síntese mista',()=>{
    const sections=generatedAnswerSchema(sources).properties.sections.properties;
    for(const [name,ids] of [
      ['synthesis',['cdc-art49','resp-trecho']],
      ['legislation',['cdc-art49']],
      ['jurisprudence',['resp-trecho']],
    ] as const){
      const claim=sections[name].items.properties;
      expect(claim.references.items.enum).toEqual(ids);
      expect(claim.quotations.items.properties.sourceId.enum).toEqual(ids);
    }
  });
  it.each(['legislacao','jurisprudencia'] as const)('exige seção vazia quando faltam fontes %s',type=>{
    const sections=generatedAnswerSchema(sources.filter(s=>s.type!==type)).properties.sections.properties;
    const absent=type==='legislacao'?'legislation':'jurisprudence';
    expect(sections[absent].maxItems).toBe(0);
    // Empty enum is invalid JSON Schema; the empty section constrains the output instead.
    expect(sections[absent].items.properties.references.items).not.toHaveProperty('enum');
    expect(sections.synthesis.maxItems).toBeUndefined();
  });
});
