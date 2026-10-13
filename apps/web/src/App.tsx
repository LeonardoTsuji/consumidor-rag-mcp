import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronRight, ExternalLink, FileText, FolderOpen, Landmark, LoaderCircle, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { exportMarkdown, Filters, topicLabels, topics, type Corpus, type Document, type FilterInput, type ResearchResult, type SearchResult, type Source } from '@consumidor/shared';

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers}});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Não foi possível consultar o serviço.');return result;
}
const date=(value?:string)=>value?new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(value)):'—';
const examples=['Quais são os limites do direito de arrependimento em compras online?','O comerciante deve encaminhar um produto defeituoso à assistência técnica?','A falta de estoque permite recusar o cumprimento de uma oferta?'];
type DocumentList={documents:Omit<Document,'chunks'>[];total:number;page:number;pageSize:number};
export function App(){
  const [page,setPage]=useState<'research'|'corpus'>('research');const [corpus,setCorpus]=useState<Corpus|null>(null);const [corpusError,setCorpusError]=useState('');
  const [question,setQuestion]=useState('');const [filters,setFilters]=useState<FilterInput>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [result,setResult]=useState<ResearchResult|null>(null);const [searchResult,setSearchResult]=useState<SearchResult|null>(null);const [searchedQuestion,setSearchedQuestion]=useState('');
  const [selected,setSelected]=useState<Source|null>(null);const [document,setDocument]=useState<Document|null>(null);const [documentError,setDocumentError]=useState('');
  const [list,setList]=useState<DocumentList|null>(null);const [listError,setListError]=useState('');const [listPage,setListPage]=useState(1);const [expanded,setExpanded]=useState(false);
  const sourceClose=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const controller=new AbortController();api<{corpus:Corpus|null}>('/api/corpus',{signal:controller.signal}).then(r=>setCorpus(r.corpus)).catch(e=>{if(!controller.signal.aborted)setCorpusError(String(e.message));});return()=>controller.abort();},[]);
  useEffect(()=>{if(page!=='corpus')return;const controller=new AbortController();setListError('');setList(null);
    const query=new URLSearchParams({...Object.fromEntries(Object.entries(filters).filter(([,value])=>value)),page:String(listPage),pageSize:'12'});
    api<DocumentList>(`/api/documents?${query}`,{signal:controller.signal}).then(setList).catch(e=>{if(!controller.signal.aborted)setListError(e.message);});return()=>controller.abort();},[page,filters,listPage]);
  useEffect(()=>{if(!selected)return;setDocument(null);setDocumentError('');sourceClose.current?.focus();const controller=new AbortController();
    const version=result?.corpus?.version??searchResult?.corpus?.version??corpus?.version;
    api<{document:Document}>(`/api/documents/${selected.documentId}${version?`?version=${version}`:''}`,{signal:controller.signal}).then(r=>setDocument(r.document)).catch(e=>{if(!controller.signal.aborted)setDocumentError(e.message);});
    const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null);};window.addEventListener('keydown',keyboard);return()=>{controller.abort();window.removeEventListener('keydown',keyboard);};},[selected,result?.corpus?.version,searchResult?.corpus?.version,corpus?.version]);
  const changeFilter=(key:keyof FilterInput,value:string)=>{setFilters(f=>({...f,[key]:value||undefined}));setListPage(1);};
  async function run(mode:'research'|'search'){
    setError('');if(question.trim().length<5){setError('Escreva uma pergunta com pelo menos cinco caracteres.');return;}
    const validated=Filters.safeParse(filters);if(!validated.success){setError('Confira o intervalo de datas.');return;}
    setBusy(true);setResult(null);setSearchResult(null);setSearchedQuestion(question.trim());
    try{const init={method:'POST',body:JSON.stringify({question:question.trim(),filters:validated.data,limit:10})};
      if(mode==='research')setResult(await api<ResearchResult>('/api/research',init));else setSearchResult(await api<SearchResult>('/api/search',init));
    }catch(e){setError(e instanceof Error?e.message:'Falha ao consultar o serviço.');}finally{setBusy(false);}
  }
  function download(){if(!result)return;const blob=new Blob([exportMarkdown(searchedQuestion,result)],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=window.document.createElement('a');a.href=url;a.download='pesquisa-consumidor.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const sources=result?.sources??searchResult?.sources??[];
  function sourceButton(id:string){const s=sources.find(s=>s.id===id);return s?<button className="citation" key={id} onClick={()=>setSelected(s)} title={`${s.title} — ${s.location}`}>{sources.indexOf(s)+1}</button>:null;}
  const filterControls=<div className="filters">
    <label>Tema<select aria-label="Tema" value={filters.topic??''} onChange={e=>changeFilter('topic',e.target.value)}><option value="">Todos os temas</option>{topics.map(t=><option value={t} key={t}>{topicLabels[t]}</option>)}</select></label>
    <label>Fonte<select aria-label="Tipo de fonte" value={filters.type??''} onChange={e=>changeFilter('type',e.target.value)}><option value="">Todas as fontes</option><option value="legislacao">Legislação</option><option value="jurisprudencia">Jurisprudência</option></select></label>
    <label>Publicação desde<input aria-label="Publicação desde" type="date" value={filters.publishedFrom??''} onChange={e=>changeFilter('publishedFrom',e.target.value)}/></label>
    <label>Publicação até<input aria-label="Publicação até" type="date" value={filters.publishedTo??''} onChange={e=>changeFilter('publishedTo',e.target.value)}/></label>
    <p>As datas filtram somente os julgados.</p>
  </div>;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('research');}}><span className="brand-mark"><Landmark size={24}/></span><span>consumidor<span className="brand-caption">PESQUISA JURÍDICA</span></span></a>
      <div className="workspace-label">ESPAÇO DE PESQUISA</div><nav aria-label="Navegação principal"><button className={page==='research'?'active':''} onClick={()=>setPage('research')}><Search size={18}/>Nova pesquisa<ChevronRight size={14}/></button><button className={page==='corpus'?'active':''} onClick={()=>setPage('corpus')}><FolderOpen size={18}/>Acervo oficial<ChevronRight size={14}/></button></nav>
      <div className="sidebar-note"><ShieldCheck size={22}/><strong>Fundamentos verificáveis</strong><p>Normas do Planalto e decisões do STJ. Cada referência leva ao documento original.</p><span><span className="dot"/>FONTES OFICIAIS</span></div>
      <div className="sidebar-bottom">Direito brasileiro<span>Compras online · v0.1</span></div>
    </aside>
    <main><header className="topbar"><span>Direito do Consumidor <ChevronRight size={14}/> {page==='research'?'Pesquisa':'Acervo'}</span><div className="official-tag"><ShieldCheck size={14}/> Fontes oficiais</div></header>
      <div className="content">
        <div className="eyebrow">PESQUISA EM DIREITO DO CONSUMIDOR</div>
        <div className="heading-row"><div><h1>{page==='research'?<>Da pergunta<br/>ao fundamento.</>:'Um acervo transparente.'}</h1><p className="intro">{page==='research'?'Explore legislação e jurisprudência sobre compras online, com fontes que você pode conferir.':'Consulte os documentos, a cobertura temática e a origem de cada referência.'}</p></div><div className="heading-emblem"><BookOpen size={58} strokeWidth={1}/><span>LEI · CONTEXTO · FONTE</span></div></div>
        {corpusError&&<div role="alert" className="error">Não foi possível carregar o acervo: {corpusError}</div>}
        {page==='research'?<>
          <form className="question-card" onSubmit={e=>{e.preventDefault();void run('research');}}><div className="card-label"><span><Search size={16}/>O QUE VOCÊ QUER PESQUISAR?</span><span>Uma pergunta, fontes verificáveis</span></div>
            <label className="sr-only" htmlFor="question">Sua pergunta jurídica</label><textarea id="question" maxLength={2000} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ex.: Quem paga o frete de devolução quando o consumidor se arrepende de uma compra online?"/>
            <div className="question-bottom"><button type="button" className="filter-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><SlidersHorizontal size={16}/>Filtros{Object.values(filters).some(Boolean)&&<span className="dot"/>}</button><div className="search-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>void run('search')}>Buscar trechos</button><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ArrowRight size={17}/>}Pesquisar</button></div></div>
            {expanded&&filterControls}
          </form>
          {error&&<div className="error" role="alert">{error}<button disabled={busy} onClick={()=>void run('search')}>Consultar os trechos disponíveis <ArrowRight size={14}/></button></div>}
          {busy&&<div className="loading" role="status"><LoaderCircle className="spin"/>Consultando o acervo e verificando as referências…</div>}
          {!busy&&!result&&!searchResult&&<div className="examples"><div className="section-caption">UM PONTO DE PARTIDA</div>{examples.map((example,i)=><button key={example} onClick={()=>{setQuestion(example);window.document.getElementById('question')?.focus();}}><span>0{i+1}</span>{example}<ArrowRight size={17}/></button>)}</div>}
          {result&&<section className="results" aria-label="Resultado da pesquisa"><div className="result-heading"><div><div className="eyebrow">PESQUISA FUNDAMENTADA</div><h2>{result.status==='answered'?'Os fundamentos encontrados':'Evidências insuficientes'}</h2></div><button className="secondary" onClick={download}><ArrowDownToLine size={16}/>Exportar Markdown</button></div><p className="result-question">{searchedQuestion}</p>
            {(['synthesis','legislation','jurisprudence'] as const).map((key,i)=>result.sections[key].length>0&&<div className="answer-section" key={key}><h3><span>0{i+1}</span>{['Síntese','Base legal','Jurisprudência'][i]}</h3>{result.sections[key].map((claim,index)=><div className="claim" key={index}><p>{claim.text} {claim.references.map(sourceButton)}</p>{claim.quotations.map((q,j)=><blockquote key={j}>{q.text} {sourceButton(q.sourceId)}</blockquote>)}</div>)}</div>)}
            <div className="limitations"><h3>Limites desta pesquisa</h3><ul>{result.limitations.map((text,i)=><li key={i}>{text}</li>)}</ul></div><div className="result-meta">{result.searchMode==='hybrid'?'Busca híbrida':'Busca textual'} · {result.latencyMs} ms · {result.usage.inputTokens+result.usage.outputTokens} tokens</div>
          </section>}
          {searchResult&&<section className="results" aria-label="Resultado da busca"><div className="eyebrow">CONSULTA AO ACERVO</div><h2>{sources.length?`${sources.length} trechos encontrados`:'Nenhum trecho encontrado'}</h2><p className="result-question">{searchedQuestion}</p>{!sources.length&&<p>Tente reformular a pergunta ou ampliar os filtros.</p>}</section>}
          {(result||searchResult)&&<>{(result?.warnings??searchResult?.warnings??[]).map((warning,i)=><p className="warning" key={i}>{warning}</p>)}{sources.length>0&&<section className="sources"><div className="section-caption">FONTES DESTA PESQUISA</div>{sources.map((s,i)=><button className="source-card" key={s.id} onClick={()=>setSelected(s)}><span className="source-number">{i+1}</span><div><span className="source-kind">{s.type==='legislacao'?'LEGISLAÇÃO':'JURISPRUDÊNCIA'} · {s.authority}</span><h3>{s.title}</h3><span className="location">{s.location}</span><p>{s.text.slice(0,250)}{s.text.length>250?'…':''}</p></div><ChevronRight size={20}/></button>)}</section>}</>}
          {!result&&!searchResult&&<div className="principles"><div><FileText size={20}/><h3>Texto legal</h3><p>Dispositivos preservados com artigos, parágrafos e incisos.</p></div><div><Landmark size={20}/><h3>Interpretação judicial</h3><p>Julgados identificados com contexto e limites da decisão.</p></div><div><Check size={20}/><h3>Referências conferíveis</h3><p>Trechos de apoio e links diretos para as fontes oficiais.</p></div></div>}
        </>:<>
          <div className="corpus-summary"><div><strong>{corpus?.count??0}</strong><span>DOCUMENTOS</span></div><div><strong>{corpus?.chunks??0}</strong><span>TRECHOS INDEXADOS</span></div><div><strong>{date(corpus?.collectedAt)}</strong><span>DATA DA COLETA</span></div></div>
          <div className="coverage">{topics.map(t=><span key={t}>{topicLabels[t]} <b>{corpus?.coverage[t]??0} julgados</b></span>)}</div>
          <div className="corpus-filters">{filterControls}</div>
          {listError&&<div role="alert" className="error">{listError}</div>}
          {!list&&!listError&&<p role="status">Carregando documentos…</p>}
          {list&&list.documents.length===0&&<div className="empty"><FolderOpen size={30}/><h2>Nenhum documento disponível</h2><p>O acervo está vazio ou os filtros não encontraram documentos.</p></div>}
          {list&&<div className="document-list">{list.documents.map(d=><article key={d.id}><span className="document-icon">{d.type==='legislacao'?<FileText size={21}/>:<Landmark size={21}/>}</span><div><span className="source-kind">{d.authority} · {d.type==='legislacao'?'LEGISLAÇÃO':'JURISPRUDÊNCIA'}</span><h3>{d.title}</h3><p>{d.rationale}</p><div className="document-meta">{d.court&&`${d.court} · `}{d.rapporteur&&`${d.rapporteur} · `}Coleta {date(d.collectedAt)}</div></div><a href={d.url} target="_blank" rel="noreferrer" aria-label={`Abrir fonte oficial: ${d.title}`}><ExternalLink size={18}/></a></article>)}</div>}
          {list&&list.total>12&&<div className="pagination"><button className="secondary" disabled={listPage===1} onClick={()=>setListPage(p=>p-1)}>Anterior</button><span>Página {listPage} de {Math.ceil(list.total/12)}</span><button className="secondary" disabled={listPage*12>=list.total} onClick={()=>setListPage(p=>p+1)}>Próxima</button></div>}
        </>}
        <footer><span><span className="dot"/>{corpus?`Acervo ${corpus.version.slice(0,14)} · Coleta em ${date(corpus.collectedAt)}`:'Acervo ainda não indexado'}</span><p>A data de coleta não garante vigência ou atualização integral da jurisprudência.</p></footer>
      </div>
    </main>
    {selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="source-drawer" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Tab'){const nodes=e.currentTarget.querySelectorAll<HTMLElement>('button,a[href]');const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&window.document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&window.document.activeElement===last){e.preventDefault();first.focus();}}}}><button ref={sourceClose} className="close" aria-label="Fechar fonte" onClick={()=>setSelected(null)}><X size={22}/></button><div className="eyebrow">DOCUMENTO DE APOIO</div><h2 id="source-title">{selected.title}</h2><p className="location">{selected.location}</p><a className="official-link" target="_blank" rel="noreferrer" href={selected.url}>Abrir documento oficial<ExternalLink size={16}/></a><dl><dt>Órgão</dt><dd>{selected.authority}</dd>{selected.court&&<><dt>Órgão julgador</dt><dd>{selected.court}</dd></>}{selected.rapporteur&&<><dt>Relatoria</dt><dd>{selected.rapporteur}</dd></>}{selected.judgedAt&&<><dt>Julgamento</dt><dd>{date(selected.judgedAt)}</dd></>}{selected.publishedAt&&<><dt>Publicação</dt><dd>{date(selected.publishedAt)}</dd></>}<dt>Coleta</dt><dd>{date(selected.collectedAt)}</dd><dt>SHA-256</dt><dd className="hash">{selected.hash}</dd></dl><h3>Trecho recuperado</h3><blockquote>{selected.text}</blockquote>{documentError&&<p role="alert">{documentError}</p>}{document&&<details><summary>Ver todos os trechos ({document.chunks.length})</summary>{document.chunks.map(c=><div className="document-chunk" key={c.id}><strong>{c.location}</strong><p>{c.text}</p></div>)}</details>}</aside></div>}
  </div>;
}
