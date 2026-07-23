# MySQL no CRM Casa do Ads

O backend operacional usa MySQL via `mysql2`. O SQLite incluído no histórico do projeto é somente uma origem legada para migração manual e não deve ser usado como banco ativo.

A instalação, as migrations, o backup criptografado, a restauração e as regras de segurança estão documentados no `README.md` e em `server/.env.example`.

Nunca execute migrations ou restaurações diretamente no banco original. Use uma cópia verificável de homologação e valide o resultado antes de produção.


## Confiabilidade operacional

O pool usa keepalive, timeout de conexão e retry com backoff para falhas transitórias. Deadlocks e lock wait timeout refazem a transação completa. Jobs pesados são persistidos em `async_jobs`, e `/health/ready` só libera tráfego quando MySQL e worker estão disponíveis. Consulte o `README.md` para configuração e encerramento gracioso.
