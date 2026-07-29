# Hotfix CRM - carteira de consultor / pool MySQL - 2026-07-27

## O que este pacote corrige

1. Mantém o hotfix anterior do handoff/datas ISO (`20260727_11`).
2. Carteira própria do consultor usa `responsible_user_id` diretamente, sem o fallback legado com `OR + TRIM + LOWER`.
3. Reexecuta o backfill de `responsible_user_id` para registros legados vinculáveis aos usuários atuais.
4. Cria o índice `idx_leads_owner_updated_id (deleted_at, responsible_user_id, updated_at, id)`.
5. Aplica limite operacional de 4s às consultas interativas de leads da carteira própria para evitar queries zumbis monopolizando o pool.
6. Impede sobreposição dos scans de prontidão de DATETIME e inteligência comercial.

## Instalação

Extraia o ZIP de hotfix na raiz do CRM, preservando a pasta `server/` e substituindo os arquivos existentes.

Não há alteração de frontend e não é necessário rebuild do Vite para este hotfix.

Reinicie a API:

```bash
pm2 restart crm-casa-ads-api
```

A API executará automaticamente as migrations pendentes no boot.

Verifique os logs:

```bash
pm2 logs crm-casa-ads-api --lines 150
```

## Verificação no MySQL

```sql
SELECT version, applied_at
FROM schema_migrations
WHERE version IN (
  '20260727_11_fix_datetime_bridge_iso8601',
  '20260727_12_consultant_portfolio_performance'
)
ORDER BY version;
```

```sql
SHOW INDEX FROM leads WHERE Key_name = 'idx_leads_owner_updated_id';
```

## Teste funcional recomendado

1. Entrar como administrador.
2. Encaminhar 2 leads para um consultor.
3. Entrar como esse consultor.
4. Abrir a listagem de leads e o dashboard do dia.
5. Confirmar que somente a carteira autorizada aparece e observar `GET /api/leads`, `/api/leads/summary`, `/api/leads/filter-options` e `/api/today` nos logs.

O hotfix foi validado com 47 testes focados/estruturais, todos aprovados.
