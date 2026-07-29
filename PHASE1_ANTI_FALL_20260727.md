# Fase 1 Anti-Queda — 27/07/2026

Pacote cumulativo sobre os hotfixes de handoff e carteira do consultor.

## Alterações

1. SELECTs originados por requisições HTTP recebem `MAX_EXECUTION_TIME` automaticamente.
   - padrão: 8s
   - administração/duplicados: 10s
   - carteira própria de consultor: mantém proteção específica de 4s
2. Pool MySQL deixa de usar fila infinita.
   - API: 8 conexões / fila 32
   - worker: 2 conexões / fila 8
   - saturação de fila retorna 503 em vez de crescer indefinidamente
3. Bootstrap/login deixa de disparar simultaneamente `/leads`, `/summary`, `/filter-options`, `/today` e usuários atribuíveis.
   - carteira + resumo são carregados primeiro
   - filtros carregam somente ao abrir Leads
   - atribuíveis carregam de forma adiada ou ao abrir o handoff
4. Duplicados deixam de ser calculados ao abrir Administração e passam a carregar somente na aba Duplicados.
5. Bulk Kanban (até 200 cards) passa a validar/buscar em lote e executar um único UPDATE principal com `CASE`.
6. Rebalanceamento do Kanban passa a atualizar posições em lotes de até 500 cards, em vez de um UPDATE por card.
7. Migration `20260727_13_anti_fall_phase1` cria `idx_leads_stage_active_position (pipeline_stage_id, deleted_at, kanban_position, id)`.
8. Backfill de `responsible_user_id` passa a ser set-based, evitando um UPDATE da tabela por identidade de usuário.
9. Handoff posterga recálculos redundantes e consolida `next_contact_at`/perfil comercial uma única vez no final.
10. Jobs pesados do worker (`backup_mysql`, `import_leads`, `rebuild_search_index`) ficam serializados no worker único do PM2.

## Instalação

Na raiz `/var/www/crm-casa-ads`, extraia o hotfix preservando as pastas e substituindo os arquivos existentes.

Como há alteração no frontend, gere novamente `dist`:

```bash
npm run build
```

Se as dependências não estiverem instaladas na VPS:

```bash
npm ci
npm run build
```

Depois reinicie API e worker:

```bash
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

A migration 13 é aplicada automaticamente pela API no boot.

## Verificação

```sql
SELECT version, applied_at
FROM schema_migrations
WHERE version = '20260727_13_anti_fall_phase1';

SHOW INDEX FROM leads
WHERE Key_name = 'idx_leads_stage_active_position';
```

Acompanhe os logs:

```bash
pm2 logs crm-casa-ads-api --lines 150
pm2 logs crm-casa-ads-worker --lines 100
```

Teste recomendado:

1. Admin encaminha 2 leads para consultor.
2. Consultor entra e abre Tela Hoje e Leads.
3. Admin move múltiplos cards no Kanban.
4. Abra Administração e confirme que duplicados só são consultados ao abrir a aba Duplicados.
5. Confirme que `/api/health` permanece 200 durante os testes.

## Validação realizada neste pacote

- JavaScript de produção alterado: `node --check` sem erro.
- Testes direcionados da Fase 1: aprovados.
- Suíte ampla de backend/migrations: 245 de 246 aprovados.
- Única pendência local: teste XLSX não pôde carregar `exceljs` porque as dependências npm não estão disponíveis neste ambiente de empacotamento.
- Teste de arquitetura: 5 de 5 aprovados; `server/index.js` permanece abaixo do limite de 5.600 linhas.
- O build completo do frontend deve ser executado na VPS, onde `node_modules` está disponível.
