# PERFORMANCE_PHASE13 — Teste de carga realista

## Objetivo

Substituir o teste de carga permissivo anterior por uma matriz alinhada às metas reais de experiência do BobCRM e validar concorrência, bases grandes e navegação durante importação ativa.

## Problema encontrado

O teste anterior trabalhava com uma base de 133 mil leads, mas aceitava limites de aproximadamente:

- leitura p95 até 10 segundos;
- escrita p95 até 15 segundos.

Esses limites eram incompatíveis com as metas definidas no plano de performance e poderiam permitir uma regressão grave sem falhar o CI.

Além disso, o teste antigo:

- agrupava leituras diferentes em um único p95;
- não media lead detail, Kanban e dashboard com metas próprias;
- não simulava 10, 25, 50 e 100 usuários;
- não validava a arquitetura API + worker separados;
- não media navegação simultânea a uma importação;
- não produzia relatório detalhado em Markdown e JSON;
- não possuía perfil progressivo até 300 mil leads.

## Alterações realizadas

### 1. Metas por cenário

O novo teste reprova quando o p95 ultrapassa:

| Cenário | Meta p95 |
| --- | ---: |
| Lista de leads | 400 ms |
| Detalhe do lead | 300 ms |
| Busca | 800 ms |
| Kanban inicial | 900 ms |
| Dashboard | 800 ms |
| Resumos | 500 ms |
| Criar lead | 700 ms |
| Editar lead | 700 ms |

A taxa de erro padrão permitida por cenário é de no máximo 1%.

### 2. Concorrência

O perfil `standard` e o perfil de CI executam os níveis obrigatórios:

- 10 usuários concorrentes;
- 25 usuários concorrentes;
- 50 usuários concorrentes;
- 100 usuários concorrentes.

Cada cenário recebe amostras suficientes para calcular p50, p95, p99, média, máximo e taxa de erro.

### 3. Bases de teste

Foram criados perfis:

- `smoke`: 10 mil leads;
- `ci`: 133 mil leads;
- `standard`: 133 mil leads;
- `full`: 10 mil, 50 mil, 133 mil e 300 mil leads progressivamente.

O seed é incremental no perfil `full`: a mesma base cresce até o próximo patamar, evitando recriar o banco do zero a cada medição.

### 4. Arquitetura de produção reproduzida

O teste descartável não inicia mais o BobCRM em modo `combined`.

Ele sobe dois processos independentes:

```text
API
PROCESS_ROLE=api
MYSQL_API_CONNECTION_LIMIT=8

Worker
PROCESS_ROLE=worker
MYSQL_WORKER_CONNECTION_LIMIT=2
JOB_WORKER_CONCURRENCY=2
```

Isso reproduz a separação implementada na Fase 6 e mantém orçamento total padrão de 10 conexões.

### 5. Importação ativa + 20 usuários navegando

O teste cria um job real em:

```text
POST /api/leads/import
```

Enquanto o worker processa a importação, 20 usuários virtuais continuam alternando entre:

- lista;
- detalhe;
- busca;
- Kanban;
- dashboard;
- resumos.

São avaliados simultaneamente:

- conclusão do job;
- erros durante a importação;
- p95 da navegação;
- degradação em relação ao baseline imediatamente anterior.

Critérios adicionais:

```text
p95 absoluto durante importação <= 2.000 ms
erros <= 1%
degradação <= 2x em relação ao baseline
job = completed
```

### 6. Relatórios

Uma execução real gera:

```text
LOAD_TEST_REPORT.md
LOAD_TEST_REPORT.json
```

O relatório separa resultados por:

- tamanho da base;
- concorrência;
- endpoint/cenário;
- p50;
- p95;
- p99;
- erros;
- meta;
- PASS/FAIL.

### 7. Modo externo protegido

Também é possível testar um ambiente de staging já implantado:

```bash
LOAD_TEST_BASE_URL=https://staging.exemplo.com \
LOAD_TEST_EMAIL=... \
LOAD_TEST_PASSWORD=... \
node scripts/load-test.mjs --profile=standard
```

Por padrão, o modo externo é somente leitura.

Criação de leads e importação externa só são habilitadas explicitamente com:

```text
LOAD_TEST_ALLOW_WRITES=1
```

Esse modo não deve ser usado contra produção com escrita habilitada.

## Comandos

### Validar configuração sem MySQL

```bash
npm run test:load -- --dry-run
```

### Smoke descartável

```bash
npm run test:load:smoke
```

### Padrão 133 mil leads

```bash
RUN_LOAD_TEST=1 npm run test:load
```

### Matriz completa até 300 mil leads

```bash
npm run test:load:full
```

### Customizado

```bash
RUN_LOAD_TEST=1 node scripts/load-test.mjs \
  --target-leads=50000,133000 \
  --concurrency=10,25,50,100 \
  --requests=120
```

## CI

O workflow de carga agora usa explicitamente:

```text
LOAD_TEST_PROFILE=ci
```

mantendo 133 mil leads, os quatro níveis de concorrência e importação simultânea, mas com volume adequado para execução contínua no GitHub Actions.

## Banco

Nenhuma migration.

Nenhuma alteração de schema, coluna, índice ou dados de produção.

O banco usado pelo modo descartável é criado para o teste e removido ao final.

## Testes executados neste ambiente

### Fase 13 dedicada

15/15 aprovados.

### Regressão focada

36/36 aprovados após correção do contrato arquitetural histórico de 133 mil leads.

### Suíte completa

266/270 aprovados.

As quatro falhas restantes são ambientais e já existiam nas fases anteriores:

- `fflate`: 2;
- `mysql2`: 1;
- `exceljs`: 1.

Nenhuma falha funcional da Fase 13.

## Validação real de p95

Este ambiente não possui `node_modules` nem um servidor MySQL executável com as dependências do projeto. Portanto, não foi possível executar honestamente a matriz HTTP/MySQL e produzir p95 reais aqui.

O `--dry-run` foi executado com sucesso e confirmou o plano padrão:

```text
133.000 leads
10 / 25 / 50 / 100 usuários
100 requests por cenário
5.000 leads no job de importação
20 usuários durante importação
```

Os números reais devem ser produzidos no CI ou em staging com MySQL 8 e `npm ci`. Nenhum p95 foi inventado neste relatório.

## Critério para concluir a Fase 13 no servidor real

Executar o perfil `standard` em staging e confirmar que todos os cenários aparecem como `PASS` em `LOAD_TEST_REPORT.md`.

Para homologação de escala máxima, executar também o perfil `full`, incluindo 300 mil leads.
