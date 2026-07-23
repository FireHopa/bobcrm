# Migração segura do CRM para MySQL

Este projeto usa MySQL como banco principal. O script de migração lê o SQLite legado e copia os registros em lotes.

## Regra de segurança atual

Por padrão, a migração opera em modo **somente novos registros**:

- IDs que já existem no MySQL não são sobrescritos.
- O script pode ser executado novamente sem reverter alterações feitas depois no CRM.
- A quantidade de leads no destino é validada antes e depois.

Essa mudança evita que uma cópia antiga do SQLite sobrescreva dados mais recentes do MySQL.

## 1. Preparar o ambiente

Copie `server/.env.example` para `server/.env` e ajuste as credenciais locais. Não versione nem compartilhe o `.env`.

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=crm_app
MYSQL_PASSWORD=SUBSTITUA_POR_UMA_SENHA_FORTE
MYSQL_DATABASE=crm_casa_ads
SQLITE_FILE=server/data/crm.sqlite
MIGRATION_BATCH_SIZE=500
```

## 2. Fazer backup verificável

Antes da primeira migração:

1. Gere um backup do MySQL.
2. Confirme que o arquivo existe e possui tamanho coerente.
3. Teste a restauração em um banco separado quando o ambiente for de produção.
4. Preserve o SQLite original sem alterações.

## 3. Executar a migração segura

```bash
npm install
npm run migrate:sqlite:mysql
```

O script informa:

- Quantidade no SQLite.
- Quantidade no MySQL antes.
- Quantidade no MySQL depois.
- Progresso dos lotes.

## Sobrescrita explícita

Use somente quando for necessário sincronizar novamente os dados do SQLite sobre registros já existentes no MySQL.

A sobrescrita exige dois sinalizadores:

```env
MIGRATION_OVERWRITE_EXISTING=1
MIGRATION_BACKUP_CONFIRMED=1
```

Sem a confirmação de backup, o script interrompe a execução.

Atenção: esse modo pode substituir alterações mais recentes realizadas diretamente no MySQL. Utilize apenas com uma cópia validada e uma janela de manutenção.

## Pacotes grandes do MySQL

O script consulta `max_allowed_packet` e divide automaticamente os INSERTs. Para forçar lotes menores:

```env
MIGRATION_INSERT_ROWS_LIMIT=25
MIGRATION_INSERT_PAYLOAD_BYTES=131072
```

## Validação recomendada após a migração

Execute no MySQL:

```sql
SELECT COUNT(*) FROM leads;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM audit_log;
SELECT COUNT(*) FROM backups;
```

Também valide amostras anonimizadas de:

- E-mail e telefone normalizados.
- Responsável.
- Próximo contato.
- Status.
- Serviços.
- Lixeira.
- Histórico.

Não use a base real em homologação sem anonimização.
