import { z } from 'zod';

export const topics = ['arrependimento', 'garantia', 'entrega', 'oferta', 'cobranca'] as const;
export const topicLabels: Record<typeof topics[number], string> = {
  arrependimento: 'Arrependimento', garantia: 'Vícios e garantia', entrega: 'Entrega', oferta: 'Oferta e publicidade', cobranca: 'Cobrança indevida',
};
export const Topic = z.enum(topics);
export const SourceType = z.enum(['legislacao', 'jurisprudencia']);
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Data inválida');
export const Filters = z.object({topic: Topic.optional(), type: SourceType.optional(), publishedFrom: DateOnly.optional(), publishedTo: DateOnly.optional()}).strict().refine(f => !f.publishedFrom || !f.publishedTo || f.publishedFrom <= f.publishedTo, 'Intervalo de datas inválido');
export const SearchInput = z.object({question: z.string().trim().min(5).max(2000), filters: Filters.default({}), limit: z.number().int().min(1).max(10).default(10)}).strict();
export type SearchInput = z.infer<typeof SearchInput>;
export type FilterInput = z.infer<typeof Filters>;
export const ManifestEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(3), type: SourceType, url: z.string().url(),
  topics: z.array(Topic).min(1), format: z.enum(['html','pdf']), authority: z.enum(['Planalto','STJ']),
  process: z.string().optional(), court: z.string().optional(), rapporteur: z.string().optional(),
  judgedAt: DateOnly.optional(), publishedAt: DateOnly.optional(), rationale: z.string().min(10),
  qualifiedPrecedent: z.object({label:z.string(), officialUrl:z.string().url()}).optional(),
}).strict().superRefine((entry, ctx) => {
  if (entry.type === 'jurisprudencia') for (const key of ['process','court','rapporteur','judgedAt','publishedAt'] as const)
    if (!entry[key]) ctx.addIssue({code:'custom',path:[key],message:'Metadado obrigatório para acórdão'});
  if ((entry.type === 'legislacao') !== (entry.authority === 'Planalto')) ctx.addIssue({code:'custom',message:'Órgão incompatível com tipo de documento'});
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;
export const Manifest = z.object({schemaVersion: z.literal(1), documents: z.array(ManifestEntry).min(2)}).strict();
export type Manifest = z.infer<typeof Manifest>;
export interface Chunk { id:string; documentId:string; text:string; location:string; page?:number; topics:typeof topics[number][] }
export interface Document extends ManifestEntry { hash:string; collectedAt:string; finalUrl:string; chunks:Chunk[] }
export interface Source extends Chunk { title:string; url:string; type:z.infer<typeof SourceType>; authority:string; process?:string; court?:string; rapporteur?:string; publishedAt?:string; judgedAt?:string; collectedAt:string; hash:string; qualifiedPrecedent?:ManifestEntry['qualifiedPrecedent']; score:number }
export interface Corpus { version:string; collectedAt:string; activatedAt:string; count:number; chunks:number; embeddingModel:string|null; dimensions:number|null; generationModel:string; collection:string|null; coverage:Record<string,number> }
export const Claim = z.object({text:z.string().min(1).max(4000), references:z.array(z.string()).min(1), quotations:z.array(z.object({sourceId:z.string(),text:z.string().min(1)})).default([])}).strict();
export const GeneratedAnswer = z.object({status:z.enum(['answered','insufficient_evidence']), sections:z.object({synthesis:z.array(Claim).max(12),legislation:z.array(Claim).max(12),jurisprudence:z.array(Claim).max(12)}).strict(), limitations:z.array(z.string().max(2000)).min(1).max(10)}).strict();
export type GeneratedAnswer = z.infer<typeof GeneratedAnswer>;
export interface SearchResult { sources:Source[]; corpus:Corpus|null; mode:'hybrid'|'textual'; warnings:string[] }
export interface ResearchResult extends GeneratedAnswer { sources:Source[]; corpus:Corpus|null; model:string; usage:{inputTokens:number;outputTokens:number}; latencyMs:number; searchMode:SearchResult['mode']; warnings:string[] }
export function exportMarkdown(question:string, result:ResearchResult):string {
  const sections = [['Síntese','synthesis'],['Base legal','legislation'],['Jurisprudência','jurisprudence']] as const;
  return [`# Pesquisa em Direito do Consumidor`, question, `Acervo: ${result.corpus?.version ?? 'indisponível'} | coleta: ${result.corpus?.collectedAt ?? '—'} | modelo: ${result.model}`,
    ...sections.flatMap(([label,key]) => [`## ${label}`, ...result.sections[key].map(c => `${c.text} ${c.references.map(id => `[${id}]`).join(' ')}${c.quotations.map(q => `\n> ${q.text} [${q.sourceId}]`).join('')}`)]),
    '## Limitações', ...result.limitations.map(t => `- ${t}`), '## Fontes', ...result.sources.map(s => `- [${s.id}] [${s.title} — ${s.location}](${s.url})\n  ${s.text}\n  Coleta: ${s.collectedAt}; hash: ${s.hash}`)].join('\n\n');
}
