# CRM Casa do Ads

CRM comercial em React 19, TypeScript, Vite, Node.js e MySQL via `mysql2`.

## Requisitos

- Node.js 20.19 ou superior, 22.12 ou superior, ou Node.js 24.
- MySQL 8 ou versão compatível com InnoDB e `utf8mb4`.
- Um banco de homologação isolado para migrations, testes e validação antes de produção.

## Instalação segura

1. Instale exclusivamente pelo lockfile:

```bash
npm ci
```

2. Copie o exemplo de ambiente e preencha com valores próprios:

```bash
cp server/.env.example server/.env
```

3. Nunca envie `server/.env`, bancos, backups, logs, `node_modules`, `dist` ou dados reais em entregas.

4. Execute a linha de base:

```bash
npm test
npm run build
```

5. Inicie a API somente depois de confirmar que `MYSQL_DATABASE` aponta para uma cópia de homologação. O startup cria estruturas, aplica migrations incrementais e pode criar o administrador inicial. A reconstrução automática do índice só é executada quando `SEARCH_INDEX_REBUILD_ON_START=1`.

```bash
npm start
```

Para desenvolvimento do frontend:

```bash
npm run dev
```

## Papéis oficiais

- `admin`
- `pre_venda`
- `consultor_vendas`

As permissões sensíveis devem ser validadas no backend. O frontend não é uma barreira de segurança.

## Segurança de sessão e proxy

A autenticação de usuários usa cookie `HttpOnly`, `SameSite` e `Secure` em produção. O token reutilizável não é salvo em `localStorage`; somente o hash SHA-256 é persistido na tabela `sessions`. Requisições mutáveis exigem o cabeçalho CSRF emitido para a sessão.

Ao usar proxy reverso, `TRUST_PROXY=1` só é aceito com `TRUST_PROXY_ADDRESSES` configurado. O backend ignora `x-forwarded-for` e `x-forwarded-proto` quando a conexão direta não veio de um proxy autorizado. Ajuste `TRUST_PROXY_HOPS` conforme a quantidade real de proxies no caminho.

O rate limit de login e integração usa a tabela MySQL `rate_limits`, compartilhada entre instâncias, com chaves hash e limpeza periódica por TTL.

## Planilhas

A dependência vulnerável `xlsx` foi removida. Exportações usam `exceljs`. Importações XLSX são carregadas sob demanda em Web Worker, com limite de 15 MB, 50 mil linhas, 200 colunas e 30 segundos. Bases maiores devem ser convertidas para CSV, processado em fluxo. O formato binário `.xls` legado não é aceito.

## Segurança no CI

Execute a mesma sequência usada no pipeline:

```bash
npm run ci
```

Ela executa scanner de segredos, `npm audit`, testes, build e validação da allowlist do release.

## Release seguro

O release deve ser criado somente pelo script baseado em allowlist:

```bash
npm run release:check
npm run release
```

O ZIP é gravado em `release/` e inclui um `RELEASE_MANIFEST.json` com tamanho e SHA-256 de cada arquivo. O processo falha quando encontra arquivos proibidos, links simbólicos ou padrões de segredo.

A allowlist está em `release.allowlist.json`. Alterações nela devem passar pelos testes antes de gerar uma entrega.

## Backups MySQL

A rotina oficial usa `mysqldump` com snapshot consistente para tabelas InnoDB, incluindo tabelas, dados, views, triggers, procedures e eventos. O dump é compactado com gzip, criptografado em streaming com AES-256-GCM e validado antes de ser registrado como disponível.

### Requisitos do servidor

- Cliente `mysqldump` compatível com a versão do MySQL.
- Cliente `mysql` para testes e restauração.
- `BACKUP_EXTERNAL_DIR` apontando para volume externo ou volume montado fora da pasta do projeto.
- `BACKUP_ENCRYPTION_KEY` com exatamente 32 bytes em Base64 ou 64 caracteres hexadecimais.

Gere uma chave Base64 segura:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

A chave não é armazenada dentro do backup. Guarde-a em cofre de segredos separado. Sem ela, o arquivo `.cadbkp` não pode ser restaurado.

### Criação e retenção

O administrador pode criar o backup pela tela Administração. O arquivo é salvo somente após:

1. `mysqldump` concluir sem erro.
2. A compactação e criptografia terminarem.
3. O hash SHA-256 ser calculado.
4. A autenticação AES-GCM e a descompressão serem verificadas.

A retenção usa simultaneamente:

- `BACKUP_RETENTION_DAYS`
- `BACKUP_RETENTION_COUNT`

A rotina nunca remove os backups mais recentes dentro da quantidade mínima configurada. Backups expirados permanecem registrados para auditoria, mas o arquivo é removido do armazenamento externo.

### Teste real de restauração

Execute somente contra um MySQL descartável e com permissão para criar e excluir bancos de teste:

```bash
npm run test:backup:restore
```

O teste cria uma origem temporária, inclui tabelas relacionadas, view, trigger e procedure, gera um backup criptografado, restaura em outro banco vazio, compara os dados e remove os bancos de teste ao final.

Variáveis opcionais para o MySQL de teste:

```txt
BACKUP_TEST_MYSQL_HOST
BACKUP_TEST_MYSQL_PORT
BACKUP_TEST_MYSQL_USER
BACKUP_TEST_MYSQL_PASSWORD
```

### Restauração operacional

Por padrão, a restauração só aceita banco vazio cujo nome começa com `BACKUP_RESTORE_DATABASE_PREFIX`:

```bash
npm run backup:restore -- --file /volume/backups/arquivo.cadbkp --target crm_restore_test_validacao
```

Para recuperação de desastre em outro nome, são exigidas duas confirmações explícitas:

```txt
BACKUP_RESTORE_ALLOW_ANY_TARGET=1
BACKUP_RESTORE_CONFIRM_DATABASE=nome_exato_do_banco_vazio
```

O comando nunca restaura sobre o banco de origem e nunca apaga ou trunca um banco existente. Se o destino já contiver tabelas, a operação é bloqueada.

### Compatibilidade temporária

A rota legada `GET /api/backup/sqlite` continua disponível temporariamente, mas agora apenas cria um job de backup MySQL criptografado e retorna HTTP 202. Ela envia cabeçalhos de depreciação e será removida após a migração dos clientes para `POST /api/backups` e o acompanhamento por `/api/jobs/:id`.

O backup manual já é executado pelo worker persistente. A periodicidade continua sob responsabilidade de um agendador externo monitorado até existir um agendador interno com alertas operacionais.

## Jobs assíncronos e artifacts

Backup, importação, exportação CSV/XLSX e reconstrução do índice de busca são executados por uma fila persistente na tabela `async_jobs`.

Fluxo HTTP:

1. A operação retorna HTTP 202 com o identificador do job.
2. O cliente acompanha `GET /api/jobs/:id`.
3. Exportações concluídas são baixadas por `GET /api/jobs/:id/download`.
4. Artifacts temporários expiram conforme `JOB_ARTIFACT_TTL_HOURS`.
5. Registros finalizados são removidos conforme `JOB_RETENTION_DAYS`.

O worker usa claim atômico, heartbeat, chave de deduplicação, recuperação de jobs órfãos e limite configurável de concorrência. O diretório `JOB_ARTIFACT_DIR` deve ficar fora do projeto em produção. Payloads temporários usam permissão `0600` e são removidos depois da conclusão ou falha final.

Exportações usam paginação por cursor e escrita por streaming. CSV e XLSX não são montados integralmente em memória. A importação permanece limitada pelo `MAX_BODY_BYTES` e é persistida de forma compactada antes de entrar na fila.

## Concorrência e MySQL

A fila global que serializava todas as gravações foi removida. Cada caso de uso mantém sua própria transação. Deadlocks, `lock wait timeout` e quedas de conexão anteriores ao `COMMIT` refazem a transação inteira com backoff limitado. Uma queda durante o `COMMIT` não é repetida silenciosamente, pois o resultado pode ser ambíguo.

Alterações de identidade do lead, como e-mail, telefone, importação e mesclagem, usam um lock nomeado específico no MySQL. Esse lock evita duplicidades concorrentes sem bloquear tarefas, notas, Kanban, usuários e outras gravações independentes. Operações de Kanban usam locks de linha na etapa e no lead para manter a posição consistente.

## Health checks e encerramento

- `GET /health/live`: confirma que o processo Node.js está vivo e não depende do MySQL.
- `GET /health/ready`: valida MySQL, worker e estado de encerramento. Retorna HTTP 503 quando a instância não deve receber tráfego.
- `GET /api/health`: mantém o health autenticado/operacional usado pela interface.

Em `SIGTERM` ou `SIGINT`, a API para de aceitar novas conexões, aguarda requisições e jobs ativos até `GRACEFUL_SHUTDOWN_TIMEOUT_MS`, interrompe retries, fecha o pool MySQL e força apenas conexões remanescentes após o timeout.

Respostas JSON e assets textuais acima do limite são comprimidos com Brotli ou gzip. Assets com hash recebem cache imutável de um ano; HTML continua com `no-cache`.

## Banco legado

O arquivo SQLite existente é legado e serve apenas como origem para migração manual. O backend operacional atual usa MySQL.

```bash
npm run migrate:sqlite:mysql
```

Execute a migração somente sobre banco de destino isolado e após uma cópia verificável da origem.

## Verificações disponíveis

```bash
npm run security:scan
npm run security:audit
npm run ci
npm test
npm run test:security
npm run test:integration
npm run test:release
npm run test:backup
npm run test:backup:restore
npm run build
npm run release:check
```

## Estado atual e operação local

- A carga inicial de leads usa 150 registros por página, com paginação para os demais.
- O Kanban cancela requisições antigas quando filtros mudam e carrega somente os cartões necessários.
- O modo de desenvolvimento não usa `React.StrictMode`, evitando efeitos e chamadas HTTP duplicadas durante a operação local.
- `SEARCH_INDEX_REBUILD_ON_START` fica desativado por padrão e deve ser habilitado apenas quando houver necessidade operacional.
- O backend diferencia falha real de banco de erros esperados durante `SIGINT` ou `SIGTERM`, evitando cascatas de `INTERNAL_ERROR` no encerramento.
- A homologação de migrations, E2E e carga continua exigindo um MySQL descartável.

Consulte `SETUP_WINDOWS.md` para instalar o pacote em uma pasta nova e copiar somente o `.env` local.

## Fase 6: arquitetura, testes completos e CI

A aplicação preserva os contratos de API existentes, mas distribui responsabilidades antes concentradas em arquivos grandes:

- `server/domains/leads/leadMapper.js`: normalização e transformação de leads.
- `server/http/staticAssets.js`: entrega segura, cache e compressão dos assets.
- `src/features/import/importModel.ts`: leitura, validação e preparação de importações.
- `src/features/kanban/useKanbanBoardData.ts`: carregamento e atualização do Kanban.
- `src/features/leads/leadDrawerModel.ts` e `LeadDetailsPanels.tsx`: formulário e painéis do drawer.
- `src/styles/phase5-ux.css`: bloco de UX separado sem alterar a ordem visual.

Os módulos pesados de importação, Administração, Oportunidades, drawer e Kanban usam carregamento dinâmico.

### Testes locais

```bash
npm ci
npm test
npm run build
npm run test:e2e:list
npm run security:scan
npm run security:audit
npm run release:check
```

### Integração com MySQL descartável

Nunca aponte estes testes para o banco operacional. Use um MySQL isolado e um usuário capaz de criar e remover bancos temporários:

```bash
MYSQL_TEST_HOST=127.0.0.1 \
MYSQL_TEST_PORT=3306 \
MYSQL_TEST_USER=root \
MYSQL_TEST_PASSWORD='senha-do-mysql-descartavel' \
npm run test:mysql
```

A suíte cria bancos com prefixo `crm_phase6_`, aplica schema e migrations, testa HTTP, papéis, tarefas, encaminhamento, Kanban, duplicados, lixeira e reinicialização idempotente, e remove o banco ao terminar.

### E2E

O Playwright espera um CRM de teste já iniciado e nunca usa credenciais de produção:

```bash
E2E_BASE_URL=http://127.0.0.1:3106 \
E2E_ADMIN_EMAIL=admin.phase6@example.test \
E2E_ADMIN_PASSWORD='senha-exclusiva-de-teste' \
npm run test:e2e
```

### Carga com 133 mil leads

O teste cria e apaga um banco descartável, sem usar dados reais:

```bash
RUN_LOAD_TEST=1 \
MYSQL_TEST_HOST=127.0.0.1 \
MYSQL_TEST_PORT=3306 \
MYSQL_TEST_USER=root \
MYSQL_TEST_PASSWORD='senha-do-mysql-descartavel' \
npm run test:load
```

Sem `RUN_LOAD_TEST=1`, o comando executa apenas uma validação seca da configuração.
