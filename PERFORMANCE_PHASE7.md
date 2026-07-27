# PERFORMANCE PHASE 7 — IMPORTAÇÃO EM ALTA ESCALA

Data: 23/07/2026

## Objetivo

Refatorar a importação de leads para reduzir drasticamente queries individuais, scans desnecessários, duração de transações, uso de memória e impacto sobre o MySQL, preservando deduplicação, regras comerciais, tarefas, escopo de acesso e capacidade de retomada após falha do worker.

## Diagnóstico confirmado antes da alteração

O fluxo da Fase 6 já executava a importação em worker separado, porém cada job de importação ainda apresentava cinco gargalos importantes:

1. A deduplicação montava um índice em memória lendo todos os leads ativos acessíveis ao usuário antes de cada lote.
2. Cada lead era persistido individualmente com um `INSERT ... ON DUPLICATE KEY UPDATE` próprio.
3. O job de até 3.000 leads usava uma transação única, mantendo o lock de identidade durante todo o lote.
4. Leads novos com `nextContactAt` sincronizavam tarefas individualmente, gerando várias queries por lead.
5. Não existia checkpoint transacional por sublote. Dividir commits sem checkpoint atômico poderia repetir mesclagens em uma retomada do worker.

## Alterações realizadas

### 1. Batches internos de banco

O frontend pode continuar enviando lotes de até 3.000 contatos. No worker, cada job agora é subdividido em batches menores para persistência MySQL.

Default:

```text
IMPORT_DB_BATCH_SIZE=500
```

Faixa permitida:

```text
100 a 1.000
```

O teto de 1.000 foi escolhido deliberadamente porque a persistência atual possui 53 parâmetros por lead. Lotes maiores aumentariam excessivamente a quantidade de placeholders de um único prepared statement.

### 2. UPSERT de leads em batch

Antes:

```text
3.000 leads
→ até 3.000 statements de UPSERT
```

Agora, com batch 500:

```text
3.000 leads
→ 6 statements de UPSERT
```

Redução estrutural dos statements de escrita de leads:

```text
99,8%
```

O `UPSERT_LEAD_SQL` unitário continua disponível para criação e edição normal de leads. A Fase 7 adiciona um builder compatível para múltiplas linhas.

### 3. Deduplicação direcionada por identidades do batch

Antes, a importação executava uma consulta semelhante a:

```sql
SELECT id, name, email, email_key, phone, phone_key, company, name_company_key
FROM leads
WHERE deleted_at = '' ...
```

Isso podia carregar dezenas ou centenas de milhares de registros para a memória do worker somente para montar Maps de deduplicação.

Agora cada batch consulta apenas identidades presentes naquele lote:

```text
id
email_key
phone_key
name_company_key
```

com `IN (...)` e os mesmos filtros de escopo do usuário.

A deduplicação dentro do próprio batch continua acontecendo em memória, portanto dois registros do mesmo arquivo que colidam por e-mail, telefone ou nome+empresa ainda são tratados corretamente.

### 4. Transações menores

Antes:

```text
job de 3.000 leads
→ 1 transação grande
→ 1 lock de identidade mantido durante todo o job
```

Agora:

```text
job de 3.000 leads
→ 6 transações de 500
→ commit por batch
→ liberação do lock após cada commit
```

Isso reduz:

- tempo de retenção de locks;
- tamanho de rollback;
- pressão sobre undo log;
- janela de contenção com outras alterações de identidade;
- risco operacional durante importações grandes.

### 5. Checkpoint atômico

O checkpoint do job é atualizado na mesma transação do batch de leads.

Exemplo:

```text
batch 1: leads 0–499 + checkpoint 500 → COMMIT
batch 2: leads 500–999 + checkpoint 1000 → COMMIT
```

Se o worker cair depois do primeiro commit, a próxima tentativa começa no índice 500.

O checkpoint persiste:

```text
progress_current
progress_total
result_json.report
result_json.checkpoint.nextIndex
```

Isso evita reprocessar batches já confirmados e reduz o risco de duplicar mesclagens ou concatenar observações novamente durante retry.

### 6. Follow-ups de leads novos em batch

Para leads realmente novos com `nextContactAt`, as tarefas automáticas agora são inseridas com um único `INSERT` multi-row por batch.

Antes, cada novo lead com follow-up podia executar aproximadamente:

```text
SELECT task existente
INSERT task
SELECT MIN(due_at)
UPDATE lead.next_contact_at
SELECT dados do perfil comercial
UPDATE perfil comercial
```

Agora, para novos leads, o próprio lead já é persistido com `next_contact_at` e perfil comercial corretos e as tarefas são criadas em batch.

Leads existentes/mesclados continuam usando a reconciliação completa anterior, pois podem possuir tarefas manuais ou legadas que precisam ser preservadas.

### 7. Auditoria idempotente do job

O registro final de auditoria da importação usa uma chave determinística baseada no ID do job.

Caso o worker seja interrompido entre a auditoria e a conclusão formal do job, a retomada não cria auditorias duplicadas para a mesma importação.

## Comparação estrutural para 3.000 leads novos

Cenário de referência: 3.000 leads válidos, sem duplicados existentes e `IMPORT_DB_BATCH_SIZE=500`.

| Operação | Antes | Depois |
| --- | ---: | ---: |
| Scan/lookup de duplicados | 1 scan de toda a carteira | 6 lookups direcionados |
| UPSERT de leads | 3.000 | 6 |
| Transações | 1 grande | 6 controladas |
| Checkpoints transacionais | 0 | 6 |
| Leads da carteira carregados no índice de dedupe | potencialmente 133 mil+ | somente correspondências dos batches |
| Lock de identidade | durante o job inteiro | por batch |

Somente considerando lookup + persistência + checkpoint, o caminho estrutural passa de pelo menos 3.001 operações SQL relevantes para aproximadamente 18 operações no cenário acima, antes de tarefas e auditoria.

Essa comparação é estrutural e não substitui o benchmark de p95 no MySQL de produção.

## Compatibilidade preservada

A Fase 7 mantém:

- importação assíncrona por job;
- frontend em chunks;
- deduplicação por e-mail;
- deduplicação por variações de telefone;
- deduplicação por nome + empresa;
- regras de escopo do usuário;
- importação inicialmente sem responsável informado na planilha;
- atribuição conforme política de carteira;
- merge de dados existentes;
- inteligência comercial materializada;
- Kanban;
- tarefas e lifecycle de leads existentes;
- auditoria;
- retries do worker.

## Banco

Nenhuma migration foi criada.

Nenhuma coluna, índice ou constraint foi removida ou alterada.

## Arquivos principais modificados

```text
server/index.js
server/.env.example
server/domains/leads/importBatch.js
server/domains/leads/leadPersistenceSql.js
server/domains/leads/leadProjections.js
server/phase7ImportBatch.test.js
package.json
PERFORMANCE_PHASE7.md
```

## Testes

### Focados

Comando dedicado da Fase 7:

```text
17/17 aprovados
```

Regressão focada das Fases 0 a 7:

```text
81/81 aprovados
```

### Suíte ampla

Resultado observado:

```text
212 testes
208 aprovados
4 falhas ambientais
```

As quatro falhas são causadas por dependências não instaladas neste ambiente de análise:

```text
fflate  → 2
mysql2  → 1
exceljs → 1
```

Nenhuma das quatro falhas aponta regressão funcional na importação.

### Sintaxe

Todos os arquivos `.js` e `.mjs` em `server/` e `scripts/` passaram em `node --check`.

## Como configurar

No `.env` do worker:

```text
IMPORT_DB_BATCH_SIZE=500
```

Recomendação inicial para produção:

```text
500
```

Somente aumentar após benchmark real de MySQL, CPU, I/O, tamanho médio dos campos e `max_allowed_packet`.

## Métricas que devem ser observadas em produção

Durante uma importação real de 3.000 ou mais leads, comparar:

```text
queries por batch
tempo SQL por batch
tempo total do job
pool pending do worker
CPU MySQL
rows examined
lock wait
RSS do worker
API p95 enquanto a importação está ativa
```

Teste principal recomendado:

```text
importação ativa
+
20 usuários navegando
```

A API deve continuar responsiva porque a Fase 6 isolou o worker e a Fase 7 reduziu a quantidade e duração das operações do worker.

## Resultado da Fase 7

A importação deixou de ser apenas "assíncrona" e passou a ser efetivamente orientada a batches no banco:

```text
arquivo/chunk
↓
normalização
↓
sub-batch MySQL
↓
lookup direcionado de duplicidade
↓
merge em memória
↓
UPSERT multi-row
↓
follow-ups novos em batch
↓
checkpoint na mesma transação
↓
COMMIT
↓
próximo batch
```

## Próxima fase

FASE 8 — migração segura de datas `VARCHAR` para `DATETIME(3)` com dual-write/backfill, validação e rollback.
