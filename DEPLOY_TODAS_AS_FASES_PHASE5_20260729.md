# Deploy consolidado — Fases 1 a 5

Este pacote é cumulativo e pode ser extraído diretamente sobre a raiz atual do CRM.

Inclui:

- correção do handoff/DATETIME;
- carteira do consultor;
- Fase 1 Anti-Queda;
- Fase 2 Escalabilidade;
- Fase 3 Integridade e Concorrência;
- Fase 4 Observabilidade e Manutenção;
- Fase 5 Hot/Cold Leads.

## Instalação

Faça backup da aplicação e do MySQL antes da substituição.

```bash
cd /var/www/crm-casa-ads
npm ci
npm run build
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
```

## Depois do restart

```bash
pm2 logs crm-casa-ads-api --lines 150
pm2 logs crm-casa-ads-worker --lines 200
npm run integrity:check
npm run ops:check
```

A migration mais nova esperada é:

```text
20260729_17_hot_cold_leads_phase5
```

O worker fará o arquivamento inicial gradualmente. Não interrompa o MySQL apenas porque a contagem não caiu imediatamente para 30.000.
