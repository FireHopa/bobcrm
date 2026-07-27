# PERFORMANCE_PHASE9 — Índices e EXPLAIN ANALYZE

## Status

Fase 9 implementada no código com gate explícito de evidência para alterações de índice.

Não foi criada migration automática de novos índices nesta fase porque o ambiente de desenvolvimento fornecido não possui conexão com o MySQL real da produção. Criar ou remover índices sem `EXPLAIN ANALYZE` real violaria a metodologia definida para o BobCRM.

## Problema encontrado

O schema já acumulou muitos índices ao longo das fases e da evolução do CRM:

- `leads`: 21 índices/chaves, incluindo FULLTEXT.
- `tasks`: 8 índices/chaves.

Depois da materialização comercial, otimização da busca, Kanban e migração temporal, alguns índices podem ser essenciais, alguns podem ser parcialmente sobrepostos e outros podem se tornar candidatos a revisão. A decisão não deve ser tomada apenas por inspeção estática.

Também foi encontrado um bloqueador concreto na listagem de leads:

```js
const orderExpression = `COALESCE(${sort.column}, '')`;
```

Todas as colunas permitidas por `normalizeLeadSort` são `NOT NULL` no schema. Portanto o `COALESCE` era redundante e envolvia a coluna utilizada no `ORDER BY`, podendo limitar o uso de índices ordenados pelo otimizador.

## Alteração aplicada

A listagem passou a ordenar diretamente pela coluna real:

```js
const orderExpression = sort.column;
```

Não há mudança funcional de ordenação porque os campos permitidos são `NOT NULL` e possuem valor default vazio quando aplicável.

## Ferramenta de EXPLAIN ANALYZE

Foi criado:

```text
scripts/mysql-explain-analyze.mjs
scripts/mysql-explain-core.mjs
```

Comandos:

```bash
npm run mysql:explain:plan
npm run mysql:explain
```

### Modo plan-only

```bash
npm run mysql:explain:plan -- --output=MYSQL_EXPLAIN_PLAN_REPORT.md
```

Executa `EXPLAIN FORMAT=TREE` sem executar as consultas completas.

### Modo EXPLAIN ANALYZE

```bash
npm run mysql:explain -- --max-ms=5000 --output=MYSQL_EXPLAIN_ANALYZE_REPORT.md
```

Executa somente consultas `SELECT` do catálogo da Fase 9 usando `EXPLAIN ANALYZE`.

O script aplica:

```text
MAX_EXECUTION_TIME = 5000ms por padrão
```

O limite pode ser configurado entre 500ms e 30s.

## Proteções

A ferramenta:

- não contém `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE INDEX` ou `DROP INDEX` sobre dados da aplicação;
- não imprime os parâmetros reais usados para busca;
- verifica se a materialização comercial está concluída;
- verifica se o backfill DATETIME está concluído;
- interrompe por padrão se Fase 2 ou Fase 8 estiverem incompletas;
- coleta inventário de índices;
- tenta coletar uso dos índices via Performance Schema;
- continua o relatório se uma query individual atingir timeout;
- não aplica automaticamente recomendações.

## Queries analisadas

O catálogo cobre:

1. listagem padrão de leads;
2. quick filter de prioridade comercial;
3. pipelines/etapas/contagens do Kanban;
4. cards iniciais do Kanban;
5. dashboard consolidado de leads;
6. contadores do Dashboard Hoje;
7. lista de tarefas atrasadas;
8. agenda de tarefas por responsável;
9. busca por prefixo de e-mail;
10. busca por prefixo de telefone;
11. busca FULLTEXT.

Cenários que dependem de dados reais, como pipeline, responsável, e-mail ou telefone, usam uma amostra existente apenas durante a execução. Esses valores não são gravados no relatório.

## Informações coletadas por plano

Para cada query o relatório tenta registrar:

```text
actual time
rows retornadas
work rows aproximado
loops
table scan
index scan
index lookup
index range scan
sort
temporary
índices usados
```

Além disso registra:

```text
TABLE_ROWS estimadas
DATA_LENGTH
INDEX_LENGTH
inventário de índices
reads/writes por índice desde o restart do MySQL, quando Performance Schema estiver disponível
```

## Regra para novos índices

Nenhum índice novo foi adicionado automaticamente nesta fase.

Exemplo de candidato que deve ser validado pelo relatório:

```sql
(deleted_at, updated_at, id)
```

para a listagem padrão.

Ele só deve virar migration se o plano real demonstrar que o índice atual `idx_leads_updated_at` exige volume excessivo de linhas filtradas, filesort relevante ou tempo de execução material.

O mesmo princípio vale para scores comerciais e para qualquer tentativa de ampliar o índice do Kanban.

## Remoção de índices

Nenhum índice existente foi removido.

Um índice com `0 reads` no Performance Schema não é automaticamente inútil, porque:

- os contadores reiniciam com o MySQL;
- a janela observada pode não conter workloads raros;
- migrations, backup, importação ou rotas administrativas podem usar um índice com pouca frequência.

Qualquer remoção futura deve ter:

1. janela representativa de uso;
2. `EXPLAIN ANALYZE` das queries afetadas;
3. migration separada;
4. rollback;
5. benchmark antes/depois.

## CI restaurado

O ZIP completo recebido da Fase 8 não continha `.github/workflows/ci.yml`, embora testes existentes dependam dele.

O workflow foi restaurado com jobs para:

- qualidade e segurança;
- MySQL 8.4 descartável;
- integração HTTP;
- E2E;
- teste de carga com 133 mil leads.

Isso não altera runtime do CRM.

## Testes

### Fase 9

```text
8/8 aprovados
```

### Suíte completa disponível no pacote

```text
225/229 aprovados
```

As 4 falhas são ambientais por dependências não instaladas no diretório de execução:

```text
fflate  -> 2 falhas
mysql2  -> 1 falha
exceljs -> 1 falha
```

Não há falha funcional ou arquitetural da Fase 9.

Também passaram:

```text
node --check scripts/mysql-explain-core.mjs
node --check scripts/mysql-explain-analyze.mjs
node --check server/index.js
```

## Como executar no servidor real

Antes de `EXPLAIN ANALYZE`, confirmar:

```bash
npm run commercial-profile:verify
npm run datetime:verify
```

Primeiro executar apenas o plano estimado:

```bash
npm run mysql:explain:plan -- --output=MYSQL_EXPLAIN_PLAN_REPORT.md
```

Depois, preferencialmente fora do pico:

```bash
npm run mysql:explain -- --max-ms=5000 --output=MYSQL_EXPLAIN_ANALYZE_REPORT.md
```

O relatório real será a evidência para qualquer migration de índice subsequente.

## Banco

- Nenhuma migration nova.
- Nenhum índice criado automaticamente.
- Nenhum índice removido.
- Nenhuma coluna alterada.
- Nenhuma regra comercial alterada.

## Próxima fase

FASE 10 — Cache inteligente.

A Fase 10 deve partir das queries já rápidas e revisar granularidade/invalidação de cache para dashboard, resumos, configurações, pipelines, equipes e metadados, sem usar cache para esconder SQL ruim.
