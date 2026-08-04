# BobCRM — Importação direta para funil e etapa

## O que foi adicionado

Na etapa **Definir destino e dados padrão da importação**, agora é possível escolher:

- Funil de destino
- Etapa inicial
- Modo automático pelo status, preservando o comportamento anterior

Quando um funil e uma etapa são selecionados:

- Leads novos entram diretamente no destino escolhido.
- Leads duplicados que forem mesclados também são enviados ao destino escolhido.
- O status do lead acompanha a configuração da etapa.
- O destino é validado novamente no backend antes de o job começar.
- Funil arquivado, etapa arquivada ou etapa de outro funil são recusados.
- O funil e a etapa entram na chave de deduplicação do job.
- O destino fica registrado na auditoria da importação.

## Banco de dados

Não existe migration de banco. As colunas `pipeline_id` e `pipeline_stage_id` já existem.

## Instalação

Faça backup dos arquivos atuais:

```bash
cd /var/www/crm-casa-ads
mkdir -p backup-importacao-funil
cp src/components/ImportLeads.tsx backup-importacao-funil/
cp src/features/import/importModel.ts backup-importacao-funil/
cp src/App.tsx backup-importacao-funil/
cp src/utils/api.ts backup-importacao-funil/
cp src/styles.css backup-importacao-funil/
cp server/domains/leads/importBatch.js backup-importacao-funil/
cp server/index.js backup-importacao-funil/
cp server/phase7ImportBatch.test.js backup-importacao-funil/
```

Extraia este ZIP sobre a raiz do CRM, preservando as pastas:

```bash
unzip -o BobCRM_Importacao_Direto_Funil_PATCH.zip -d /var/www/crm-casa-ads
cd /var/www/crm-casa-ads
```

Valide:

```bash
node --check server/index.js
node --check server/domains/leads/importBatch.js
node --check server/domains/leads/importKanbanTarget.js
node --test server/phase7ImportBatch.test.js server/phase6ArchitectureWiring.test.js server/phase11FrontendPerformance.test.js server/phase4ReliabilityWiring.test.js
npm run build
```

Reinicie:

```bash
pm2 restart crm-casa-ads-api crm-casa-ads-worker --update-env
pm2 save
```

## Teste funcional

1. Abra **Importar**.
2. Envie um CSV ou XLSX pequeno.
3. Faça o mapeamento.
4. Em **Definir destino e dados padrão da importação**, escolha o funil.
5. Escolha a etapa inicial.
6. Confirme o destino na prévia.
7. Importe.
8. Abra o Kanban e confirme os leads na etapa selecionada.

Teste também um lead já existente. Ele deve ser mesclado e movido para o destino escolhido.
