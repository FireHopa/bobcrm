# Auditoria comercial

Implementação adicionada sobre o `audit_log` existente, sem migração de banco obrigatória.

## O que passa a ser auditado/exibido

- Lead novo: cadastro manual, importação, WhatsApp interno e integração WhatsApp/Zape.
- Tarefa criada: manual, próxima ação automática, fechamento previsto automático e tarefas automáticas de novos leads importados.
- Tarefa concluída.
- Encaminhamento de SDR para consultor.
- Mudança real de funil ou etapa, inclusive movimentação em lote.
- Contrato fechado ao entrar em etapa `won` / status `Fechado`.
- Sem interesse por motivo de perda ou etapa com esse nome.
- Reabertura de lead, inclusive reativação via WhatsApp.

Reordenação de card dentro da mesma etapa não é contada como movimentação comercial.

## Visão analítica

A aba administrativa de Auditoria Comercial agora abre por padrão em **Análise** e exibe:

- Leads movidos para cada etapa: conta **leads únicos** que chegaram em cada etapa e também mostra o total de movimentações.
- Movimentações por funil.
- Principais transições de etapa (origem -> destino).
- Evolução diária de leads recebidos, movimentações, contratos fechados e registros de sem interesse.
- Indicadores clicáveis que abrem a linha do tempo correspondente.
- Barras de etapa clicáveis para abrir as movimentações daquele funil/etapa.

Os gráficos usam a mesma base auditável dos logs e respeitam período, executor, responsável, origem, funil, etapa e busca. O filtro de tipo de evento é usado para a linha do tempo; os gráficos mantêm o fluxo comercial completo dentro dos demais filtros.

## Nomes de funil e etapa

A visualização resolve os IDs históricos contra `kanban_pipelines` e `kanban_stages` no momento da consulta. Portanto, tanto os logs quanto os gráficos mostram os nomes atuais cadastrados no CRM, inclusive quando o código originalmente criou nomes padrão diferentes. Se um funil/etapa já não existir, o snapshot salvo no evento é usado como fallback.

## Acesso

A rota `/api/commercial-audit` exige a permissão `read_audit`, que no fluxo atual pertence à administração.

## Validação executada

- `node --check server/index.js`
- `node --check server/kanbanWriteService.js`
- `node --check server/commercialAudit.js`
- `node --test server/commercialAudit.test.js` — 6/6 testes aprovados.
- Parse TypeScript/TSX dos arquivos alterados com TypeScript.

O build completo do frontend não foi executado neste ambiente porque as dependências do projeto não estão instaladas na cópia de trabalho. Não inclua `node_modules` do pacote e rode o fluxo normal de instalação/build no servidor.
