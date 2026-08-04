# MYSQL HARDENING REPORT — FASE 12

Gerado em: 2026-08-03T13:22:23.327Z

> Auditoria somente leitura. Nenhum parâmetro MySQL foi alterado automaticamente.

## 1. Ambiente

| Item | Valor |
| --- | --- |
| MySQL | 10.11.14-MariaDB-0ubuntu0.24.04.1 Ubuntu 24.04 |
| Banco | crm_casa_ads |
| Host MySQL | 127.0.0.1:3306 |
| MySQL parece local | sim |
| CPU | 8 vCPU |
| RAM total | 23.5 GB |
| RAM disponível no snapshot | 19.5 GB |
| Swap em uso | 0 B |
| Load average | 1.3 / 1.18 / 1.11 |
| Footprint dados | 305.0 MB |
| Footprint índices | 312.8 MB |

## 2. Configuração crítica

| Variável | Valor |
| --- | --- |
| innodb_buffer_pool_size | 134217728 (128.0 MB) |
| buffer pool / RAM | 0.5% |
| max_connections | 151 |
| tmp_table_size | 16777216 (16.0 MB) |
| max_heap_table_size | 16777216 (16.0 MB) |
| slow_query_log | OFF |
| long_query_time | 10.000000s |
| thread_cache_size | 151 |
| table_open_cache | 2000 |
| performance_schema | OFF |
| innodb_flush_log_at_trx_commit | 1 |
| sync_binlog | 0 |

## 3. Indicadores

| Indicador | Resultado |
| --- | --- |
| Buffer pool hit ratio | -0.951% |
| Buffer pool páginas dirty | 0% |
| Buffer pool páginas livres | 14.44% |
| Pico de conexões / max_connections | 4.6% (7/151) |
| Conexões atuais | 7 |
| Threads rodando | 1 |
| Thread cache miss histórico | 19.05% |
| Table open cache miss | 0.02% |
| Aborted connects | 0% |
| Temporary tables em disco | 45.5% |
| Slow queries / Questions | 0.0036% |
| QPS médio desde startup | 0.77 |
| QPS durante amostra | 0.87 |
| Slow QPS durante amostra | 0.000 |
| InnoDB data reads/s | 1300.40 |
| InnoDB data writes/s | 0.00 |
| InnoDB buffer physical reads/s | 1300.40 |
| Temporary tables disco/s | 0.07 |
| Rede recebida/s | 320 B/s |
| Rede enviada/s | 141 B/s |
| Row lock waits | 0 |
| Row lock time | 0 ms |

Amostra dinâmica: 15s.

## 4. Disco

| Path | Total | Disponível | Uso |
| --- | --- | --- | --- |
| /var/www/crm-casa-ads | 144.3 GB | 119.2 GB | 17.3% |
| /var/lib/mysql/ | 144.3 GB | 119.2 GB | 17.3% |

## 5. Maiores tabelas

| Tabela | Rows estimadas | Dados | Índices | Data free |
| --- | --- | --- | --- | --- |
| leads | 114150 | 303.0 MB | 310.9 MB | 0 B |
| operational_health_snapshots | 3143 | 1.52 MB | 368.0 KB | 4.00 MB |
| leads_archive | 0 | 16.0 KB | 576.0 KB | 0 B |
| audit_log | 216 | 192.0 KB | 112.0 KB | 0 B |
| tasks | 6 | 32.0 KB | 160.0 KB | 0 B |
| async_jobs | 1 | 16.0 KB | 96.0 KB | 0 B |
| users | 3 | 16.0 KB | 80.0 KB | 0 B |
| integration_events | 1 | 16.0 KB | 64.0 KB | 0 B |
| mutation_receipts | 0 | 16.0 KB | 64.0 KB | 0 B |
| backups | 6 | 16.0 KB | 48.0 KB | 0 B |
| teams | 2 | 16.0 KB | 48.0 KB | 0 B |
| lead_external_origins | 0 | 16.0 KB | 48.0 KB | 0 B |
| sessions | 0 | 16.0 KB | 48.0 KB | 0 B |
| rate_limits | 0 | 16.0 KB | 32.0 KB | 0 B |
| kanban_pipelines | 0 | 16.0 KB | 32.0 KB | 0 B |

## 6. Top statements por tempo acumulado

_Performance Schema indisponível: ER_TABLEACCESS_DENIED_ERROR._

## 7. Leituras sem índice observadas pelo Performance Schema

_Nenhuma leitura sem índice foi observada neste snapshot, ou o Performance Schema não disponibilizou a métrica._

## 8. Recomendações

### 1. [HIGH] Ativar Slow Query Log

O slow query log está desligado. Isso reduz a capacidade de confirmar gargalos reais depois das otimizações de aplicação.

**Ação:** Habilitar de forma controlada no my.cnf, preferencialmente com long_query_time entre 0,5s e 1s e rotação de logs.

### 2. [HIGH] Buffer pool com miss rate relevante

O hit ratio estimado do InnoDB Buffer Pool é -0.951%.

**Ação:** Verifique working set, RAM disponível e leituras físicas antes de aumentar innodb_buffer_pool_size. Em VPS compartilhada com Node, preserve memória para sistema e processos da aplicação.

### 3. [HIGH] Muitas temporary tables indo para disco

45.5% das temporary tables contabilizadas foram criadas em disco.

**Ação:** Primeiro identifique as queries responsáveis. Só depois avalie tmp_table_size/max_heap_table_size; aumentar esses limites multiplica consumo potencial por conexão.

### 4. [MEDIUM] Buffer pool pequeno para o footprint observado

innodb_buffer_pool_size representa 0.5% da RAM e é menor que o footprint de dados+índices observado.

**Ação:** Avaliar aumento gradual, em passos pequenos, observando RSS do Node, swap, OOM e latência. Não aplicar 70% da RAM automaticamente em uma VPS que também hospeda API/worker.

## 9. Regra de aplicação

Não aplicar alterações de memória/conexões apenas com este snapshot. Rode esta auditoria em horário de pico e compare com:

1. `MYSQL_EXPLAIN_ANALYZE_REPORT.md` da Fase 9.
2. Slow query log.
3. Métricas `[perf.runtime]` e `[perf.sql]` da Fase 0.
4. Uso de RAM/swap e disco da VPS.

O arquivo `MYSQL_HARDENING_CANDIDATE.cnf` é apenas um candidato revisável. Ele deliberadamente NÃO altera automaticamente buffer pool, max_connections ou limites de temporary tables.
