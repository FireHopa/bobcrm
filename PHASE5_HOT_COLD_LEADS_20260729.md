# Fase 5 — Hot/Cold Leads

## Objetivo

Reduzir o universo operacional do CRM para aproximadamente 30.000 leads ativos, mantendo os demais leads históricos disponíveis em uma camada fria (`leads_archive`) que só é consultada quando solicitada.

A Fase 5 não apaga leads automaticamente. Leads elegíveis são movidos da tabela operacional `leads` para `leads_archive` em batches pelo worker.

## Segurança de arquivamento

O arquivamento automático nunca força o CRM a atingir exatamente 30.000 leads. Se houver mais de 30.000 registros protegidos, eles permanecem ativos e o excedente protegido é registrado em `crm_statistics`.

Por padrão, um lead não é arquivado automaticamente quando:

- possui tarefa pendente;
- possui próximo contato preenchido;
- possui fechamento previsto no grupo de inativos sem responsável;
- está associado a um responsável em cenários não permitidos pela configuração;
- apresenta sinais comerciais relevantes incompatíveis com o tier de inatividade.

Os candidatos prioritários são leads encerrados/perdidos antigos e, depois, leads antigos sem responsável e de baixa prioridade.

## Configuração padrão

```env
HOT_LEADS_LIMIT=30000
HOT_LEADS_AUTO_ARCHIVE=1
HOT_LEADS_ARCHIVE_BATCH_SIZE=250
HOT_LEADS_ARCHIVE_PAUSE_MS=75
HOT_LEADS_CLOSED_INACTIVE_DAYS=30
HOT_LEADS_UNASSIGNED_INACTIVE_DAYS=120
HOT_LEADS_ARCHIVE_ASSIGNED_CLOSED=0
```

## Migration

A migration `20260729_17_hot_cold_leads_phase5` cria:

- `leads_archive`;
- metadados de arquivamento;
- índices do arquivo frio;
- `crm_statistics`;
- métricas `active_leads`, `archived_leads` e `archive_protected_overflow`.

A migration propositalmente não transfere dezenas de milhares de leads. A transferência é feita pelo worker depois da inicialização para evitar bloquear o boot da API.

## Worker

Novo job pesado:

```text
archive_cold_leads
```

Ele é serializado com importação, backup e rebuild de busca para não criar concorrência agressiva no MySQL.

O primeiro arquivamento de uma base com aproximadamente 130 mil leads pode levar algum tempo porque a movimentação é feita em lotes pequenos e transacionais.

## Administração

Em Administração existe a nova área `Arquivo de Leads`.

Ela permite:

- visualizar ativos, arquivados e excedente protegido;
- solicitar arquivamento do excesso;
- pesquisar um lead arquivado;
- restaurar um lead para a operação;
- exportar todos os arquivados em CSV por job assíncrono.

A listagem do arquivo frio é lazy-loaded. Ela não participa da inicialização normal do CRM.

## Estatísticas

A interface normal não executa `COUNT(*)` em `leads_archive` a cada carregamento. Os números principais ficam em `crm_statistics` e são atualizados durante criação, exclusão, restauração, importação e jobs de arquivamento.

## Implantação

Como há alterações de frontend e backend:

```bash
cd /var/www/crm-casa-ads
npm ci
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

Acompanhe o worker:

```bash
pm2 logs crm-casa-ads-worker --lines 200
```

Confirme a migration:

```sql
SELECT version, applied_at
FROM schema_migrations
WHERE version = '20260729_17_hot_cold_leads_phase5';
```

Confira as métricas:

```sql
SELECT metric_key, metric_value, updated_at
FROM crm_statistics
ORDER BY metric_key;
```

Confira jobs da Fase 5:

```sql
SELECT id, type, status, progress_current, progress_total, progress_message, created_at, updated_at
FROM async_jobs
WHERE type IN ('archive_cold_leads', 'export_archived_leads_csv')
ORDER BY created_at DESC
LIMIT 10;
```

## Observação sobre o incidente de 29/07

A arquitetura Hot/Cold reduz significativamente scans e volume operacional do MySQL. Porém, o log observado em 29/07 mostrou uma requisição `/api/leads` com aproximadamente 60 segundos de duração e somente cerca de 2 ms atribuídos a SQL. Portanto, a Fase 5 não deve ser tratada como prova de que aquele bloqueio específico foi resolvido. Esse comportamento pode ter uma causa adicional fora da query principal e deve continuar sendo monitorado pela telemetria da Fase 4.
