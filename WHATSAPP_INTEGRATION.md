# Modulo WhatsApp integrado ao CRM

Este modulo usa obrigatoriamente `whatsapp-web.js` e roda no backend do CRM. A tela React apenas consulta o estado e envia comandos; recebimento de mensagens, reconexao e criacao automatica de leads continuam ativos enquanto o processo HTTP do backend estiver rodando, mesmo que nenhum consultor esteja com a aba aberta.

## O que foi implementado

- Aba `WhatsApp` disponivel somente para `consultor_vendas` (e alias legado `vendedor`).
- Uma sessao `LocalAuth` separada por usuario do CRM, com `clientId` deterministico e hash para evitar colisao entre consultores.
- QR Code, restauracao de sessao no boot, reconexao e desvinculacao/logout.
- Lista de conversas e historico recente da conversa selecionada.
- Envio e recebimento de texto.
- Envio e recebimento de imagens.
- Gravacao pelo microfone do navegador e envio como mensagem de voz.
- Reproducao dos audios recebidos no proprio CRM.
- Criacao automatica de lead apenas para nova mensagem individual recebida de telefone ainda inexistente.
- Origem do novo lead: `WhatsApp`.
- Responsavel do novo lead: o consultor cuja sessao recebeu a mensagem.
- Dedupe global por telefone usando as mesmas variantes de telefone ja usadas pelo CRM.
- Idempotencia por `message_id`, para que a mesma mensagem nao crie dois leads.
- Contatos individuais recebidos como `@lid` sao convertidos para o telefone real com `getContactLidAndPhone`; se a conversao falhar, o LID nunca e usado como telefone de lead.
- Lead existente nunca e reatribuido pelo modulo.
- Grupo, status/broadcast, newsletter e mensagens enviadas pelo proprio consultor nao criam leads.
- Carregar historico na interface usa `fetchMessages` e nao executa a automacao de lead.

## Arquivos principais

- `server/whatsappRuntime.js`: ciclo de vida das sessoes, eventos do whatsapp-web.js, chats, mensagens e midia.
- `server/whatsapp-runtime/package.json`: dependencias exclusivas do runtime WhatsApp.
- `server/migrations/20260910_27_whatsapp_webjs_crm.js`: tabelas de sessoes e idempotencia.
- `server/index.js`: API autenticada e automacao de leads.
- `server/rolePolicy.js`: permissao `use_whatsapp` para consultor.
- `src/components/WhatsappWorkspace.tsx`: interface completa.
- `src/utils/api.ts`: cliente das novas rotas.
- `src/App.tsx`: nova aba e lazy loading.
- `src/styles.css`: layout da interface WhatsApp.
- `server/security.js`: permissao de microfone e politica de midia.

## Instalacao

O lockfile principal continua sendo usado para o CRM:

```bash
npm ci
```

Depois instale o runtime backend-only do WhatsApp:

```bash
npm run install:whatsapp-runtime
```

Esse comando instala `whatsapp-web.js` 1.34.7, `qrcode` 1.5.4 e as dependencias do Puppeteer dentro de `server/whatsapp-runtime/node_modules`.

Copie/preencha o ambiente se ainda nao existir:

```bash
cp server/.env.example server/.env
```

Depois:

```bash
npm run build
npm start
```

No PM2 do projeto, a API ja esta configurada com `instances: 1`, que e o modo recomendado para este runtime baseado em sessao local.

## Variaveis de ambiente

```dotenv
WHATSAPP_RUNTIME_ENABLED=1
WHATSAPP_SESSION_DIR=server/data/whatsapp-sessions
WHATSAPP_HEADLESS=1
WHATSAPP_CHROME_EXECUTABLE=
WHATSAPP_CHROME_NO_SANDBOX=0
WHATSAPP_RECONNECT_DELAY_MS=10000
```

### WHATSAPP_SESSION_DIR

Use um diretorio persistente e gravavel pelo usuario do processo. Em servidor Linux, uma opcao e:

```bash
sudo mkdir -p /var/lib/bobcrm/whatsapp-sessions
sudo chown -R SEU_USUARIO:SEU_GRUPO /var/lib/bobcrm/whatsapp-sessions
sudo chmod 700 /var/lib/bobcrm/whatsapp-sessions
```

E no `.env`:

```dotenv
WHATSAPP_SESSION_DIR=/var/lib/bobcrm/whatsapp-sessions
```

Esse diretorio contem credenciais/sessoes autenticadas do WhatsApp. Nao publique, nao envie no release e nao coloque no Git.

### Chrome / Chromium

Por padrao, o Puppeteer pode usar o navegador gerenciado por sua instalacao. Se o servidor usa Chrome/Chromium do sistema, configure por exemplo:

```dotenv
WHATSAPP_CHROME_EXECUTABLE=/usr/bin/google-chrome
```

ou o caminho real do Chromium da maquina.

Mantenha:

```dotenv
WHATSAPP_CHROME_NO_SANDBOX=0
```

Sempre que o ambiente permitir. Somente em container/host onde o Chromium realmente nao consiga iniciar com sandbox, altere para `1`. O processo do CRM deve preferencialmente rodar como usuario de servico sem privilegios de root.

## Banco de dados

A migration roda automaticamente no startup que gerencia schema e cria:

- `whatsapp_accounts`: estado administrativo da conexao por consultor. A autenticacao real fica no diretorio LocalAuth, nao no banco.
- `whatsapp_inbound_events`: recibo idempotente das mensagens candidatas a criacao de lead.

Nenhum historico de conversa completo e copiado para o MySQL. O CRM busca as mensagens diretamente da sessao WhatsApp conectada.

## Regras de criacao automatica de lead

A automacao somente roda no evento de mensagem nova recebido pelo processo `whatsapp-web.js`.

Uma mensagem e candidata quando:

1. Foi recebida, nao enviada pelo consultor.
2. Nao e status/broadcast/newsletter.
3. Nao pertence a grupo.
4. Tem identificador individual (`@c.us` ou `@lid`) e telefone resolvido.
5. O usuario associado a sessao continua ativo e com papel de consultor de vendas.

Antes de criar, o backend:

1. Registra/processa o `message_id` dentro de transacao.
2. Gera variantes do telefone com as regras existentes do CRM.
3. Procura o telefone globalmente, inclusive fora da carteira do consultor.
4. Se encontrar qualquer lead, encerra como `existing` e nao altera responsavel.
5. Se nao encontrar, usa a protecao global contra duplicatas do proprio CRM e cria o lead atribuido ao consultor conectado.
6. Registra auditoria `lead_created_from_whatsapp` somente quando houve criacao real.

Isso evita que dois consultores recebendo eventos concorrentes criem duplicatas ou roubem a responsabilidade de um lead ja existente.

## Permissoes e isolamento

A nova permissao `use_whatsapp` e concedida ao papel `consultor_vendas`.

Todas as rotas `/api/whatsapp/*`:

- exigem a sessao autenticada normal do CRM;
- passam pela protecao CSRF existente nas operacoes mutaveis;
- exigem `use_whatsapp`;
- usam sempre `currentUser.id` no servidor;
- nao aceitam `userId` arbitrario vindo do frontend.

Por isso um consultor nao consegue abrir, desconectar ou enviar mensagens usando a sessao de outro consultor pelas rotas normais do modulo.

## Microfone e HTTPS

O navegador exige contexto seguro para `getUserMedia` fora de `localhost`. Em producao, publique o CRM por HTTPS. O header `Permissions-Policy` foi ajustado para permitir microfone somente na propria origem (`microphone=(self)`).

## Limites de midia

- Imagem enviada pela interface: ate 10 MB.
- Audio gravado pela interface: ate 10 MB.
- Midia carregada para visualizacao: limite backend de aproximadamente 16 MB em base64.
- O backend valida que imagem use MIME `image/*` e audio use `audio/*`.

## Reinicio e reconexao

No boot da API, o runtime consulta `whatsapp_accounts` e restaura todas as sessoes habilitadas de consultores ativos. Em `disconnected` ou falha de inicializacao, uma nova tentativa e agendada conforme `WHATSAPP_RECONNECT_DELAY_MS`.

O botao `Reconectar` preserva a sessao. O botao `Desvincular sessao` executa logout e desabilita a restauracao automatica; para usar novamente sera necessario novo pareamento quando o WhatsApp solicitar.

## Multiplicas instancias

O `ecosystem.config.cjs` atual usa uma unica instancia da API e uma instancia separada do worker. O runtime WhatsApp somente inicia no processo que serve HTTP; o worker nao abre Chromium.

Se no futuro a API for horizontalmente escalada, nao monte o mesmo `WHATSAPP_SESSION_DIR` em dois processos que tentem controlar a mesma sessao ao mesmo tempo. Antes de escalar, mova o runtime para um processo dedicado ou implemente ownership/lease distribuido e roteie as chamadas para ele.

## Testes adicionados

Foram adicionados testes para:

- filtro de mensagens aptas a gerar lead;
- exclusao de grupos/status/broadcast/newsletter;
- normalizacao de telefone;
- isolamento de `clientId`;
- classificacao de midia;
- migration;
- permissao do consultor;
- wiring do backend, frontend e seguranca.

Para executar os testes unitarios especificos:

```bash
node --test server/whatsappRuntime.test.js server/whatsappWebjsWiring.test.js server/migrations/20260910_27_whatsapp_webjs_crm.test.js server/rolePolicy.test.js server/security.test.js
```

Depois de instalar todas as dependencias, rode a linha completa do projeto:

```bash
npm test
npm run build
```

## Checklist funcional para homologacao

1. Entrar como consultor A, abrir WhatsApp e ler o QR.
2. Entrar como consultor B em outro navegador e conectar outro numero.
3. Reiniciar a API e confirmar restauracao das duas sessoes sem novo QR.
4. Enviar/receber texto, imagem e audio nos dois usuarios.
5. Fechar os navegadores do CRM, enviar mensagem nova aos numeros e confirmar que o backend continua recebendo.
6. Usar um telefone inexistente: deve criar um unico lead `WhatsApp` atribuido ao consultor receptor.
7. Mandar nova mensagem do mesmo telefone: nao deve duplicar.
8. Testar telefone de lead pertencente a outro consultor: nao deve duplicar nem reatribuir.
9. Testar grupo, status e apenas abertura/carregamento de historico: nao deve criar lead.
10. Desvincular uma sessao e confirmar que ela nao e restaurada no restart.

## Observacao operacional

`whatsapp-web.js` automatiza o WhatsApp Web por Puppeteer e nao e a API oficial da Meta. A operacao deve considerar os termos do WhatsApp e o risco inerente a clientes nao oficiais.
