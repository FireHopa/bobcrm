# PERFORMANCE PHASE 4 — OTIMIZAÇÃO COMPLETA DA BUSCA

Data: 23/07/2026

## Objetivo

Eliminar o caminho padrão de busca baseado em muitos `LIKE '%texto%'`, `LOWER(...)` e conversões de JSON, priorizando os índices já existentes em `phone_key`, `email_key` e `search_text`.

A Fase 4 preserva a busca ampla como fallback, mas ela só é ativada quando o caminho otimizado não encontra nenhum resultado relevante dentro do mesmo escopo e filtros do usuário.

---

## Diagnóstico confirmado antes da alteração

A busca principal de leads misturava em uma única condição:

- `MATCH(search_text) AGAINST (...)`
- `phone_key LIKE '%...%'`
- `email_key LIKE '%...%'`
- `LOWER(search_text) LIKE '%...%'`
- `LIKE '%...%'` em 13 colunas comuns
- `CAST(custom_fields AS CHAR)`
- `CAST(service_status_map AS CHAR)`

Na prática, mesmo quando o FULLTEXT podia resolver a busca, o MySQL ainda precisava avaliar os demais caminhos por causa do grande `OR`.

A busca de inclusão de leads no Kanban também repetia `LIKE '%...%'` em `search_text`, nome, empresa, e-mail e telefone.

---

## Solução implementada

### 1. Planejador de busca por tipo de entrada

Foi criado:

`server/domains/leads/leadSearchSql.js`

A busca agora classifica o termo e seleciona uma estratégia.

### Telefone

Caminho principal:

```sql
phone_key LIKE '5511988887777%'
```

Esse formato permite usar o índice existente.

Somente quando não existe resultado no prefixo, o sistema usa:

```sql
phone_key LIKE '%5511988887777%'
```

Isso mantém compatibilidade com telefones salvos com ou sem DDI.

### E-mail

Caminho principal:

```sql
email_key LIKE 'cliente@exemplo.com%'
```

Fallback somente sem resultado:

```sql
email_key LIKE '%cliente@exemplo.com%'
```

### Texto

Para termos compatíveis com FULLTEXT:

```sql
MATCH(search_text) AGAINST (? IN BOOLEAN MODE)
```

O backend faz primeiro um probe leve:

```sql
SELECT 1
FROM leads
WHERE <escopo + filtros>
  AND MATCH(search_text) AGAINST (? IN BOOLEAN MODE)
LIMIT 1
```

Se houver resultado, todas as consultas seguintes usam somente o caminho FULLTEXT.

Se não houver resultado, o fallback amplo é liberado.

### Termos curtos

Termos que não podem ser aproveitados de forma confiável pelo FULLTEXT entram diretamente no fallback.

---

## 2. Fallback sem JSON CAST

O fallback não usa mais:

```sql
CAST(custom_fields AS CHAR)
CAST(service_status_map AS CHAR)
```

Esses dados já fazem parte do `search_text` materializado.

O fallback textual utiliza `search_text` e, somente para registros antigos ainda sem `search_text`, algumas colunas leves de compatibilidade:

- name
- company
- email
- source
- responsible

Assim a busca continua funcional durante o backfill sem voltar a converter JSON em cada request.

---

## 3. Busca do Kanban unificada

O endpoint:

`GET /api/kanban/leads/search`

não possui mais uma implementação paralela baseada em vários `LIKE`.

Agora reutiliza o mesmo planejador da listagem principal.

Isso evita divergência de comportamento e duplicação de lógica SQL.

---

## 4. Rebuild do search_text em batch

Antes, para um lote padrão de 750 leads, o worker fazia aproximadamente:

```text
1 SELECT
+
750 UPDATE individuais
```

Agora:

```text
1 SELECT
+
1 UPDATE em batch
```

Foi criado:

`server/domains/leads/leadSearchIndex.js`

O batch usa uma tabela derivada e atualiza os registros do lote em uma única operação SQL.

Isso reduz em aproximadamente 99,87% a quantidade de `UPDATE` statements por lote de 750 registros.

---

## 5. Script explícito de backfill

Foi criado:

`scripts/backfill-search-index.mjs`

Comandos:

```bash
npm run search-index:verify
```

Mostra:

- total
- ready
- pending
- existência do índice FULLTEXT

Para preencher somente registros sem `search_text`:

```bash
npm run search-index:backfill -- --batch-size=250 --pause-ms=25
```

Para reconstruir todos os registros deliberadamente:

```bash
npm run search-index:backfill -- --force-all --batch-size=250 --pause-ms=25
```

`--force-all` deve ser usado apenas quando houver motivo para reconstruir toda a base.

---

# Comparação estrutural

## Busca principal de texto

### Antes

Uma pesquisa textual podia combinar aproximadamente 17 predicados de busca em `OR` no mesmo request:

- FULLTEXT
- LIKE em `search_text`
- 15 fallbacks de coluna, incluindo 2 casts de JSON

### Depois, caminho normal

```text
Probe: 1 predicado FULLTEXT + LIMIT 1
Consulta real: 1 predicado FULLTEXT
```

O fallback pesado deixa de participar de todas as buscas que já possuem resultado pelo índice.

## JSON

Antes:

```text
CAST(custom_fields AS CHAR): 1 no caminho de busca
CAST(service_status_map AS CHAR): 1 no caminho de busca
```

Depois:

```text
0
0
```

## Kanban / inclusão de leads

Antes:

```text
até 5 condições LIKE em OR
```

Depois:

```text
1 estratégia compartilhada e indexável no caminho principal
```

---

# Banco de dados

Nenhuma migration nova foi necessária.

A Fase 4 utiliza estruturas já existentes:

```sql
INDEX idx_leads_search_email (deleted_at, email_key)
INDEX idx_leads_search_phone (deleted_at, phone_key)
FULLTEXT INDEX ft_leads_search_text (search_text)
```

Nenhuma coluna foi removida.
Nenhum índice foi removido.
Nenhuma alteração destrutiva foi realizada.

---

# Arquivos modificados/criados

## Modificados

- `server/index.js`
- `package.json`

## Criados

- `server/domains/leads/leadSearchSql.js`
- `server/domains/leads/leadSearchSql.test.js`
- `server/domains/leads/leadSearchIndex.js`
- `server/domains/leads/leadSearchIndex.test.js`
- `server/phase4SearchOptimization.test.js`
- `scripts/backfill-search-index.mjs`
- `PERFORMANCE_PHASE4.md`

---

# Testes

## Testes focados da Fase 4 e regressões anteriores

```text
34/34 aprovados
```

Cobertura inclui:

- classificação telefone/e-mail/texto
- FULLTEXT
- fallback
- ausência de JSON CAST
- busca do Kanban
- batch do search_text
- índices esperados
- Fase 1
- Fase 2
- Fase 3
- observabilidade

## Suíte ampla

```text
192/196 aprovados
```

As quatro falhas são ambientais e independentes da Fase 4:

1. `scripts/create-release.test.mjs`: pacote `fflate` não instalado
2. `scripts/scan-secrets.test.mjs`: pacote `fflate` não instalado
3. `server/integration/http.mysql.test.js`: pacote `mysql2` não instalado
4. teste XLSX: pacote `exceljs` não instalado

O `package.json` já declara essas dependências. O ZIP analisado não contém `node_modules`.

## Sintaxe

Todos os arquivos `.js` e `.mjs` de `server/` e `scripts/` passaram em `node --check`.

---

# Deploy recomendado

1. Aplicar os arquivos da Fase 4 sobre a Fase 3.
2. Instalar dependências no servidor normalmente com o lockfile do projeto, caso ainda não estejam instaladas.
3. Reiniciar a aplicação.
4. Confirmar que o FULLTEXT foi criado pelo boot.
5. Executar:

```bash
npm run search-index:verify
```

6. Se `pending > 0`, executar:

```bash
npm run search-index:backfill -- --batch-size=250 --pause-ms=25
```

7. Executar novamente:

```bash
npm run search-index:verify
```

Resultado esperado:

```text
pending: 0
```

8. Usar a observabilidade da Fase 0 para comparar p95 de busca antes/depois em produção.

---

# Métricas que devem ser acompanhadas em produção

Principalmente:

- `GET /api/leads?search=...`
- `GET /api/kanban/board?search=...`
- `GET /api/kanban/leads/search?...`

Comparar:

- p50
- p95
- p99
- SQL p95
- queries/request
- rows examined no MySQL
- CPU do MySQL
- tempo esperando conexão

Meta do Prompt Mestre:

```text
Busca p95 < 800ms
```

Não foi inventado benchmark de produção nesta fase porque o ambiente de trabalho não contém a base MySQL real de 133 mil leads.

---

# Resultado da Fase 4

A busca deixa de executar o caminho amplo como regra.

Novo fluxo:

```text
usuário pesquisa
↓
classifica termo
↓
telefone → índice phone_key
email → índice email_key
texto → FULLTEXT search_text
↓
existe resultado?
├── sim → continua somente no caminho otimizado
└── não → fallback de compatibilidade
```

Isso prepara a aplicação para bases maiores sem sacrificar a possibilidade de localizar registros por formatos incompletos ou termos não atendidos pelo FULLTEXT.

---

# Próxima fase

FASE 5 — KANBAN

O principal alvo será eliminar o padrão ainda existente de `COUNT + SELECT` por coluna e carregar o board inicial com poucas queries, além de tratar paginação/load more por etapa.
