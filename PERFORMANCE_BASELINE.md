# PERFORMANCE BASELINE — BobCRM

Data da análise: 2026-07-23

## Status da Fase 0

A Fase 0 foi executada no código-fonte recebido com foco em mapeamento, confirmação dos gargalos e implantação de observabilidade segura.

Não havia uma instância MySQL disponível no ambiente de análise, nem a base real de 133 mil leads. Por isso, **nenhum p95 real foi inventado**. O código agora registra as métricas necessárias para gerar o baseline real no ambiente do CRM.

## Arquitetura confirmada

- Frontend: React 19 + Vite + TypeScript.
- Backend: Node.js HTTP server em `server/index.js`.
- Banco: MySQL 8 via `mysql2/promise`.
- Processo: PM2 em `fork`, 1 instância.
- API e worker persistente rodam no mesmo processo Node.
- Jobs existentes: importação, exportação CSV/XLSX, backup e rebuild do índice de busca.
- Persistência de jobs: tabela `async_jobs`.
- Banco principal possui 15 tabelas no schema atual.
- A tabela `leads` contém JSON, MEDIUMTEXT, FULLTEXT e diversos campos de data armazenados como VARCHAR.

## Gargalos confirmados

### P0 — Inteligência comercial recalculada em tempo de consulta

A lógica em `server/opportunityRules.js` monta expressões SQL muito grandes e repete extrações JSON por serviço.

Contagem confirmada no SQL gerado:

| Operação | JSON_EXTRACT | Tamanho aproximado do SQL |
| --- | ---: | ---: |
| Resumo de oportunidades | 410 | 58.908 caracteres |
| Resumo de leads | 194 | 30.396 caracteres |
| Overview administrativo | 88 | 13.055 caracteres |
| Filtro `lead-priority` | 94 | 14.731 caracteres |
| Filtro `lead-mapping` | 52 | 7.594 caracteres |

Impacto esperado em base grande: CPU alta no MySQL, rows examined elevados e latência crescente conforme a base aumenta.

### P0 — `SELECT *` em rotas críticas

Foram encontrados 51 usos de `SELECT *` em arquivos de produção do backend.

Casos críticos confirmados:

- listagem paginada de leads;
- Kanban;
- busca de duplicados;
- rebuild de `search_text`;
- exportação;
- leitura de registros administrativos.

Na listagem e no Kanban isso traz campos pesados que não são necessários para cards/linhas, incluindo:

- `commercial_notes` MEDIUMTEXT;
- `pain` MEDIUMTEXT;
- `search_text` MEDIUMTEXT;
- `service_interests` JSON;
- `service_status_map` JSON;
- `custom_fields` JSON.

### P0 — Kanban com N+1

O carregamento inicial do board executa, para cada etapa:

1. `COUNT(*)` da etapa filtrada;
2. `SELECT *` dos cards da etapa.

Com 9 etapas padrão, isso adiciona 18 queries somente nesse loop, além das queries de pipeline, estágios, escopo e contagens gerais.

A estrutura confirma o gargalo previsto e é candidata a consolidação com agregação e window functions do MySQL 8 na Fase 5.

### P0 — Busca ampla invalida índices

A busca pode usar FULLTEXT, mas sempre acrescenta fallbacks em OR com:

- `LIKE '%texto%'` em `search_text`;
- `LIKE '%texto%'` em várias colunas;
- `CAST(custom_fields AS CHAR)`;
- `CAST(service_status_map AS CHAR)`.

Também usa busca de telefone e e-mail com wildcard no início (`%termo%`), reduzindo a utilidade dos índices B-tree existentes.

### P0 — Importação ainda é lead a lead

A deduplicação inicial já possui uma melhoria relevante: cria um índice em memória com chaves da base.

Porém, após isso:

- cada lead é salvo individualmente;
- merges podem reler o lead completo individualmente;
- cada lead pode sincronizar tarefas individualmente;
- o lote inteiro é processado dentro de uma transação ampla;
- o lock lógico de identidade pode permanecer retido durante o lote.

O fluxo ainda não é INSERT/UPDATE em batch.

### P1 — API e worker no mesmo processo

Confirmado nos arquivos PM2:

- `instances: 1`;
- `exec_mode: fork`;
- `server/index.js` inicia HTTP e worker persistente.

Jobs pesados podem competir com requisições web por CPU, event loop, heap e pool MySQL.

### P1 — Datas em VARCHAR

O schema possui dezenas de campos temporais em `VARCHAR(40)`, incluindo campos relevantes para leads, tarefas, sessões, jobs e auditoria.

Foram encontrados 11 usos de `LEFT(..., 10)` no backend de produção para filtros de data.

Isso impede ou reduz o aproveitamento eficiente de índices em filtros temporais.

### P1 — Arquivo principal excessivamente concentrado

`server/index.js` possui aproximadamente 5.575 linhas e concentra:

- bootstrap;
- migrations auxiliares;
- SQL;
- autenticação;
- leads;
- Kanban;
- tarefas;
- jobs;
- importação;
- exportação;
- backup;
- integrações;
- roteamento HTTP.

Não é, por si só, o maior gargalo de runtime, mas aumenta o risco e o custo das próximas otimizações.

## Pontos positivos já existentes

- paginação de leads já existe;
- cursor pagination já existe na listagem principal;
- FULLTEXT em `search_text` já existe;
- `email_key` e `phone_key` normalizados e indexados já existem;
- índices de Kanban já existem;
- jobs persistentes já existem;
- retry de MySQL e retry transacional já existem;
- cache curto de resumos já existe;
- exportação já pagina por cursor;
- processo possui graceful shutdown.

Esses itens reduzem o esforço das próximas fases.

## Observabilidade implementada na Fase 0

Novo módulo: `server/performanceMetrics.js`.

### Por request

Registra de forma estruturada:

- método;
- endpoint normalizado, sem IDs dinâmicos;
- status HTTP;
- tempo total;
- tempo SQL acumulado;
- participação do SQL no tempo total;
- quantidade de queries;
- query mais lenta;
- RSS;
- heap usado;
- delta de heap;
- CPU user/system.

Prefixo do log:

```text
[perf.request]
```

### Queries lentas

Registra somente metadados seguros:

- operação SQL, por exemplo `SELECT leads`;
- duração;
- quantidade de linhas retornadas/afetadas;
- endpoint;
- request ID;
- código de erro, quando existir.

Não registra SQL completo nem parâmetros.

Prefixo:

```text
[perf.sql]
```

Classificação padrão:

- >= 200 ms: slow;
- >= 500 ms: very_slow;
- >= 1000 ms: critical.

### Runtime e pool

A cada 30 segundos registra:

- RSS;
- heap usado/total;
- CPU aproximada do processo;
- event loop mean/p95/max;
- conexões do pool;
- conexões livres;
- fila pendente do pool.

Prefixo:

```text
[perf.runtime]
```

## Variáveis opcionais

```env
PERF_OBSERVABILITY_ENABLED=1
PERF_REQUEST_SAMPLE_RATE=1
PERF_SLOW_SQL_MS=200
PERF_REQUEST_WARN_MS=800
PERF_LOG_ALL_REQUESTS=1
PERF_RUNTIME_INTERVAL_MS=30000
```

Para baseline, usar `PERF_REQUEST_SAMPLE_RATE=1` e `PERF_LOG_ALL_REQUESTS=1` por uma janela controlada.

Depois do baseline, a amostragem pode ser reduzida para diminuir volume de logs.

### Gerar relatório agregado

Os logs estruturados podem ser convertidos em uma tabela de p50/p95/p99, SQL p95, quantidade de queries e runtime com:

```bash
npm run perf:report -- /caminho/pm2.log --output PERFORMANCE_RUNTIME_REPORT.md
```

O script ignora linhas que não sejam da telemetria de performance.

## Como obter o baseline real em produção/staging

Executar uma janela controlada com tráfego representativo e coletar, no mínimo:

- `/api/leads`;
- `/api/leads/summary`;
- `/api/leads/opportunities/summary`;
- `/api/kanban/board`;
- `/api/tasks/today` ou dashboard equivalente;
- busca de leads;
- criação/edição de lead;
- operação durante importação.

Para cada endpoint registrar:

| Endpoint | p50 | p95 | p99 | SQL p95 | Queries/request | Payload | Erros |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Leads | pendente | pendente | pendente | pendente | pendente | pendente | pendente |
| Busca | pendente | pendente | pendente | pendente | pendente | pendente | pendente |
| Kanban | pendente | pendente | pendente | pendente | pendente | pendente | pendente |
| Dashboard | pendente | pendente | pendente | pendente | pendente | pendente | pendente |
| Oportunidades | pendente | pendente | pendente | pendente | pendente | pendente | pendente |

## Critérios para avançar à Fase 1

A Fase 1 pode começar no código com os quick wins já confirmados, mas qualquer alegação de melhoria percentual deve ser feita somente após capturar o baseline real.

Ordem recomendada:

1. projeções enxutas para lista e Kanban;
2. separar summary/detail de lead;
3. eliminar `SELECT *` das rotas críticas;
4. revisar requests duplicados;
5. medir novamente;
6. então iniciar materialização da inteligência comercial.
