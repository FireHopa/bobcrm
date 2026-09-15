CORRECAO - TEMPERATURA DO LEAD PARA CONSULTOR DE VENDAS
Data: 14/09/2026

Problema identificado
---------------------
A permissao do papel consultor_vendas ja autorizava o campo temperature, mas a interface
salvava a temperatura pelo mesmo PUT que atualiza o lead inteiro. Isso fazia uma alteracao
de temperatura poder ser bloqueada por validacao, conflito ou divergencia de outro campo
que o consultor nao estava tentando alterar.

Correcao
--------
1. Nova rota PATCH /api/leads/:id/temperature.
2. A rota aceita apenas: vazio, Frio, Morno ou Quente.
3. Mantem a regra de carteira: o consultor so altera leads aos quais ja possui acesso.
4. A rota atualiza somente a temperatura sobre a versao atual do lead e registra auditoria.
5. Para consultor de vendas, o seletor de temperatura agora salva imediatamente.
6. Admin e pre-venda continuam usando o fluxo normal de edicao completa.
7. Nenhuma migration de banco e necessaria.

Arquivos alterados/criados
--------------------------
- server/index.js
- server/domains/leads/leadTemperature.js (novo)
- src/utils/api.ts
- src/components/LeadDetailsDrawer.tsx

Validacoes executadas
---------------------
- node --check no backend alterado: OK
- testes de rolePolicy + temperatura: 9/9 OK
- parse/transpilacao sintatica dos arquivos TypeScript/TSX alterados: OK
