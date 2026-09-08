BOBCRM - Correção de encaminhamento + calendário
Data: 03/09/2026

ARQUIVOS PARA SUBSTITUIR/CRIAR
- src/App.tsx
- src/components/LeadHandoffDialog.tsx
- src/components/BrDateInput.tsx
- src/styles.css
- server/index.js
- server/calendarAndHandoffRegression.test.js (novo teste de regressão)

O QUE FOI CORRIGIDO
1. Encaminhamento de lead
- O lead é recarregado do servidor antes de abrir o encaminhamento.
- Antes de salvar, a versão é atualizada novamente.
- Se houver STALE_WRITE_CONFLICT causado apenas por atualização operacional, o sistema recarrega e tenta uma vez novamente.
- Se consultor/funil/etapa realmente tiverem mudado, o sistema bloqueia e pede revisão.
- O backend não altera mais updated_at em refresh de tarefas quando next_contact_at não mudou.

2. Calendário
- O calendário agora é renderizado via React Portal no document.body.
- Usa position: fixed e camada acima dos modais/drawers.
- Reposiciona em scroll e resize.
- Não fica mais recortado por overflow:hidden/auto dos containers.

COMO APLICAR
1. Faça backup dos arquivos atuais.
2. Extraia este ZIP na raiz do projeto, preservando as pastas e substituindo os arquivos existentes.
3. Rode:
   npm run build
4. Reinicie o processo da aplicação/API conforme o seu ambiente (ex.: PM2).

TESTE DE REGRESSÃO
node --test server/calendarAndHandoffRegression.test.js

Validação feita neste pacote:
- Sintaxe TS/TSX dos 3 arquivos alterados do frontend: OK.
- Teste de regressão: 3/3 aprovado.
