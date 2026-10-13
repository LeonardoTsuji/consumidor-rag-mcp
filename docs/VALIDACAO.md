# Validação da implementação

## Resultados executados

- Typecheck, lint, testes de núcleo e build do monorepo.
- Validação do snapshot: 17 documentos oficiais, 668 trechos; hashes e parsing conferidos.
- Indexação SQLite e avaliação de 60 perguntas sem chamadas Gemini.
- Hit@10 textual: 39 de 40 perguntas respondíveis, 97,5%; meta de 90% atingida nesta amostra.
- Quatro testes Playwright: pesquisa e referências, exportação Markdown, filtros do acervo, erro do provedor com fallback textual, ausência de resultados e layout móvel.
- Capturas de interface desktop e móvel em `interface.png` e `interface-mobile.png`.
- Build e inicialização Docker com API saudável, frontend Nginx e Qdrant em execução.
- MCP real via stdio: quatro ferramentas registradas e busca equivalente à API.
- Qdrant real: criação, contagem, consultas e filtros de tipo/data com vetores determinísticos; coleção temporária removida.
- Coleta HTTP completa dos 17 documentos pelo CLI no container, com snapshot separado e sem substituir a versão ativa.

O navegador conectado da skill Browser não estava disponível neste ambiente. A verificação visual e de fluxos foi feita com o Chromium dos testes Playwright.

## Integrações que exigem execução separada

`pnpm --filter @consumidor/mcp exec node --import tsx src/smoke.ts` verifica registro das quatro ferramentas pelo protocolo stdio e compara uma busca com a API em execução.

`docker compose exec api node --import tsx apps/api/src/vector-smoke.ts` verifica indexação, contagem, consultas e filtros no Qdrant real, usando vetores determinísticos. Cria uma coleção temporária e a remove ao finalizar. Não mede qualidade dos embeddings Gemini.

`pnpm evaluate --live` verifica geração e métricas automáticas com Gemini real. Requer chave e quota; não foi executado nesta entrega. A revisão humana do suporte semântico permanece pendente, conforme a rubrica.

## Limites de avaliação

As métricas de recuperação são específicas da amostra e não provam generalização. Metas de suporte semântico e abstenção em geração não têm resultados certificados sem integração Gemini e revisão humana. Os testes de interface usam respostas determinísticas que exercitam o contrato de fontes; não representam respostas jurídicas reais.
