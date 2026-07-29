# Fase 3 — Integridade e Concorrência

Data: 27/07/2026
Migration: `20260727_15_integrity_concurrency_phase3`

## Objetivo

Evitar efeitos duplicados, atualizações perdidas e estados parcialmente inconsistentes quando o CRM recebe retries, duplo clique, duas sessões editando o mesmo registro ou reexecução de jobs.

## Alterações principais

### 1. Recibos idempotentes de mutação

Nova tabela MySQL `mutation_receipts`.

Operações protegidas:
- criação de lead;
- edição de lead;
- criação de tarefa;
- conclusão de tarefa;
- movimento individual do Kanban;
- atribuição em lote do Kanban.

O frontend mantém um `requestId` estável durante retries. Se a mesma operação chegar novamente, o backend devolve o resultado já confirmado em vez de repetir o efeito.

### 2. Concorrência otimista

Lead, handoff e movimento do Kanban enviam a versão `updatedAt` que estava visível ao usuário. Se outra sessão alterar o registro antes da gravação, a API responde HTTP 409 (`STALE_WRITE_CONFLICT`) em vez de sobrescrever silenciosamente a alteração mais recente.

### 3. Serialização de tarefas

Edição, conclusão e cancelamento de tarefas críticas bloqueiam a linha com `SELECT ... FOR UPDATE` durante a transação.

Tarefas automáticas com `source_key` agora possuem pré-checagem bloqueada e fallback para `ER_DUP_ENTRY`, protegendo contra corrida entre duas transações.

A conclusão repetida de uma tarefa já concluída é idempotente e não cria outro follow-up.

### 4. Jobs idempotentes

- Importação usa hash do payload + usuário como chave de deduplicação.
- Exportações iguais do mesmo usuário reutilizam job já enfileirado/em execução.
- Retry de backup reutiliza o ID do job e não cria um segundo backup confirmado.
- Auditoria de exportação usa ID determinístico por job.

### 5. Auditoria operacional de integridade

Novos comandos:

```bash
npm run integrity:check
npm run integrity:repair
```

`integrity:check` é somente leitura e verifica:
- tarefas pendentes de leads excluídos;
- tarefas pendentes de leads encerrados/perdidos;
- tarefas órfãs;
- leads com responsável inexistente/inativo;
- tarefas pendentes com responsável inexistente/inativo;
- posições duplicadas no Kanban;
- jobs presos em `running`;
- divergência de `next_contact_at`.

`integrity:repair` executa somente reparos considerados seguros:
- cancela tarefas pendentes incompatíveis com ciclo de vida encerrado/excluído;
- sincroniza `leads.next_contact_at` com a próxima tarefa pendente.

Ele não redistribui carteira nem troca responsáveis automaticamente.

## Instalação

Na raiz do CRM:

```bash
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

Se as dependências não estiverem instaladas:

```bash
npm ci
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

A migration é aplicada automaticamente no boot da API.

## Confirmação da migration

```sql
SELECT version, applied_at
FROM schema_migrations
WHERE version = '20260727_15_integrity_concurrency_phase3';
```

## Pós-deploy recomendado

Primeiro execute somente a auditoria:

```bash
npm run integrity:check
```

Revise o resultado antes de qualquer reparo.

Se houver apenas inconsistências cobertas pelo reparo seguro:

```bash
npm run integrity:repair
npm run integrity:check
```

## Testes manuais importantes

1. Clicar duas vezes para criar o mesmo lead: deve existir apenas um efeito confirmado.
2. Repetir conclusão da mesma tarefa: não deve criar follow-up duplicado.
3. Abrir o mesmo lead em duas sessões, editar na primeira e depois salvar a versão antiga na segunda: a segunda deve receber conflito 409.
4. Abrir handoff e alterar o lead em outra sessão antes de confirmar: o handoff antigo deve ser rejeitado como stale.
5. Arrastar card antigo do Kanban depois de outra sessão ter alterado o lead: deve receber conflito e não sobrescrever a versão atual.
6. Enviar a mesma importação novamente enquanto o job estiver ativo: deve reutilizar o job existente.

## Validação local do pacote

- `server/index.js`: abaixo do limite arquitetural de 5.600 linhas.
- suíte direcionada de arquitetura/concorrência: sem falhas.
- suíte ampla sem dependências opcionais: 270/270 testes aprovados.
- testes que dependem de `fflate`/`exceljs` exigem `node_modules` instalado no ambiente de execução.
