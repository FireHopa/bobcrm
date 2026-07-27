# PERFORMANCE — FASE 1: QUICK WINS DE ALTO IMPACTO

Data: 23/07/2026
Base: BobCRM após Fase 0 de observabilidade

## FASE 1 CONCLUÍDA

### Objetivo

Reduzir payload, leituras desnecessárias no MySQL e requisições obsoletas sem alterar regras comerciais, schema ou comportamento funcional do CRM.

Esta fase implementa os quick wins previstos no plano mestre:

1. remover `SELECT *` das rotas críticas;
2. separar `LEAD SUMMARY` de `LEAD DETAIL`;
3. reforçar paginação server-side;
4. cancelar/deduplicar requisições de listagem no frontend.

---

## 1. Problema encontrado

As telas de listagem e Kanban buscavam o registro completo de `leads`, embora a interface utilize somente uma fração das colunas.

Isso transportava campos pesados como:

- `commercial_notes`;
- `pain`;
- `search_text`;
- `service_interests`;
- `service_status_map`;
- `custom_fields`.

Além disso:

- o Kanban carregava o lead completo para cada card;
- a lixeira não possuía paginação server-side adequada;
- a administração de duplicados poderia transportar o lead completo;
- novas listagens podiam coexistir com requests anteriores ainda em andamento;
- o frontend dependia do objeto da listagem para abrir/editar o lead, o que impedia reduzir o payload com segurança.

---

## 2. Causa

O contrato anterior tratava o mesmo objeto de lead como se servisse simultaneamente para:

- tabela;
- Kanban;
- mapa de oportunidades;
- lixeira;
- detecção de duplicados;
- detalhe/edição.

Na prática, cada contexto possui necessidades de dados diferentes.

O resultado era um contrato superdimensionado e alto acoplamento entre listagem e edição.

---

## 3. Solução implementada

### 3.1 Projeções de lead por contexto

Novo módulo:

`server/domains/leads/leadProjections.js`

Projeções criadas:

| Contexto | Colunas retornadas |
| --- | ---: |
| Lista padrão | 26 |
| Mapa de oportunidades | 30 |
| Kanban | 17 |
| Lixeira | 17 |
| Duplicados | 16 |
| Rebuild do índice de busca | 19 |

A listagem padrão não transporta mais os campos comerciais JSON/MEDIUMTEXT pesados.

O mapa de oportunidades recebe apenas o contexto comercial que realmente utiliza.

### 3.2 LEAD SUMMARY x LEAD DETAIL

A listagem usa um objeto resumido.

Ao abrir um lead, o frontend agora executa a leitura completa por ID antes de abrir o drawer:

`GET /api/leads/:id`

O endpoint de detalhe continua autorizado a usar o registro completo porque é exatamente o contexto no qual todos os dados podem ser necessários.

Também foi protegido o update silencioso do mapa de oportunidades: antes do `PUT`, o frontend hidrata o lead completo para não sobrescrever campos que foram omitidos do objeto resumido.

### 3.3 Kanban

Os cards do Kanban deixaram de usar `SELECT *`.

A busca do Kanban também passou a selecionar explicitamente apenas os campos necessários para exibição e contexto de funil.

Esta fase reduz o tamanho de cada card transportado. A eliminação estrutural do N+1 por coluna permanece para a Fase 5 do plano mestre.

### 3.4 Lixeira paginada

`GET /api/leads/deleted` agora aceita:

- `limit`;
- `offset`.

Limites:

- padrão: 100;
- máximo: 200.

A resposta inclui:

- `total`;
- `limit`;
- `offset`;
- `hasMore`.

O frontend recebeu `Carregar mais`, evitando carregar toda a lixeira de uma vez.

### 3.5 Administração de duplicados

A consulta dos grupos duplicados agora recebe uma projeção explícita em vez de transportar o objeto completo de lead.

As rotinas que realmente precisam do objeto completo para mesclagem continuam intactas.

### 3.6 Rebuild do índice de busca

O rebuild deixou de executar `SELECT *` e passou a buscar apenas os campos utilizados para construir `search_text`.

### 3.7 Auditoria administrativa

A listagem recente de auditoria não carrega mais `changes_json` para todos os registros.

O detalhe específico de auditoria continua podendo carregar as alterações completas quando necessário.

### 3.8 Cancelamento de requests obsoletos

A listagem principal de leads agora usa `AbortController`.

Quando filtros, paginação ou refresh disparam uma nova listagem, o request anterior é abortado e sua resposta não concorre para atualizar o estado da tela.

---

## 4. Evidências estruturais antes/depois

### server/index.js

Contagem de `SELECT *`/`SELECT alias.*` no arquivo principal:

| Estado | Ocorrências |
| --- | ---: |
| Fase 0 | 52 |
| Fase 1 | 45 |
| Redução | 7 |

A redução foi feita somente onde havia segurança funcional. Leituras unitárias completas, mesclagem de duplicados e outros fluxos que realmente dependem do objeto integral não foram convertidos cegamente.

### Payload da lista

Antes:

```sql
SELECT * FROM leads ...
```

Depois:

```sql
SELECT <26 campos necessários> FROM leads ...
```

Campos pesados removidos da listagem padrão:

```text
commercial_notes
pain
search_text
service_interests
service_status_map
custom_fields
```

### Kanban

Antes:

```sql
SELECT * FROM leads ...
```

Depois:

```text
17 campos por card
```

### Lixeira

Antes:

```text
consulta sem contrato de paginação da tela
```

Depois:

```text
100 registros por página por padrão
máximo 200
load more
COUNT total separado
```

---

## 5. Performance antes/depois

### Resultado estrutural comprovado neste ambiente

Foi comprovada redução de colunas, payload potencial, `SELECT *` e concorrência de requests.

### p95 real

Não foi inventado benchmark de tempo.

Este pacote não possui:

- o MySQL de produção;
- a base real de aproximadamente 133 mil leads;
- a infraestrutura da VPS;
- dependências instaladas em `node_modules`.

Portanto, os números reais de `p50/p95/p99`, tempo SQL e tamanho de payload devem ser coletados na infraestrutura real utilizando a observabilidade implantada na Fase 0.

---

## 6. Banco de dados

Nenhuma migration criada.

Nenhuma coluna alterada.

Nenhum índice alterado.

Nenhuma modificação destrutiva.

Rollback da Fase 1 é feito apenas restaurando os arquivos da Fase 0.

---

## 7. Arquivos modificados

- `server/index.js`
- `server/duplicateDetection.js`
- `src/App.tsx`
- `src/components/SettingsCenter.tsx`
- `src/utils/api.ts`

## 8. Arquivos criados

- `server/domains/leads/leadProjections.js`
- `server/phase1QuickWins.test.js`
- `PERFORMANCE_PHASE1.md`

---

## 9. Testes executados

### Testes focados da Fase 1

Resultado:

```text
38 testes
38 aprovados
0 falhas
```

Incluem:

- projeções de listagem;
- projeção do mapa de oportunidades;
- Kanban;
- lixeira;
- duplicados;
- summary/detail;
- AbortController;
- hidratação segura antes de update;
- arquitetura;
- permissões;
- mapeamento de leads;
- observabilidade.

### Validação de sintaxe

Executado com sucesso:

```text
node --check server/index.js
node --check server/duplicateDetection.js
node --check server/domains/leads/leadProjections.js
node --check server/phase1QuickWins.test.js
```

### Suíte ampla do backend

Resultado:

```text
157 testes
153 aprovados
4 falhas ambientais
```

As quatro falhas são:

1. integração MySQL: pacote `mysql2` ausente porque o ZIP não contém `node_modules`;
2. exportação XLSX: pacote `exceljs` ausente pelo mesmo motivo;
3. teste de reliability: `server/.env.example` não existe no repositório recebido;
4. teste de runtime stability: `server/.env.example` não existe no repositório recebido.

O teste arquitetural de tamanho do `server/index.js` está verde. O arquivo terminou abaixo do limite exigido pela própria suíte.

---

## 10. Riscos e compatibilidade

### Risco baixo: detalhe gera um GET específico

Ao abrir um lead existe agora uma leitura por ID para hidratar o objeto completo.

Trade-off intencional:

- a listagem de centenas de leads fica muito mais enxuta;
- somente o lead realmente aberto recebe o payload completo.

### Risco controlado: mapa de oportunidades

O mapa recebe objeto resumido, mas o update silencioso busca o detalhe completo antes de persistir. Isso evita apagar notas ou campos que não vieram na listagem.

### Compatibilidade

Não foram alterados:

- permissões;
- usuários;
- times;
- regras de responsável;
- regras do Kanban;
- status comerciais;
- webhooks;
- formato persistido no MySQL;
- schema;
- migrations.

---

## 11. Validação recomendada em produção/staging

Depois de substituir os arquivos, coletar com a Fase 0:

1. `GET /api/leads` com 100/200 registros;
2. busca com termos comuns;
3. abertura do detalhe do lead;
4. Kanban inicial;
5. lixeira;
6. mapa de oportunidades;
7. editar e salvar lead com notas e dados comerciais;
8. monitorar SQL time, query count e payload.

Comparar principalmente:

- p95 de `/api/leads`;
- bytes transferidos;
- heap/RSS durante navegação;
- tempo SQL;
- requests abortados/repetidos;
- comportamento com vários filtros consecutivos.

---

## 12. Próxima fase

**FASE 2 — MATERIALIZAÇÃO DA INTELIGÊNCIA COMERCIAL**

É a próxima otimização de maior impacto esperado.

Objetivo:

- parar de recalcular inteligência comercial sobre milhares de leads durante a abertura de telas;
- centralizar os cálculos;
- materializar scores e flags;
- criar backfill em batches;
- preparar queries simples e indexáveis.

A Fase 2 não foi iniciada neste pacote.
