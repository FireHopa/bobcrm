# PERFORMANCE FINAL REPORT — BobCRM Fases 0 a 13

## Escopo

Pacote cumulativo de otimização de performance, estabilidade e escalabilidade do BobCRM para bases de 100 mil, 133 mil, 300 mil leads e crescimento futuro.

## Fases implementadas

1. Baseline e observabilidade por endpoint/SQL/pool/Node.
2. Quick wins: payloads, `SELECT *`, paginação e requests duplicados.
3. Materialização da inteligência comercial e backfill seguro.
4. Consolidação de resumos e dashboards.
5. Busca indexável com FULLTEXT e fallback controlado.
6. Kanban consolidado com window functions e poucas queries.
7. API e worker separados no PM2, com pools MySQL independentes.
8. Importação em batches com checkpoint transacional e deduplicação em lote.
9. Datas paralelas em `DATETIME(3)` com triggers, backfill e compatibilidade.
10. Ferramentas de `EXPLAIN ANALYZE` e auditoria de índices baseada em evidência.
11. Cache inteligente com TTL, invalidação por domínio e deduplicação de carregamentos.
12. Frontend React: lazy loading, memoização, cancelamento de requests e renderização sob demanda.
13. Auditoria de hardening MySQL somente leitura.
14. Teste de carga com 10, 25, 50 e 100 usuários e cenário de importação concorrente.

> A numeração acima inclui a Fase 0 e vai até a Fase 13 do plano original.

## Principais mudanças estruturais

- centenas de expressões `JSON_EXTRACT` saem do caminho crítico após o backfill da inteligência comercial;
- listagens e Kanban deixam de carregar campos grandes desnecessários;
- Kanban deixa o padrão `COUNT + SELECT` por etapa e consolida o board;
- busca prioriza telefone/e-mail indexáveis e FULLTEXT antes do fallback amplo;
- API não divide mais o mesmo processo com importações, exportações e jobs pesados;
- importações deixam de fazer UPSERT lead a lead no caminho principal e passam a trabalhar em batches controlados;
- filtros temporais passam a utilizar `DATETIME(3)` após backfill validado;
- caches deixam de ser invalidados por qualquer transação e passam a ser específicos por domínio;
- frontend reduz renderizações e requests desnecessários;
- hardening e índices passam a ser decididos com medição real, sem tuning arbitrário.

## Migrations relevantes

- materialização do perfil comercial;
- colunas temporais paralelas `DATETIME(3)` e índices relacionados.

As migrations possuem estratégia de compatibilidade e arquivos de rollback quando aplicável. Antes de migrations estruturais, mantenha backup válido.

## Arquitetura atual

```text
PM2
├── crm-casa-ads-api
│   └── PROCESS_ROLE=api
└── crm-casa-ads-worker
    └── PROCESS_ROLE=worker

MySQL pool padrão
├── API: 8
└── Worker: 2
```

## Metas de performance configuradas

| Cenário | Meta p95 |
|---|---:|
| Lista de leads | < 400 ms |
| Detalhe do lead | < 300 ms |
| Busca | < 800 ms |
| Kanban inicial | < 900 ms |
| Dashboard | < 800 ms |
| Resumos | < 500 ms |
| Criar/editar lead | < 700 ms |

## Evidência ainda necessária em produção/staging

Os números finais de p95, rows examined, I/O e buffer pool dependem do MySQL real, VPS real e base real. O pacote inclui ferramentas para gerar essa evidência:

```bash
npm run mysql:explain:plan
npm run mysql:explain
npm run mysql:hardening
npm run test:load:smoke
```

Não considerar a otimização concluída somente porque o sistema inicia. Validar health checks, backfills, logs, carga e comportamento durante importações.
