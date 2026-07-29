# BobCRM - Pacote consolidado com todas as fases

Este pacote contém o projeto completo já consolidado com:

- Hotfix do handoff / DATETIME
- Correção da carteira do consultor
- Fase 1: Anti-Queda
- Fase 2: Escalabilidade
- Fase 3: Integridade e Concorrência
- Fase 4: Observabilidade e Manutenção

## Implantação

Extraia o conteúdo deste ZIP diretamente na pasta raiz atual do CRM, substituindo os arquivos existentes e criando os novos.

Exemplo:

```bash
cd /var/www/crm-casa-ads
unzip -o bobcrm-todas-fases-pronto-substituir-20260727.zip
npm ci
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

Se `node_modules` já estiver íntegro, `npm ci` pode ser dispensado. Como o pacote contém alterações acumuladas de frontend e backend, execute `npm run build`.

## Validações depois do restart

```bash
pm2 logs crm-casa-ads-api --lines 150
pm2 logs crm-casa-ads-worker --lines 150
npm run integrity:check
npm run ops:check
```

As migrations são aplicadas automaticamente pela API conforme o mecanismo já existente no projeto.
