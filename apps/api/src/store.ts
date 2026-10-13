import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Corpus, Document, FilterInput, Source } from '@consumidor/shared';
import { AppError } from './errors.js';

export function filterSql(filters:FilterInput, alias='d'):{sql:string;params:unknown[]} {
  const terms:string[]=[]; const params:unknown[]=[];
  if (filters.type) {terms.push(`${alias}.type = ?`);params.push(filters.type);}
  if (filters.topic) {terms.push(`EXISTS (SELECT 1 FROM json_each(${alias}.topics) WHERE value = ?)`);params.push(filters.topic);}
  if (filters.publishedFrom) {terms.push(`(${alias}.type != 'jurisprudencia' OR ${alias}.published_at >= ?)`);params.push(filters.publishedFrom);}
  if (filters.publishedTo) {terms.push(`(${alias}.type != 'jurisprudencia' OR ${alias}.published_at <= ?)`);params.push(filters.publishedTo);}
  return {sql:terms.length?' AND '+terms.join(' AND '):'',params};
}
const stopwords = new Set('a o os as e em de da do das dos no na nos nas um uma que qual quais como quando para por pelo pela se ao aos com meu minha pode posso ser sobre segundo direito consumidor compra compras online internet'.split(' '));
export function lexicalQuery(question:string):string|null {
  const tokens=[...new Set((question.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t=>t.length>1&&!stopwords.has(t)))].slice(0,25);
  const expansion:Record<string,string[]>= {devolver:['arrependimento','restituicao'],devolucao:['arrependimento','restituicao'],cancelar:['arrependimento'],defeito:['vicio'],defeituoso:['vicio'],quebrou:['vicio'],atrasou:['entrega'],atraso:['entrega'],reembolso:['restituicao'],frete:['postal'],cobranca:['cobrado'],dobro:['indebito'],anuncio:['publicidade','oferta']};
  const all=[...new Set(tokens.flatMap(t=>[t,...(expansion[t]??[])]))];
  return all.length?all.map(t=>`"${t}"`).join(' OR '):null;
}
export class Store {
  readonly db:Database.Database;
  constructor(path:string) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new Database(path); this.db.pragma('journal_mode = WAL');this.db.pragma('foreign_keys = ON');
    this.db.exec(`CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version TEXT NOT NULL REFERENCES versions(id));
      CREATE TABLE IF NOT EXISTS documents (version TEXT NOT NULL REFERENCES versions(id), id TEXT NOT NULL, type TEXT NOT NULL, topics TEXT NOT NULL, published_at TEXT, metadata TEXT NOT NULL, PRIMARY KEY(version,id));
      CREATE TABLE IF NOT EXISTS chunks (version TEXT NOT NULL, id TEXT NOT NULL, document_id TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(version,id), FOREIGN KEY(version,document_id) REFERENCES documents(version,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(version UNINDEXED, id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');`);
  }
  corpus():Corpus|null {
    const row=this.db.prepare('SELECT metadata FROM versions WHERE id=(SELECT version FROM active WHERE singleton=1)').get() as {metadata:string}|undefined;
    return row?JSON.parse(row.metadata):null;
  }
  activate(corpus:Corpus,documents:Document[]):void {
    this.db.transaction(()=>{
      if(this.db.prepare('SELECT 1 FROM versions WHERE id=?').get(corpus.version)) {
        this.db.prepare('INSERT INTO active(singleton,version) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET version=excluded.version').run(corpus.version);return;
      }
      this.db.prepare('INSERT INTO versions VALUES(?,?)').run(corpus.version,JSON.stringify(corpus));
      const doc=this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?)');
      const chunk=this.db.prepare('INSERT INTO chunks VALUES(?,?,?,?,?)');
      const fts=this.db.prepare('INSERT INTO chunks_fts(version,id,text) VALUES(?,?,?)');
      for(const d of documents) {
        doc.run(corpus.version,d.id,d.type,JSON.stringify(d.topics),d.publishedAt??null,JSON.stringify({...d,chunks:undefined}));
        for(const c of d.chunks) {chunk.run(corpus.version,c.id,d.id,c.text,JSON.stringify(c));fts.run(corpus.version,c.id,c.text);}
      }
      this.db.prepare('INSERT INTO active(singleton,version) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET version=excluded.version').run(corpus.version);
    })();
  }
  list(filters:FilterInput={},page=1,pageSize=20,version=this.corpus()?.version):{documents:Omit<Document,'chunks'>[];total:number;page:number;pageSize:number} {
    if(!version)return {documents:[],total:0,page,pageSize};
    const f=filterSql(filters);const where='d.version=?'+f.sql;
    const rows=this.db.prepare(`SELECT d.metadata FROM documents d WHERE ${where} ORDER BY d.id LIMIT ? OFFSET ?`).all(version,...f.params,pageSize,(page-1)*pageSize) as {metadata:string}[];
    const count=this.db.prepare(`SELECT count(*) AS total FROM documents d WHERE ${where}`).get(version,...f.params) as {total:number};
    return {documents:rows.map(r=>JSON.parse(r.metadata)),total:count.total,page,pageSize};
  }
  document(id:string,version=this.corpus()?.version):Document|null {
    if(!version)return null;
    const row=this.db.prepare('SELECT metadata FROM documents WHERE version=? AND id=?').get(version,id) as {metadata:string}|undefined;
    if(!row)return null;
    const chunks=this.db.prepare('SELECT metadata FROM chunks WHERE version=? AND document_id=? ORDER BY rowid').all(version,id) as {metadata:string}[];
    return {...JSON.parse(row.metadata),chunks:chunks.map(r=>JSON.parse(r.metadata))};
  }
  sources(ids:string[],version:string,filters:FilterInput={}):Source[] {
    const f=filterSql(filters);
    return ids.flatMap(id=>{
      const row=this.db.prepare(`SELECT c.metadata AS chunk,d.metadata AS doc FROM chunks c JOIN documents d ON d.id=c.document_id AND d.version=c.version WHERE c.version=? AND c.id=?${f.sql}`).get(version,id,...f.params) as {chunk:string;doc:string}|undefined;
      if(!row)return [];
      const doc=JSON.parse(row.doc); return [{...doc,...JSON.parse(row.chunk),url:doc.url,score:0}];
    });
  }
  search(question:string,filters:FilterInput,version:string):Source[] {
    const query=lexicalQuery(question);if(!query)return [];
    const f=filterSql(filters);
    try {
      const rows=this.db.prepare(`SELECT chunks_fts.id, bm25(chunks_fts) AS rank FROM chunks_fts JOIN documents d ON d.version=chunks_fts.version AND d.id=(SELECT document_id FROM chunks WHERE version=chunks_fts.version AND id=chunks_fts.id) WHERE chunks_fts MATCH ? AND chunks_fts.version=?${f.sql} ORDER BY rank LIMIT 20`).all(query,version,...f.params) as {id:string;rank:number}[];
      return rows.flatMap(r=>this.sources([r.id],version,filters).map(s=>({...s,score:-r.rank})));
    } catch {throw new AppError('SEARCH_FAILED','Não foi possível consultar o índice textual.');}
  }
  close(){this.db.close();}
}
