# PERFORMANCE PHASE 11 — FRONTEND

## FASE 11 CONCLUÍDA

### Objetivo

Reduzir custo de renderização, requisições redundantes, cálculos repetidos no React e carregamento inicial do frontend sem alterar regras de negócio, banco de dados ou contratos da API.

---

## Problemas encontrados

### 1. LeadTable carregado de forma eager

`LeadTable` fazia parte do bundle inicial do workspace mesmo quando o usuário estava em outra área do CRM.

### 2. LeadDetailsDrawer lazy, porém montado mesmo fechado

O componente já utilizava `lazy()`, mas permanecia na árvore com `lead={null}`. Na prática, o chunk podia ser solicitado antes de o usuário abrir um lead.

### 3. Busca global possuía dois caminhos possíveis de carregamento

Ao pressionar Enter, o `App` podia iniciar uma consulta direta enquanto o fluxo debounced da listagem também reagia à mesma busca.

### 4. Filtros do Kanban repintavam o board durante a digitação

O estado bruto do input chegava ao board. Além disso, o hook do Kanban possuía um caminho de refresh externo cuja dependência podia provocar carga adicional quando a função de carregamento mudava.

### 5. Busca de leads do Kanban não cancelava requisições antigas

Uma resposta lenta de uma pesquisa anterior podia chegar depois de uma consulta mais nova e sobrescrever os resultados atuais.

### 6. Linhas e cards recalculavam inteligência comercial durante renders do pai

Prioridade, plano recomendado e outros cálculos podiam ser executados novamente mesmo quando o lead daquela linha/card não havia mudado.

### 7. Mapa de oportunidades repetia os mesmos cálculos em filtro, ordenação, resumo e renderização

Métricas comerciais eram recalculadas várias vezes para o mesmo lead dentro do mesmo ciclo lógico.

### 8. Cards fora da viewport ainda participavam do custo de layout/renderização do navegador

Mesmo com limites de paginação, boards largos podem conter centenas de cards montados.

---

## Alterações realizadas

### Code splitting real

`LeadTable` passou para carregamento dinâmico com `React.lazy()`.

`LeadDetailsDrawer` agora só é montado quando existe `selectedLead`, portanto seu chunk só precisa ser carregado quando o usuário realmente abre um lead.

### Callbacks estabilizados

Foram convertidos para `useCallback()` os principais handlers compartilhados entre `App`, tabela, drawer, mapa de oportunidades e módulos operacionais.

Também foi criado `leadsRef` para manter `deleteLead` estável sem depender da identidade do array completo de leads.

### LeadTable e linhas memoizadas

`LeadTable` e `LeadTableRow` utilizam `React.memo()`.

Os cálculos de prioridade, plano comercial e campos faltantes passaram a ficar dentro da fronteira memoizada da linha.

Uma alteração no drawer ou em outro estado do pai não obriga todas as linhas imutáveis a recalcular essas métricas.

### Kanban estabilizado

Os filtros enviados ao board possuem estado estabilizado com debounce de 180 ms.

`KanbanBoard` é memoizado, evitando repintar o board inteiro a cada tecla antes de o filtro estabilizado mudar.

O refresh externo agora reage somente quando `externalRefreshVersion` realmente muda.

### Cards do Kanban memoizados

Foi criado `KanbanCardItem` com `React.memo()`.

Handlers de drag-and-drop usam callbacks estáveis e refs para ler o estado mais recente. Durante `dragover`, mudanças de `dropTarget` deixam de obrigar todos os cards a recalcular `getLeadScores()` e `getRecommendedCommercialPlan()`.

### Cancelamento de busca obsoleta

A busca de leads para adicionar ao Kanban passou a aceitar `AbortSignal`.

Uma nova pesquisa cancela a anterior com `AbortController`, evitando stale response e trabalho desnecessário.

### Mapa de oportunidades

Foi criado `metricsByLeadId`, calculado com `useMemo()` para materializar as métricas por lead uma vez por ciclo de dados carregados.

Comparação estática das chamadas no arquivo:

| Helper | Antes | Depois |
| --- | ---: | ---: |
| `getServiceCounts()` | 15 | 5 |
| `getOpportunityScore()` | 11 | 2 |
| `getCommercialType()` | 5 | 2 |
| `getNextBestOffer()` | 6 | 2 |

Isso representa redução de pontos de recálculo no código. Não é benchmark de tempo de execução.

### Busca global

`handleGlobalSearchSubmit()` não chama mais `loadLeadsFromServer()` diretamente.

A listagem é a única proprietária do caminho de consulta após a busca ser estabilizada.

### Contenção de renderização nativa

Foi criado `src/styles/phase11-performance.css` com `content-visibility: auto`, `contain-intrinsic-size` e contenção de layout nos cards relevantes.

Isso permite ao navegador postergar trabalho de layout/renderização de conteúdo fora da viewport quando suportado.

---

## Virtualização

Não foi adicionada uma nova dependência como `react-window` nesta fase.

Motivos:

- a tabela já possui limite explícito de 150 leads renderizados;
- o Kanban inicia com 30 cards por etapa e usa `load more`;
- memoização e contenção nativa atacam o custo atual sem mudar comportamento de scroll, foco, drag-and-drop ou acessibilidade;
- adicionar uma biblioteca sem profiling real seria uma alteração estrutural maior do que a evidência disponível justifica.

Virtualização deve ser reavaliada se alguma tela passar a exigir deliberadamente centenas ou milhares de linhas/cards simultâneos no DOM.

---

## Comparação estrutural

| Área | Antes | Depois |
| --- | --- | --- |
| `LeadTable` | import eager | lazy chunk |
| `LeadDetailsDrawer` | lazy, porém montado fechado | montado somente com lead aberto |
| Busca global Enter | até 2 caminhos de request | 1 caminho proprietário |
| Filtro do Kanban | estado bruto alcançava board | filtro estabilizado |
| Refresh externo do Kanban | podia reagir à identidade de `loadBoard` | somente nova versão externa |
| Busca interna Kanban | request antigo podia completar depois | request anterior abortado |
| Linha de lead | recalculada em renders do pai | `React.memo()` por linha |
| Card do Kanban | cálculos repetidos durante estado de drag | `React.memo()` por card |
| Mapa de oportunidades | métricas repetidas em várias etapas | métricas materializadas por lead |
| Cards fora da viewport | renderização/layout normal | `content-visibility: auto` |

---

## Banco

Nenhuma migration.

Nenhuma alteração de schema, índice, coluna ou constraint.

---

## Arquivos modificados

- `package.json`
- `src/App.tsx`
- `src/main.tsx`
- `src/components/DailyOperation.tsx`
- `src/components/Header.tsx`
- `src/components/KanbanBoard.tsx`
- `src/components/LeadDetailsDrawer.tsx`
- `src/components/LeadTable.tsx`
- `src/components/ServiceOpportunityMap.tsx`
- `src/features/kanban/useKanbanBoardData.ts`
- `src/utils/api.ts`
- `src/styles/phase11-performance.css`
- `server/phase11FrontendPerformance.test.js`
- `PERFORMANCE_PHASE11.md`

---

## Testes executados

### Testes dedicados da Fase 11 + arquitetura relacionada

`npm run test:phase11-performance`

Resultado:

- 18 testes
- 18 aprovados
- 0 falhas

### Regressão focada

Resultado:

- 51 testes
- 51 aprovados
- 0 falhas

Inclui quick wins, Kanban, worker isolation, cache, handoff, integridade operacional e markup.

### Suíte ampla

Resultado:

- 246 testes
- 242 aprovados
- 4 falhas ambientais

As quatro falhas são causadas por dependências ausentes neste ambiente:

- `fflate`: 2 testes
- `mysql2`: 1 teste
- `exceljs`: 1 teste

Nenhuma falha está relacionada às alterações da Fase 11.

### Sintaxe TypeScript/TSX

A árvore `src` e arquivos TypeScript relacionados foram analisados pelo parser/transpiler TypeScript disponível no ambiente.

Resultado: sintaxe válida.

---

## Limitação de validação deste ambiente

Não foi possível executar um build Vite/React completo nem React DevTools Profiler porque o pacote fornecido não contém `node_modules` e o acesso ao registry utilizado pelo ambiente expirou por timeout durante a tentativa de instalação.

Por esse motivo, não foram inventados:

- tamanho de bundle antes/depois;
- tempo de commit React;
- FPS;
- p95 de renderização;
- redução percentual em milissegundos.

Essas métricas devem ser coletadas no ambiente real após o deploy usando browser Performance/React Profiler.

---

## Riscos e rollback

Risco geral: baixo a moderado, concentrado no frontend.

Não há mudança de dados ou schema.

Rollback consiste em restaurar os arquivos da Fase 10.

Os testes preservam contratos de handoff, permissões, Kanban e comportamento operacional.

---

## Critério de validação em produção

Após deploy, medir principalmente:

1. carregamento inicial antes de acessar Leads;
2. chunk carregado ao abrir Leads;
3. chunk do drawer somente no primeiro lead aberto;
4. React Profiler durante busca e alteração de filtros;
5. quantidade de commits dos cards durante drag-and-drop;
6. Network ao pressionar Enter na busca global;
7. busca rápida em sequência no modal de adicionar lead ao Kanban;
8. custo de renderização do mapa com 100+ leads carregados.

---

## Próxima fase

FASE 12 — Hardening do MySQL.

A próxima etapa deve analisar o servidor MySQL real, buffer pool, conexões, slow query log, temporary tables, I/O e parâmetros somente com evidência de produção.
