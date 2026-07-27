# PERFORMANCE PHASE 10 — CACHE INTELIGENTE

## Objetivo

Reduzir consultas repetidas depois das otimizações SQL das Fases 1–9, sem usar cache para esconder query ruim e sem invalidar todos os caches em qualquer transação.

## Problema encontrado

O BobCRM já possuía um cache curto para o snapshot de leads, porém a invalidação estava acoplada ao helper genérico `withTransaction()`.

Na prática, qualquer transação bem-sucedida executava `invalidateLeadSummaryCache()`, inclusive transações de tarefas, usuários, equipes e outros domínios. O resultado era um cache com TTL de 15 segundos que frequentemente era apagado antes de poder gerar hits relevantes.

Também havia consultas de metadados estáveis executadas repetidamente:

- membros da equipe usados para construir o escopo de acesso;
- lista de equipes;
- usuários administráveis;
- usuários atribuíveis;
- opções de responsáveis da listagem;
- catálogo resumido de pipelines.

## Causa

1. Invalidação global acoplada à abstração de transação.
2. Ausência de cache por domínio para metadados estáveis.
3. Cache de resumo sem deduplicação de carregamentos simultâneos.
4. Chave de cache de equipe incluía o usuário, embora usuários da mesma equipe compartilhem o mesmo escopo de leads.

## Alterações realizadas

### 1. Cache TTL reutilizável

Criado `server/runtimeCache.js` com:

- TTL;
- limite máximo de entradas;
- aproximação LRU;
- deduplicação de loads simultâneos;
- invalidação por chave;
- invalidação por prefixo;
- estatísticas internas.

### 2. Resumo de leads por escopo

As chaves agora são semânticas:

- `all`
- `team:<teamId>`
- `own:<userId>`
- `none:<userId>`

Dois usuários com acesso `team` à mesma equipe podem reutilizar o mesmo snapshot.

O cache continua com TTL padrão de 15 segundos e passa a deduplicar concorrência. Se cinco requests chegarem simultaneamente quando a chave estiver fria, apenas um loader SQL é executado e os demais aguardam a mesma Promise.

### 3. Remoção da invalidação genérica

`withTransaction()` não invalida mais cache automaticamente.

Existem 32 call sites de `withTransaction()` no backend. Antes, todos eles derrubavam o snapshot de leads após uma transação bem-sucedida. Agora a invalidação é feita apenas nos fluxos que realmente alteram o domínio correspondente.

### 4. Cache de diretório

TTL padrão: 30 segundos.

Cacheados:

- `team-members:<teamId>`
- `teams:all`
- `users:assignable`
- `users:all`

Criação, edição ou desativação de usuário/equipe chama `invalidateDirectoryCaches()`, que limpa somente esse domínio e snapshots de equipe afetados genericamente.

### 5. Opções de responsáveis

`/api/leads/filter-options` passou a usar cache por escopo com TTL padrão de 15 segundos.

Antes, reabrir filtros executava novamente o `GROUP BY responsible`.

Agora:

- primeira leitura: 1 query;
- leituras dentro do TTL: 0 queries;
- alteração relevante: invalidação da chave global ou do escopo conhecido;
- alteração feita pelo worker: TTL limita a defasagem máxima.

### 6. Catálogo do Kanban

`/api/kanban/pipelines` possui cache curto de 5 segundos por escopo.

O TTL é propositalmente menor porque a resposta contém contagens de cards.

A estrutura do Kanban e as contagens possuem invalidações separadas:

- alteração de pipeline/etapa: invalida estrutura + contagens;
- movimento de card: invalida somente contagens;
- save de lead: invalida somente contagens.

Isso evita reconstruir o cache estrutural padrão em uma simples edição de card.

## Resultado estrutural

| Cenário | Antes | Fase 10 |
| --- | ---: | ---: |
| 5 requests simultâneos ao resumo com cache frio | até 5 loads SQL | 1 load SQL |
| 20 requests de usuário `team` em 30s | até 20 queries de membros | 1 query de membros |
| Reabrir lista de equipes dentro de 30s | 1 query por abertura | 0 após o primeiro load |
| Reabrir usuários atribuíveis dentro de 30s | 1 query por abertura | 0 após o primeiro load |
| Reabrir opções de responsáveis em 15s | 1 agregação por abertura | 0 após o primeiro load |
| Repetir catálogo Kanban em 5s | 1 query por request | 0 após o primeiro load |
| Transação sem relação com leads | invalidava resumo | não invalida resumo |

Os percentuais dependem do padrão real de navegação. Exemplo: 20 chamadas do mesmo usuário de equipe em uma janela de 30 segundos passam de até 20 queries de resolução de membros para 1, redução estrutural de 95% nesse componente específico.

## Configuração

Novas variáveis opcionais:

```env
LEAD_SUMMARY_CACHE_MS=15000
METADATA_CACHE_MS=30000
FILTER_OPTIONS_CACHE_MS=15000
```

Limites de segurança definidos no código impedem TTLs indefinidos.

## Banco

Nenhuma migration.

Nenhum índice criado ou removido.

Nenhuma coluna alterada.

## Compatibilidade API + worker

O cache é local em memória por processo. Como API e worker estão separados desde a Fase 6, uma importação executada no worker não consegue invalidar instantaneamente a memória da API.

A estratégia adotada nesta fase é deliberadamente simples e segura:

- resumo: defasagem máxima padrão de 15s;
- filtros: defasagem máxima padrão de 15s;
- metadados: 30s;
- catálogo Kanban: 5s.

Não foi introduzido Redis, Pub/Sub ou uma tabela de versões apenas para resolver poucos segundos de consistência eventual. Se o produto futuramente exigir invalidação cross-process em tempo real, esse pode ser o próximo passo arquitetural.

## Testes

### Foco Fases 0–10

67/67 testes aprovados.

### Fase 10 dedicada

17/17 testes aprovados no conjunto dedicado, incluindo cache TTL e integração arquitetural.

### Suíte ampla

234/238 testes aprovados.

As 4 falhas restantes são ambientais e não relacionadas às alterações:

- `fflate`: 2 testes;
- `mysql2`: 1 teste;
- `exceljs`: 1 teste.

Todos os arquivos `.js` e `.mjs` passaram em `node --check`.

## Arquivos modificados/criados

- `server/index.js`
- `server/runtimeCache.js`
- `server/runtimeCache.test.js`
- `server/phase10SmartCache.test.js`
- `server/.env.example`
- `package.json`
- `PERFORMANCE_PHASE10.md`

## Riscos

1. Consistência eventual de alguns segundos quando a alteração vem do worker separado.
2. Valores de TTL muito altos podem deixar metadados visualmente defasados; por isso existem limites.
3. Cache em memória não é compartilhado entre múltiplas instâncias da API. Se futuramente a API usar cluster horizontal, avaliar cache/versionamento compartilhado.

## Rollback

Não há migration. O rollback consiste em restaurar os arquivos da Fase 9.

## Próxima fase

FASE 11 — Frontend:

- React Profiler;
- re-renderizações excessivas;
- contexts/estado global;
- listas grandes;
- virtualização;
- code splitting;
- payloads e requisições duplicadas restantes.
