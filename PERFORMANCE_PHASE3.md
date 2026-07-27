# PERFORMANCE PHASE 3 — Resumos e Dashboards

## FASE 3 CONCLUÍDA

### Objetivo

Depois da materialização da inteligência comercial da Fase 2, reduzir scans redundantes sobre `leads` nas telas de resumo, mapa de oportunidades e administração, preservando o contrato das APIs e o fallback legado durante o backfill.

Esta fase não altera regras comerciais e não cria migration.

---

## Problemas encontrados

### 1. Resumo de leads e oportunidades faziam scans separados

A Fase 2 eliminou o custo de centenas de `JSON_EXTRACT` quando o backfill está pronto, porém os widgets continuavam usando agregações independentes:

- `Lead Summary`
- `Opportunity Summary`

Cada uma percorria o mesmo escopo autorizado de leads.

### 2. Mapa de oportunidades repetia agregações

No carregamento sem filtro, o fluxo anterior podia executar:

1. `COUNT(*)` da paginação
2. `SELECT` dos cards
3. resumo global de oportunidades
4. resumo filtrado de oportunidades

Mesmo sem filtro ativo, o resumo filtrado era equivalente ao resumo do escopo e ainda era recalculado.

### 3. Painel administrativo contava duplicados duas vezes

Ao abrir Administração, eram disparados em paralelo:

- `/api/admin/leads/overview`
- `/api/leads/duplicates`

O overview calculava `duplicateGroups`, enquanto o endpoint de duplicados calculava o mesmo total novamente para a paginação.

Como a contagem de duplicados é formada por três agregações (`email_key`, `phone_key`, `name_company_key`) unidas por `UNION ALL`, essa duplicidade é especialmente cara em bases grandes.

---

## Solução implementada

### 1. Snapshot agregado único

Criado:

`server/dashboardSummarySql.js`

Nova função:

`buildLeadDashboardSummarySql()`

Ela calcula, em um único `SELECT`/scan:

#### Resumo operacional

- total
- ativos
- follow-ups vencidos
- alta prioridade
- sem responsável
- sem próximo passo
- leads quentes
- oportunidades com agência
- precisa de mapeamento
- expansão
- lixeira

#### Resumo de oportunidades

- total
- expansão
- migração
- mapeamento
- alta oportunidade
- outra agência
- sem diagnóstico
- mapeamento crítico
- totais por status dos serviços

A resposta é separada novamente nos contratos já existentes por:

`mapLeadDashboardSummaryRow()`

Nenhuma tela precisa conhecer a consolidação interna.

---

## 2. Cache compartilhado

Antes existiam caches independentes para:

- lead summary
- opportunity summary

Agora existe um snapshot compartilhado por escopo.

Consequência:

Se `/api/leads/summary` for consultado e logo depois `/api/leads/opportunities/summary`, a segunda rota reutiliza o mesmo snapshot dentro do TTL.

A invalidação continua usando o fluxo existente de mutações de lead.

Não foi introduzido cache novo para esconder SQL ruim. Apenas os dois caches anteriores foram consolidados.

---

## 3. Paginação reaproveita o snapshot

Quando a listagem solicita resumo operacional ou de oportunidades, o total de paginação passa a vir do snapshot agregado.

Portanto o `COUNT(*)` separado é eliminado nesses cenários.

### Sem filtros ativos

O snapshot do próprio escopo também é reutilizado como resumo filtrado.

Não existe motivo para recalcular uma agregação equivalente.

### Com filtros ativos

É executado somente um snapshot filtrado para produzir simultaneamente:

- total filtrado
- filtered summary
- filtered opportunity summary

---

## Redução estrutural de queries

### Mapa de oportunidades sem filtro

#### Cache frio

Antes:

```text
COUNT paginação
+ SELECT cards
+ Opportunity Summary escopo
+ Opportunity Summary filtrado
= até 4 queries
```

Depois:

```text
Dashboard Snapshot escopo
+ SELECT cards
= 2 queries
```

Redução estrutural: **50%**.

#### Cache quente

Antes:

```text
COUNT paginação
+ SELECT cards
+ Opportunity Summary filtrado
= 3 queries
```

Depois:

```text
SELECT cards
= 1 query
```

Redução estrutural: **66,7%**.

### Mapa com filtros ativos

Cache frio:

```text
4 → 3 queries
```

Redução: **25%**.

Cache quente:

```text
3 → 2 queries
```

Redução: **33,3%**.

### Endpoints de resumo em sequência

Antes:

```text
Lead Summary = 1 scan
Opportunity Summary = 1 scan
```

Depois, dentro do TTL:

```text
Dashboard Snapshot = 1 scan
segunda rota = cache
```

Redução: **50% nos scans agregados**.

Esses números representam quantidade estrutural de queries no código. Não representam p95 de produção.

---

## Complexidade SQL

Após o backfill da Fase 2:

- SQL materializado do Lead Summary anterior: 1.840 caracteres
- SQL materializado do Opportunity Summary anterior: 1.030 caracteres
- total dos dois SQLs separados: 2.870 caracteres
- snapshot consolidado: 3.141 caracteres
- `JSON_EXTRACT` no snapshot materializado: **0**

O SQL consolidado é ligeiramente maior porque contém todas as métricas, porém substitui dois scans pela mesma leitura da tabela.

Enquanto o backfill da Fase 2 não estiver concluído, o fallback legado continua funcional. Nesse modo, o snapshot contém as mesmas regras JSON legadas e o ganho máximo desta fase ainda não é alcançado.

---

## 4. Duplicados no painel administrativo

O endpoint administrativo agora aceita:

`includeDuplicates=0`

A compatibilidade foi preservada:

- sem parâmetro: comportamento antigo permanece
- `includeDuplicates=0`: pula a contagem pesada de duplicados

O frontend de Administração usa `includeDuplicates=0` porque já carrega `/api/leads/duplicates` ao mesmo tempo.

O total exibido em `adminOverview.duplicateGroups` passa a ser preenchido pela própria paginação dos duplicados.

Resultado:

- uma contagem redundante de grupos duplicados eliminada por carregamento da Administração
- cada contagem eliminada evitava três agregações agrupadas sobre as chaves de deduplicação

---

## Banco de dados

### Migration

Nenhuma.

### Schema

Nenhuma alteração.

### Índices

Nenhum índice novo.

A criação de índices adicionais continua adiada até `EXPLAIN ANALYZE` com a base real, conforme a estratégia do projeto.

---

## Arquivos modificados

- `server/index.js`
- `src/utils/api.ts`
- `src/components/SettingsCenter.tsx`

## Arquivos criados

- `server/dashboardSummarySql.js`
- `server/dashboardSummarySql.test.js`
- `server/phase3DashboardAggregation.test.js`
- `PERFORMANCE_PHASE3.md`

---

## Testes

### Suíte focada inicial

35/35 aprovados.

Cobertura:

- observabilidade
- quick wins da Fase 1
- materialização da Fase 2
- regras de oportunidades
- lead summary
- snapshot consolidado
- cache compartilhado
- wiring do overview administrativo

### Suíte ampla

```text
182/186 aprovados
```

As 4 falhas são ambientais por dependências ausentes no pacote de trabalho:

- `fflate`: 2 testes
- `mysql2`: 1 teste de integração
- `exceljs`: 1 teste de exportação XLSX

Nenhum teste funcional ou arquitetural relacionado à Fase 3 falhou.

Também foi executado `node --check` no backend alterado.

---

## Antes / Depois

Não foram inventados valores de latência.

O ambiente utilizado nesta execução não está conectado ao MySQL de produção nem à base real de 133 mil leads.

As medições reais devem ser feitas com a observabilidade da Fase 0.

### Medir principalmente

```text
GET /api/leads?opportunitySummary=1
GET /api/leads/summary
GET /api/leads/opportunities/summary
GET /api/admin/leads/overview?includeDuplicates=0
GET /api/leads/duplicates
```

Comparar:

- p50
- p95
- SQL p95
- queries por request
- rows examined
- pool pending
- CPU MySQL

---

## Sequência recomendada de implantação

### 1. Confirmar Fase 2

Preferencialmente:

```bash
npm run commercial-profile:verify
```

Esperado:

```text
pending: 0
```

A Fase 3 continua compatível se ainda houver backfill pendente, mas a performance máxima depende da materialização completa.

### 2. Substituir arquivos da Fase 3

Aplicar sobre o repositório da Fase 2.

### 3. Reiniciar API/frontend

Não existe migration nesta fase.

### 4. Smoke test

Validar:

- lista de leads
- indicadores operacionais
- mapa de oportunidades
- filtros do mapa
- Administração > Resumo
- Administração > Duplicados

### 5. Comparar observabilidade

Usar os logs e `npm run perf:report` da Fase 0.

---

## Riscos

### Principal risco

Divergência entre o resumo consolidado e os dois contratos antigos.

Mitigação:

- os aliases antigos foram preservados
- o mapeamento final reutiliza `mapLeadSummaryRow()` e `mapOpportunitySummaryRow()`
- testes verificam os dois contratos

### Cache

O snapshot compartilhado tem a mesma janela de cache configurada anteriormente por `LEAD_SUMMARY_CACHE_MS`.

As mutações continuam chamando a mesma função de invalidação.

---

## Próxima fase

**FASE 4 — Otimização completa da busca**

Prioridades:

- telefone normalizado/indexado
- e-mail normalizado/indexado
- FULLTEXT como caminho principal
- remover `LIKE '%texto%'` e `CAST(JSON AS CHAR)` do caminho normal
- fallback amplo somente quando necessário
- medir comportamento com 133 mil+ leads
