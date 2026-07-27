# PERFORMANCE — FASE 12 — HARDENING MYSQL

## Status

FASE 12 implementada no código.

Esta fase foi deliberadamente construída como **auditoria somente leitura + recomendações baseadas em evidência**. O ambiente de desenvolvimento usado para esta entrega não possui acesso ao MySQL/VPS de produção do BobCRM, portanto nenhum valor real de `innodb_buffer_pool_size`, RAM, I/O, `Max_used_connections`, temporary tables ou slow queries de produção foi inventado.

O resultado real deve ser coletado no servidor após o deploy.

---

## 1. Objetivo

Depois das Fases 0–11, o objetivo desta etapa é analisar o servidor MySQL real antes de qualquer tuning de infraestrutura.

São coletados:

- versão do MySQL;
- RAM e CPU do host da aplicação;
- RAM disponível e swap;
- capacidade e ocupação dos filesystems acessíveis;
- `innodb_buffer_pool_size`;
- hit ratio do buffer pool;
- páginas dirty e livres;
- `max_connections`;
- pico histórico e uso atual de conexões;
- churn/thread cache;
- temporary tables em memória e disco;
- slow query log e `long_query_time`;
- row lock waits;
- table open cache;
- I/O do InnoDB;
- QPS;
- bytes recebidos/enviados;
- footprint de dados e índices;
- top statements do Performance Schema;
- leituras por índice e leituras sem índice.

---

## 2. Arquivos criados

### `scripts/mysql-hardening-core.mjs`

Contém cálculos e regras de recomendação testáveis sem conexão com banco.

Principais métricas:

- connection utilization;
- buffer pool hit ratio;
- buffer pool / RAM;
- temporary tables em disco;
- thread cache miss;
- table open cache miss;
- aborted connects;
- dirty/free buffer pages;
- QPS;
- slow query ratio.

### `scripts/mysql-hardening-audit.mjs`

Auditor de produção somente leitura.

Gera:

```text
MYSQL_HARDENING_REPORT.md
MYSQL_HARDENING_CANDIDATE.cnf
```

O primeiro contém evidência e recomendações.

O segundo é apenas um candidato revisável. Parâmetros de memória e conexão são deixados comentados por design.

### `scripts/mysql-hardening-core.test.mjs`

Testa cálculos, recomendações e segurança do candidato de configuração.

### `server/phase12MysqlHardening.test.js`

Valida que a fase:

- não contém DDL/DML de aplicação;
- não usa `SET GLOBAL`;
- não cria/remove índices;
- não aumenta `max_connections` automaticamente;
- deixa buffer pool e limites de memória comentados.

---

## 3. Alterações em arquivos existentes

### `package.json`

Novos comandos:

```bash
npm run mysql:hardening
npm run test:phase12-performance
```

### `server/.env.example`

Novas opções:

```env
MYSQL_HARDENING_SAMPLE_SECONDS=5
MYSQL_HARDENING_MAX_DIGESTS=20
```

---

## 4. Segurança

O auditor não executa:

```text
SET GLOBAL
ALTER INSTANCE
CREATE INDEX
DROP INDEX
UPDATE
DELETE
INSERT
```

Ele usa apenas leitura de:

```text
SHOW GLOBAL VARIABLES
SHOW GLOBAL STATUS
information_schema.tables
performance_schema.events_statements_summary_by_digest
performance_schema.table_io_waits_summary_by_index_usage
```

Os statements do Performance Schema são obtidos através de `DIGEST_TEXT`, que é a forma normalizada da query e não a query original com parâmetros de negócio.

---

## 5. Janela dinâmica

Contadores acumulados podem esconder o comportamento atual.

Por isso a auditoria coleta dois snapshots separados por uma janela configurável.

Padrão:

```text
5 segundos
```

Durante essa janela são calculados:

```text
Questions/s
Slow_queries/s
SELECT/s
INSERT/s
UPDATE/s
DELETE/s
Created_tmp_tables/s
Created_tmp_disk_tables/s
Innodb_data_reads/s
Innodb_data_writes/s
Innodb_buffer_pool_reads/s
Bytes_received/s
Bytes_sent/s
```

Para diagnóstico de produção, recomenda-se executar também com 15–30 segundos durante um período representativo.

---

## 6. Regras de recomendação

### Conexões

Mesmo se o uso estiver alto, o relatório **não recomenda simplesmente aumentar `max_connections`**.

A Fase 6 já separou os pools padrão em:

```text
API: 8
Worker: 2
Total da aplicação: 10
```

Antes de aumentar `max_connections`, devem ser avaliados:

- pool pending;
- queries lentas;
- duração das conexões;
- RAM;
- lock contention;
- carga concorrente externa.

### Buffer pool

O relatório compara:

```text
innodb_buffer_pool_size
versus
RAM disponível
versus
footprint dados + índices
versus
hit ratio
```

Não existe regra automática do tipo “coloque 70% da RAM”.

Isso seria perigoso porque a VPS também pode hospedar:

- API Node;
- worker;
- PM2;
- sistema operacional;
- filesystem cache;
- backups e jobs.

### Temporary tables

Se muitas tabelas temporárias estiverem indo para disco, a primeira recomendação é identificar as queries responsáveis.

Não aumentar `tmp_table_size`/`max_heap_table_size` automaticamente, pois esses limites podem multiplicar consumo por conexão.

### Slow Query Log

Se estiver desligado, esta é uma das poucas recomendações que o candidato pode sugerir explicitamente:

```ini
slow_query_log = ON
long_query_time = 0.5
```

Ainda assim o arquivo não é aplicado automaticamente.

É necessário configurar rotação e espaço em disco.

---

## 7. Como executar em produção

Primeiro execute uma auditoria curta:

```bash
cd /var/www/crm-casa-ads
npm run mysql:hardening
```

Depois, preferencialmente durante período de uso real:

```bash
npm run mysql:hardening -- --sample-seconds=15 --max-digests=30
```

Arquivos gerados:

```text
MYSQL_HARDENING_REPORT.md
MYSQL_HARDENING_CANDIDATE.cnf
```

Não execute o `.cnf` automaticamente.

---

## 8. Cruzamento obrigatório com Fase 9

A decisão de tuning deve cruzar:

```text
MYSQL_HARDENING_REPORT.md
+
MYSQL_EXPLAIN_ANALYZE_REPORT.md
+
slow query log
+
[perf.sql]
+
[perf.runtime]
```

Exemplo:

Se `Created_tmp_disk_tables` estiver alto, não aumentar memória imediatamente.

Primeiro identificar no Performance Schema e `EXPLAIN ANALYZE` quais queries estão criando sort/temp.

---

## 9. Critérios de alerta usados

As recomendações sinalizam, entre outros casos:

- `Max_used_connections / max_connections >= 80%`;
- buffer pool hit ratio abaixo de 99,5%;
- temporary tables em disco >= 20%, desde que exista volume relevante;
- churn de threads acima de 5%;
- row lock waits;
- filesystem >= 85%;
- misses relevantes de table open cache;
- slow query log desligado;
- `long_query_time > 1s`.

Esses valores são **gatilhos de investigação**, não ordens automáticas de mudança.

---

## 10. Banco

Nenhuma migration foi criada.

Nenhuma alteração em:

```text
schema
índices
constraints
colunas
dados
```

---

## 11. Testes

### Fase 12 focada

```text
21/21 aprovados
```

Após ampliação das métricas, os testes dedicados do core/auditor também permaneceram verdes.

### Suíte completa

```text
251/255 aprovados
```

As quatro falhas são ambientais e já existiam nas fases anteriores:

```text
fflate  -> 2
mysql2  -> 1
exceljs -> 1
```

Não houve falha funcional nova da Fase 12.

### Sintaxe

Todos os arquivos `.js` e `.mjs` em `server/` e `scripts/` passaram em:

```bash
node --check
```

---

## 12. Limitação desta entrega

O MySQL de produção não está acessível neste ambiente.

Portanto não há valores legítimos para afirmar, nesta entrega, algo como:

```text
buffer pool deve ser 4 GB
max_connections deve ser 80
tmp_table_size deve ser 64 MB
```

Esses números só devem ser definidos depois de rodar `npm run mysql:hardening` na VPS real.

Essa decisão preserva a regra central do projeto: medir antes de alterar infraestrutura.

---

## 13. Próxima fase

FASE 13 — teste de carga real.

A partir daqui o BobCRM já possui:

- observabilidade;
- queries enxutas;
- inteligência materializada;
- dashboards consolidados;
- busca otimizada;
- Kanban consolidado;
- workers isolados;
- importação em batch;
- DATETIME indexável;
- EXPLAIN ANALYZE;
- cache inteligente;
- frontend otimizado;
- auditoria de MySQL.

A Fase 13 deverá validar o sistema com volumes e concorrência próximos do ambiente real, inclusive importação ativa enquanto usuários navegam.
