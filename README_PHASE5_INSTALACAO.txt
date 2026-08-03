BobCRM Fase 5 Hot/Cold Leads

Este hotfix pressupõe que a base cumulativa das Fases 1 a 4 já esteja instalada.
Extraia na raiz do CRM substituindo/criando os arquivos.

Depois execute:
  npm ci
  npm run build
  pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env

Migration esperada:
  20260729_17_hot_cold_leads_phase5

A primeira redução da base quente ocorre gradualmente pelo worker.
