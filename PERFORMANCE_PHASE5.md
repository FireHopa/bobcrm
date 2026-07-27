# PERFORMANCE_PHASE5.md

# FASE 5 — KANBAN

## Status

Concluída em 23/07/2026.

Esta fase otimiza o carregamento do Kanban sem alterar regras comerciais, permissões, schema do banco ou comportamento de movimentação de cards.

---

## 1. Problema encontrado

O carregamento inicial do board executava consultas individualmente para cada etapa.

Fluxo anterior do endpoint `/api/kanban/board`:

```text
buscar pipeline
+
buscar etapas
+
contagem geral por etapa
+
para cada etapa:
    COUNT filtrado
    +
    SELECT dos primeiros cards
```

Com 9 etapas, somente o endpoint do board podia executar aproximadamente:

```text
3 consultas fixas
+
9 COUNT
+
9 SELECT
=
21 consultas principais
```

Além disso, antes de carregar o board, `/api/kanban/pipelines` executava quatro consultas próprias:

```text
pipelines
stages
counts por pipeline
counts por stage
```

Portanto, numa abertura típica com 9 etapas, sem considerar consultas auxiliares de autenticação/escopo, o caminho principal podia chegar a aproximadamente 25 consultas de aplicação.

---

## 2. Causa

O backend tratava cada coluna do Kanban como uma paginação independente já no carregamento inicial.

Isso gerava N+1 de consultas e multiplicava:

- round-trips Node.js ↔ MySQL
- espera por conexão no pool
- parsing de SQL
- agregações separadas
- overhead de serialização
- tempo acumulado por etapa

O número de queries crescia linearmente com a quantidade de colunas.

---

## 3. Solução implementada

### 3.1 Lista de funis consolidada

`GET /api/kanban/pipelines` passou de quatro consultas principais para uma consulta consolidada.

A nova consulta usa CTEs para calcular:

- cards por pipeline
- cards por etapa
- pipelines ativos
- etapas ativas

Tudo é reconstruído no Node a partir de um único result set.

### 3.2 Board inicial em duas queries principais

O endpoint `/api/kanban/board` passou a usar:

```text
1 query de metadata
+
1 query de cards
```

A query de metadata resolve:

- pipeline solicitado ou pipeline padrão
- etapas ativas
- contagem total do pipeline
- contagem total por etapa

A query de cards utiliza MySQL 8:

```sql
ROW_NUMBER() OVER (
    PARTITION BY pipeline_stage_id
    ORDER BY kanban_position ASC, updated_at DESC, created_at DESC, id ASC
)
```

junto com:

```sql
COUNT(*) OVER (PARTITION BY pipeline_stage_id)
```

Assim, uma única consulta retorna os primeiros N cards de todas as etapas e também o total filtrado de cada coluna.

### 3.3 Paginação por coluna preservada

O board continua carregando somente os primeiros cards de cada coluna.

O frontend mantém:

```text
primeiros N cards
+
total filtrado
+
Carregar mais
```

O endpoint de `load more` também foi reduzido: o `COUNT` separado saiu do caminho normal e o total passa a vir de `COUNT(*) OVER()` na mesma consulta dos cards.

---

## 4. Queries antes e depois

### `/api/kanban/pipelines`

Antes:

```text
4 queries principais
```

Depois:

```text
1 query principal
```

Redução estrutural:

```text
75%
```

### `/api/kanban/board`

Para 9 etapas, sem busca textual ativa:

Antes:

```text
21 queries principais
```

Depois:

```text
2 queries principais
```

Redução estrutural:

```text
90,5%
```

### Abertura típica completa do Kanban

Considerando `/api/kanban/pipelines` + `/api/kanban/board`, com 9 etapas:

Antes:

```text
25 queries principais
```

Depois:

```text
3 queries principais
```

Redução estrutural:

```text
88%
```

Quando existe busca textual, o mecanismo da Fase 4 pode executar uma query adicional de probe para decidir entre busca indexável e fallback.

Consultas auxiliares de autenticação e resolução de escopo não entram nesta comparação porque existem nos dois cenários e dependem do papel do usuário.

---

## 5. Índice existente aproveitado

O schema já possui:

```sql
INDEX idx_leads_pipeline_stage (
    deleted_at,
    pipeline_id,
    pipeline_stage_id,
    kanban_position
)
```

Nenhum novo índice foi criado nesta fase.

A decisão é intencional: índices adicionais devem ser avaliados com `EXPLAIN ANALYZE` sobre a base real na Fase 9, evitando indexação preventiva.

---

## 6. Arquivos modificados

```text
server/index.js
server/phase1QuickWins.test.js
```

Arquivos criados:

```text
server/kanbanBoardSql.js
server/phase5KanbanPerformance.test.js
PERFORMANCE_PHASE5.md
```

---

## 7. Banco

Nenhuma migration.

Nenhuma coluna adicionada ou removida.

Nenhum índice criado ou removido.

Nenhuma alteração destrutiva.

---

## 8. Regras preservadas

Foram preservados:

- pipelines
- etapas
- permissões
- escopo de carteira
- filtros
- pesquisa
- WIP limit
- drag and drop
- movimentação de cards
- status de ganho/perda
- paginação por coluna
- card count
- criação/edição/remoção de etapas
- criação/edição de funis
- auditoria

---

## 9. Testes

### Testes focados

Executados testes das Fases 0 a 5 e regras relacionadas a leads/permissões.

Resultado:

```text
62 / 62 aprovados
```

### Suíte ampla

Resultado:

```text
196 / 200 aprovados
```

As quatro falhas restantes são ambientais e não relacionadas à Fase 5:

```text
fflate ausente em 2 testes
mysql2 ausente em 1 teste
exceljs ausente em 1 teste
```

### Sintaxe

Todos os arquivos `.js` e `.mjs` de `server/` e `scripts/` passaram em `node --check`.

---

## 10. Riscos e validação em produção

A query de cards usa window functions do MySQL 8.

Ela reduz drasticamente round-trips e consultas, porém a performance real depende de:

- distribuição dos leads entre etapas
- filtros aplicados
- quantidade de cards no pipeline
- seletividade do índice
- memória disponível no MySQL
- uso de temporary tables / filesort

Portanto, não foi inventado p95 neste ambiente.

Após deploy, medir com a observabilidade da Fase 0:

```text
GET /api/kanban/pipelines
GET /api/kanban/board
GET /api/kanban/stages/:id/cards
```

E posteriormente executar `EXPLAIN ANALYZE` na Fase 9.

Meta do projeto para Kanban inicial:

```text
p95 < 900 ms
```

---

## 11. Critério de sucesso desta fase

A fase é considerada estruturalmente concluída porque:

- N+1 por etapa foi removido do board inicial
- `COUNT + SELECT` isolado por coluna deixou de existir
- primeiros N cards continuam paginados por etapa
- contagens filtradas continuam disponíveis
- lista de pipelines foi consolidada
- nenhum payload pesado foi reintroduzido
- nenhuma regra comercial foi alterada
- testes focados ficaram 100% verdes

---

## 12. Próxima fase

FASE 6 — separação de workers.

Objetivo:

```text
bobcrm-api
+
bobcrm-worker
```

Separar da API os workloads pesados como importação, exportação, backup, rebuilds e outros jobs, evitando event loop blocking e disputa desnecessária pelo pool MySQL durante o uso do CRM.
