# BobCRM Final — Deploy das Fases 0 a 13

Este pacote é cumulativo. Ele já contém todas as alterações das Fases 0 a 13. Não aplique os ZIPs das fases anteriores antes deste pacote.

## 1. Antes de substituir os arquivos

Faça backup da aplicação e do MySQL.

Exemplo de backup da pasta atual:

```bash
cp -a /var/www/crm-casa-ads /var/www/crm-casa-ads.backup-$(date +%Y%m%d-%H%M%S)
```

Faça também um dump válido do banco MySQL usando o procedimento já adotado no servidor.

## 2. Preserve o ambiente

O pacote contém `server/.env.example`, mas NÃO contém `server/.env`.

Portanto, ao extrair sobre a aplicação atual, o `.env` existente deve permanecer intacto. Confirme antes do restart:

```bash
test -f /var/www/crm-casa-ads/server/.env && echo "ENV OK"
```

## 3. Extrair o ZIP

O ZIP foi criado com os arquivos do projeto diretamente na raiz. Extraia sobre a pasta atual do BobCRM:

```bash
unzip -o BobCRM_FINAL_Fases_0_a_13.zip -d /var/www/crm-casa-ads
cd /var/www/crm-casa-ads
```

Se o seu BobCRM estiver em outro caminho, ajuste também o `cwd` do `ecosystem.config.cjs`.

## 4. Instalar dependências e compilar

```bash
npm ci
npm run build
```

## 5. Subir API e worker separados

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 status
```

Esperado:

```text
crm-casa-ads-api       online
crm-casa-ads-worker    online
```

A configuração padrão reserva 8 conexões MySQL para a API e 2 para o worker.

## 6. Health checks

```bash
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3001/health/ready
```

O `/health/ready` deve retornar HTTP 200 quando banco e processo estiverem prontos.

## 7. Backfill da inteligência comercial

Primeiro verifique:

```bash
npm run commercial-profile:verify
```

Se houver `pending > 0`:

```bash
npm run commercial-profile:backfill -- --batch-size=500 --pause-ms=25
npm run commercial-profile:verify
```

Objetivo: `pending: 0`.

## 8. Índice de busca

```bash
npm run search-index:verify
```

Se houver pendências:

```bash
npm run search-index:backfill -- --batch-size=250 --pause-ms=25
npm run search-index:verify
```

Objetivo: `pending: 0`.

## 9. DATETIME(3)

```bash
npm run datetime:verify
```

Se houver pendências:

```bash
npm run datetime:backfill -- --batch-size=500 --pause-ms=25
npm run datetime:verify
```

Objetivo:

```text
leads.pendingRows: 0
tasks.pendingRows: 0
```

Não remova as colunas VARCHAR antigas nesta implantação.

## 10. Conferir logs

```bash
pm2 logs crm-casa-ads-api --lines 100
pm2 logs crm-casa-ads-worker --lines 100
```

Verifique ausência de erros de migration, MySQL, jobs e worker.

## 11. Diagnósticos opcionais após estabilizar

Plano SQL:

```bash
npm run mysql:explain:plan
```

Auditoria MySQL somente leitura:

```bash
npm run mysql:hardening -- --sample-seconds=15 --max-digests=30
```

Não aplique automaticamente o arquivo candidato de hardening. Revise os números reais antes de alterar `my.cnf`.

## 12. Teste de carga

Faça em staging ou ambiente descartável, não diretamente na produção com writes habilitados:

```bash
npm run test:load:smoke
```

Perfis maiores estão disponíveis em `scripts/load-test.mjs`.

## Rollback operacional

Se houver problema crítico logo após o deploy:

1. pare/recarregue os processos PM2;
2. restaure a pasta da aplicação a partir do backup;
3. caso uma migration precise ser revertida, use o rollback versionado correspondente somente após validar o estado do banco;
4. restaure o dump MySQL se houver necessidade real de rollback de dados.

As migrations das Fases 2 e 8 foram desenhadas com compatibilidade paralela. Não apague colunas antigas durante este deploy.
