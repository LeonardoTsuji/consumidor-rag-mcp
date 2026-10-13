import { join, resolve } from 'node:path';
import { config, projectRoot } from './config.js';
import { Store } from './store.js';
import { loadSnapshot, indexCorpus } from './ingestion.js';
import { Gemini } from './gemini.js';
import { Vectors } from './vectors.js';
const store=new Store(join(config.DATA_DIR,'corpus.sqlite'));
try {if(!store.corpus())await indexCorpus(store,await loadSnapshot(resolve(projectRoot,'data/snapshot')),new Gemini(),new Vectors(),true);}finally{store.close();}
await import('./main.js');
