import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv({path:resolve(projectRoot,'.env'),quiet:true});
const Environment = z.object({
  GEMINI_API_KEY:z.string().default(''), GEMINI_MODEL:z.string().default('gemini-3.8-flash'),
  EMBEDDING_MODEL:z.string().default('gemini-embedding-2'), EMBEDDING_DIMENSIONS:z.coerce.number().int().min(128).max(3072).default(768),
  QDRANT_URL:z.string().url().default('http://127.0.0.1:6333'), DATA_DIR:z.string().default(resolve(projectRoot,'data/runtime')),
  API_HOST:z.string().default('127.0.0.1'), API_PORT:z.coerce.number().int().min(1).max(65535).default(3001),
});
export const config = Environment.parse(process.env);
config.DATA_DIR = resolve(projectRoot,config.DATA_DIR);
