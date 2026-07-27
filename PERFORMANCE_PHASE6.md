# PERFORMANCE_PHASE6.md

# FASE 6 — SEPARAÇÃO DE WORKERS

## Status

Concluída em 23/07/2026.

A Fase 6 separa o atendimento HTTP da execução dos jobs pesados sem reescrever o BobCRM e sem alterar regras comerciais ou schema.

## Problema encontrado

Na versão da Fase 5 o PM2 iniciava apenas um processo:

```text
crm-casa-ads-api
server/index.js
instances: 1
exec_mode: fork
```

O mesmo processo executava:

- API HTTP
- importações
- exportações CSV/XLSX
- backup MySQL
- rebuild do índice de busca
- limpeza de artifacts dos jobs

O worker persistente já existia, mas era iniciado dentro do mesmo processo da API.

Consequência: trabalho pesado podia competir diretamente com requests HTTP por CPU, event loop, memória e conexões do mesmo pool MySQL.

## Causa

O bootstrap anterior executava obrigatoriamente:

```text
initializeDatabase()
startPersistentJobWorker()
start HTTP server
```

Não existia conceito de papel do processo.

O pool MySQL também era único:

```text
MYSQL_CONNECTION_LIMIT=10
```

Portanto API e jobs compartilhavam o mesmo orçamento de conexões.

## Solução implementada

### 1. Papéis explícitos do processo

Foram criados três modos:

```text
PROCESS_ROLE=combined
PROCESS_ROLE=api
PROCESS_ROLE=worker
```

`combined` mantém compatibilidade para execução direta/local.

No PM2 de produção são usados exclusivamente:

```text
crm-casa-ads-api    -> PROCESS_ROLE=api
crm-casa-ads-worker -> PROCESS_ROLE=worker
```

### 2. API isolada

O processo `api` executa:

- HTTP
- autenticação
- rotas
- webhooks
- sessões/rate limit
- migrations e bootstrap de schema
- readiness da inteligência comercial

Ele NÃO inicia `startPersistentJobWorker()`.

### 3. Worker isolado

O processo `worker` executa:

- importações
- exportações
- backups
- rebuild de `search_text`
- retenção/limpeza dos artifacts dos jobs

Ele NÃO abre porta HTTP e NÃO executa migrations ou seeds.

O worker verifica apenas se as tabelas mínimas necessárias já existem:

```text
async_jobs
leads
users
backups
```

Se o deploy iniciar o worker antes da API terminar uma atualização de schema, ele falha com `WORKER_SCHEMA_NOT_READY` e o PM2 pode reiniciá-lo sem duas instâncias tentando migrar o banco simultaneamente.

### 4. Pools MySQL independentes

Modo antigo:

```text
API + jobs -> pool compartilhado = 10
```

Novo padrão no PM2:

```text
API    -> MYSQL_API_CONNECTION_LIMIT=8
Worker -> MYSQL_WORKER_CONNECTION_LIMIT=2
TOTAL padrão = 10
```

Isso preserva o orçamento padrão anterior de 10 conexões, mas reserva 80% para requests interativos e limita o worker a 20%.

Os valores são configuráveis por ambiente e NÃO devem ser aumentados sem medir fila, CPU MySQL e slow queries.

O modo `combined` continua usando:

```text
MYSQL_CONNECTION_LIMIT=10
```

### 5. Worker standalone permanece vivo

O polling do worker anteriormente usava timers com `unref()`, o que era seguro porque o HTTP server mantinha o processo vivo.

No processo standalone isso poderia permitir que o Node encerrasse quando o worker estivesse ocioso.

`createJobWorker()` agora aceita:

```text
unrefTimers
```

No modo worker:

```text
unrefTimers = false
```

No modo combinado continua compatível com o comportamento anterior.

### 6. Readiness da API

A API separada não depende de um worker local para retornar ready.

Ela reporta:

```text
processRole: api
worker: null
workerMode: external
```

A disponibilidade HTTP não é derrubada apenas porque o processo externo de worker está sendo reiniciado. O estado do worker deve ser monitorado pelo PM2.

## Arquivos modificados

```text
ecosystem.config.cjs
package.json
server/.env.example
server/ecosystem.config.cjs
server/index.js
server/jobQueue.js
```

## Arquivos novos

```text
server/runtimeRole.js
server/runtimeRole.test.js
server/phase6WorkerIsolation.test.js
PERFORMANCE_PHASE6.md
```

## Banco

Nenhuma migration.

Nenhuma coluna criada/removida.

Nenhum índice criado/removido.

Nenhuma alteração destrutiva.

## Antes

```text
PM2 processes: 1
HTTP process: crm-casa-ads-api
Worker: dentro do processo HTTP
Pool padrão compartilhado: 10
Isolamento de event loop: não
Isolamento de memória: não
Isolamento do pool: não
```

## Depois

```text
PM2 processes: 2
HTTP process: crm-casa-ads-api
Worker process: crm-casa-ads-worker
API pool padrão: 8
Worker pool padrão: 2
Total padrão: 10
Isolamento de event loop: sim
Isolamento de memória: sim
Isolamento do pool: sim
```

## Impacto esperado

A mudança não promete um percentual fictício de p95 sem o servidor real.

O ganho estrutural é que importação, exportação, backup e rebuild deixam de executar no mesmo event loop da API. Mesmo com um job pesado ativo, a API passa a possuir processo e orçamento de pool próprios.

O efeito real deve ser medido com a observabilidade da Fase 0 nos cenários:

```text
20 usuários navegando sem importação
20 usuários navegando + importação ativa
20 usuários navegando + exportação ativa
20 usuários navegando + backup ativo
```

Comparar principalmente:

- p95 HTTP
- eventLoopDelay da API
- RSS/heap da API
- tempo esperando conexão MySQL
- queries/request
- fila do pool da API

## Testes executados

### Fase 6 focada

```text
13/13 aprovados
```

Cobre:

- papéis `combined/api/worker`
- PM2 com dois processos
- worker sem HTTP
- worker sem migrations
- API sem worker local
- pools independentes 8/2
- schema mínimo do worker
- readiness com worker externo
- polling referenciado no worker standalone
- fila, heartbeat, retry e drain existentes

### Regressão Fases 0–6

Seleção crítica executada:

```text
46/46 aprovados
```

Incluiu observabilidade, quick wins, inteligência materializada, dashboards, busca, Kanban, job queue e isolamento do worker.

### Teste arquitetural legado

```text
5/5 aprovados
```

O limite existente de tamanho de `server/index.js` também permanece atendido:

```text
5598 linhas (< 5600)
```

### Suíte ampla

```text
202/206 aprovados
```

As 4 falhas são ambientais e não regressões da Fase 6:

```text
fflate ausente -> 2 falhas
mysql2 ausente -> 1 falha
exceljs ausente -> 1 falha
```

### Sintaxe

Todos os `.js` e `.mjs` em `server/` e `scripts/` passaram em `node --check`.

O ecosystem PM2 também foi carregado e validado com os dois apps:

```text
crm-casa-ads-api:api
crm-casa-ads-worker:worker
```

## Riscos

### 1. Worker parado

A API continua disponível, mas jobs permanecem `queued` até o worker voltar.

Mitigação:

```bash
pm2 status
pm2 logs crm-casa-ads-worker
```

### 2. Pool do worker muito pequeno

O padrão 2 foi escolhido para proteger a API e preservar o teto total anterior.

Não aumentar automaticamente. Medir primeiro.

### 3. Deploy antigo usando somente `node server/index.js`

Continua funcionando porque o default é:

```text
PROCESS_ROLE=combined
```

### 4. PM2 e `.env`

O ecosystem define apenas o papel do processo. Limites e credenciais continuam configuráveis no `.env`.

## Procedimento recomendado de deploy

### 1. Substituir os arquivos da Fase 6

Aplicar sobre a Fase 5.

### 2. Revisar `.env`

Recomendado manter inicialmente:

```env
MYSQL_CONNECTION_LIMIT=10
MYSQL_API_CONNECTION_LIMIT=8
MYSQL_WORKER_CONNECTION_LIMIT=2
JOB_WORKER_CONCURRENCY=2
```

Não é necessário definir `PROCESS_ROLE` no `.env` para o PM2, porque cada app recebe o papel pelo ecosystem.

### 3. Recarregar PM2

```bash
cd /var/www/crm-casa-ads
pm2 startOrReload ecosystem.config.cjs --update-env
```

### 4. Conferir processos

```bash
pm2 status
```

Esperado:

```text
crm-casa-ads-api       online
crm-casa-ads-worker    online
```

### 5. Conferir logs

```bash
pm2 logs crm-casa-ads-api --lines 100
pm2 logs crm-casa-ads-worker --lines 100
```

A API deve informar:

```text
Process role: api
pool: 8
```

O worker deve informar:

```text
worker iniciado sem servidor HTTP
Process role: worker
pool: 2
Worker persistente: concorrência 2
```

### 6. Conferir health da API

```bash
curl http://127.0.0.1:3001/health/ready
```

O esperado é status HTTP 200 e indicação de worker externo.

### 7. Testar um job

Criar uma exportação pequena ou importação controlada e confirmar:

```text
queued -> running -> completed
```

No mesmo período, observar se a API continua respondendo normalmente.

## Rollback operacional

Não existe rollback de banco porque não houve migration.

Em emergência, é possível voltar temporariamente ao processo único alterando o ecosystem para a configuração anterior ou executando:

```text
PROCESS_ROLE=combined
```

Isso preserva compatibilidade, embora volte a compartilhar recursos entre API e worker.

## Critério da Fase 6

Atendido estruturalmente:

- API e jobs em processos diferentes
- jobs pesados fora do event loop HTTP
- pools independentes
- worker limitado
- migrations apenas na API
- compatibilidade com modo combinado
- graceful shutdown mantido
- retry/heartbeat/recuperação mantidos
- nenhuma regra comercial alterada
- nenhuma migration nova

## Próxima fase

FASE 7 — importação em alta escala.

A próxima etapa deve atacar a quantidade de persistências individuais e a transação grande ainda existente na importação, utilizando batches com commits controlados e deduplicação em lote.
