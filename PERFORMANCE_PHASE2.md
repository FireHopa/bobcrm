# PERFORMANCE PHASE 2 — Materialização da Inteligência Comercial

## FASE 2 CONCLUÍDA

### Objetivo

Remover o recálculo massivo da inteligência comercial em tempo de consulta e transformar scores, contagens e flags comerciais em dados persistidos no lead, mantendo compatibilidade durante a transição.

A Fase 2 não remove a lógica legada imediatamente. O backend opera em dois modos:

1. **Modo legado seguro** enquanto existir qualquer lead sem backfill da versão atual.
2. **Modo materializado** assim que 100% dos leads estiverem com `commercial_profile_version = 1`.

Isso evita exibir métricas incorretas durante uma implantação gradual.

---

## Problema encontrado

As consultas de resumo e filtros recalculavam a inteligência comercial de todos os leads usando muitas extrações de JSON.

Medição estrutural do SQL antes da materialização:

| Consulta | JSON_EXTRACT antes | JSON_EXTRACT depois do backfill | Tamanho SQL antes | Tamanho SQL materializado |
| --- | ---: | ---: | ---: | ---: |
| Oportunidades | 410 | 0 | 58.908 chars | 1.030 chars |
| Resumo de leads | 194 | 0 | 30.396 chars | 1.840 chars |
| Overview administrativo | 88 | 0 | 13.055 chars | 902 chars |
| Filtro `lead-priority` | 94 | 0 | 14.947 chars | 31 chars |

Redução estrutural aproximada do tamanho dessas consultas:

- Oportunidades: **98,25%**
- Resumo de leads: **93,95%**
- Overview administrativo: **93,09%**
- Filtro `lead-priority`: **99,79%**

Esses percentuais representam redução de complexidade/texto SQL, e não p95 medido em produção.

---

## Causa

A regra comercial estava embutida em expressões SQL geradas dinamicamente, com `JSON_EXTRACT()` repetido para cada serviço e novamente para cada métrica derivada.

Ao abrir dashboard, mapa de oportunidades, overview administrativo ou aplicar filtros comerciais, o MySQL precisava reconstruir scores sobre milhares de registros.

---

## Solução implementada

### 1. Fonte única de verdade

Criado:

`server/domains/leads/leadCommercialProfile.js`

Função central:

`calculateLeadCommercialProfile(lead)`

Ela calcula:

- potencial comercial
- urgência de mapeamento
- prioridade do lead
- opportunity score
- quantidade de serviços Casa do Ads
- quantidade com outra agência
- quantidade não realizada
- quantidade desconhecida
- expansão
- migração
- presença de agência externa

A mesma função é utilizada por escrita normal, importação e backfill.

### 2. Campos materializados

Adicionados de forma compatível:

- `commercial_profile_version`
- `commercial_profile_updated_at`
- `commercial_potential_score`
- `mapping_urgency_score`
- `lead_priority_score`
- `opportunity_score`
- `service_casa_count`
- `service_agency_count`
- `service_missing_count`
- `service_unknown_count`
- `has_expansion_opportunity`
- `has_migration_opportunity`
- `has_external_agency`

Nenhuma coluna antiga foi removida ou alterada.

### 3. Novos leads e edições

O `UPSERT` do lead agora grava os campos materializados na mesma persistência do lead.

Não existe uma segunda gravação obrigatória para a operação normal de criar/editar lead.

### 4. Atualizações indiretas

Mudanças de próximo contato originadas por tarefas e encaminhamentos que alteram responsável também atualizam o perfil comercial.

O fechamento em massa de leads de uma etapa atualiza os scores relacionados ao próximo contato com SQL simples, sem reintroduzir `JSON_EXTRACT`.

### 5. Backfill em batches

Criado:

`scripts/backfill-commercial-profile.mjs`

Características:

- batch configurável de 50 a 2.000 registros
- padrão: 500
- commits por batch
- pausa configurável entre batches
- não carrega a base inteira na RAM
- não usa `OFFSET`
- não altera `updated_at` comercial do lead
- pode validar progresso sem escrever
- usa atualização em lote por `UPDATE JOIN`

Comandos:

```bash
npm run commercial-profile:backfill
```

Exemplo mais conservador:

```bash
npm run commercial-profile:backfill -- --batch-size=500 --pause-ms=50
```

Verificação:

```bash
npm run commercial-profile:verify
```

O verify retorna sucesso quando não há registros pendentes.

### 6. Ativação automática

O backend verifica se existe lead com versão materializada diferente da versão atual.

Enquanto houver pendências:

`modo legado`

Quando todos forem atualizados:

`modo materializado`

A checagem ocorre no boot e periodicamente. Padrão:

`COMMERCIAL_PROFILE_READINESS_CHECK_MS=30000`

Portanto não é necessário alterar manualmente uma feature flag após o backfill.

---

## Migration

Migration versionada:

`server/migrations/20260723_09_commercial_profile_materialization.js`

Versão:

`20260723_09_commercial_profile_materialization`

Foi criado apenas um índice nesta fase:

`idx_leads_commercial_profile_version (commercial_profile_version, id)`

Ele possui finalidade comprovada para:

- detectar pendências
- percorrer o backfill
- controlar a transição para o modo materializado

Índices adicionais para prioridade/oportunidade foram deliberadamente adiados até `EXPLAIN ANALYZE`, evitando indexação preventiva sem evidência.

---

## Rollback

Arquivo manual:

`server/migrations/20260723_09_commercial_profile_materialization.rollback.sql`

O rollback é destrutivo apenas para as novas colunas e **não é executado automaticamente**.

Antes de usá-lo:

1. restaurar o código para versão anterior
2. confirmar backup válido
3. interromper escrita durante a janela de rollback
4. executar o SQL manualmente
5. validar aplicação

---

## Sequência recomendada de implantação

### 1. Backup

Não aplicar a migration estrutural sem confirmar backup MySQL válido e restaurável.

### 2. Substituir arquivos da Fase 2

Aplicar sobre a Fase 1.

### 3. Reiniciar a API

No primeiro boot a migration adicionará as novas colunas.

O CRM continuará utilizando as consultas legadas enquanto houver leads pendentes, portanto as métricas permanecem compatíveis.

### 4. Executar o backfill

```bash
npm run commercial-profile:backfill -- --batch-size=500 --pause-ms=25
```

Começar com batch 500. Ajustar somente depois de observar CPU, I/O, lock waits e latência da API.

### 5. Verificar

```bash
npm run commercial-profile:verify
```

Esperado:

`pending: 0`

### 6. Confirmar ativação

Em até aproximadamente 30 segundos o backend deve registrar que a inteligência comercial materializada está ativa.

### 7. Comparar observabilidade

Usar as métricas da Fase 0 para comparar:

- SQL p95
- tempo total dos endpoints
- quantidade de queries
- rows examined no MySQL
- pool pending
- CPU MySQL

Principais endpoints/telas:

- resumo de leads
- oportunidades
- mapa de oportunidades
- overview administrativo
- filtros `lead-priority`, `priority`, `migration`, `mapping`, `agency`

---

## Arquivos modificados/criados

### Criados

- `scripts/backfill-commercial-profile.mjs`
- `server/.env.example`
- `server/domains/leads/commercialProfileRuntime.js`
- `server/domains/leads/leadCommercialProfile.js`
- `server/domains/leads/leadPersistenceSql.js`
- `server/migrations/20260723_09_commercial_profile_materialization.js`
- `server/migrations/20260723_09_commercial_profile_materialization.rollback.sql`
- `server/migrations/20260723_09_commercial_profile_materialization.test.js`
- `server/phase2CommercialMaterialization.test.js`
- `PERFORMANCE_PHASE2.md`

### Modificados

- `package.json`
- `server/index.js`
- `server/domains/leads/leadMapper.js`
- `server/domains/leads/leadMapper.test.js`
- `server/leadSummarySql.js`
- `server/migrate-sqlite-to-mysql.js`
- `server/opportunityRules.js`
- `server/opportunityRules.test.js`
- `server/schema.mysql.sql`

---

## Antes

A consulta de oportunidades gerada possuía aproximadamente:

```text
410 JSON_EXTRACT
58.908 caracteres de SQL
```

O filtro de prioridade podia gerar:

```text
94 JSON_EXTRACT
14.947 caracteres de SQL
```

---

## Depois

Após backfill completo:

```text
Oportunidades: 0 JSON_EXTRACT
Resumo de leads: 0 JSON_EXTRACT
Overview admin: 0 JSON_EXTRACT
Filtro lead-priority: 0 JSON_EXTRACT
```

A inteligência passa a ser calculada na alteração do lead e persistida, em vez de reconstruída sobre a base inteira a cada leitura.

---

## Testes executados

### Fase 2 focada

```text
34/34 aprovados
```

Inclui:

- cálculo comercial
- materialização no UPSERT
- SQL materializado
- fallback legado
- migration
- rollback explícito
- backfill batch
- Lead Mapper
- Quick Wins Fase 1
- observabilidade

### Arquitetura, reliability e runtime

Também foram validados os testes de arquitetura e estabilidade, inclusive limite estrutural de `server/index.js`.

`server/index.js`: 5.588 linhas, abaixo do limite existente de 5.600.

### Suíte ampla

```text
176/180 aprovados
```

As quatro falhas restantes são de execução local por dependências do projeto não instaladas no pacote de trabalho:

- `fflate`
- `mysql2`
- `exceljs`

Não houve falha lógica da Fase 2 nesses quatro casos.

### Sintaxe

Todos os arquivos `.js` e `.mjs` de `server/` e `scripts/` passaram em `node --check`.

---

## Riscos

### Migration em tabela grande

Adicionar colunas/índice em tabela de produção deve ser feito em janela monitorada, apesar de MySQL 8 suportar operações online/instantâneas em vários cenários.

### Backfill

O batch ideal depende de hardware, I/O e concorrência real. Não aumentar de 500 para 2.000 sem observar produção.

### Mudança de regra no futuro

Ao alterar `calculateLeadCommercialProfile`, aumente `COMMERCIAL_PROFILE_VERSION` e rode novo backfill. Enquanto houver versões antigas, o CRM volta automaticamente ao modo legado para preservar consistência.

---

## Performance real

Não foram inventados números de p95.

Este ambiente não possui a instância MySQL de produção nem os 133 mil leads reais. Portanto a melhoria de runtime deve ser confirmada no servidor através da observabilidade criada na Fase 0.

O que já é comprovável nesta entrega é a remoção estrutural das centenas de `JSON_EXTRACT` do caminho de leitura após o backfill.

---

## Próxima fase

**FASE 3 — Refatoração dos resumos e dashboards**

A Fase 2 já substituiu as expressões pesadas por campos simples. A próxima fase deverá consolidar e simplificar as agregações de dashboard, revisar cache/invalidação e medir as queries materializadas com a base real antes de criar novos índices.
