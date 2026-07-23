# Instalação limpa no Windows

## 1. Extraia o projeto em uma pasta nova

Não copie `node_modules`, `dist`, bancos SQLite, backups antigos ou arquivos `- Copy` da pasta anterior.

## 2. Copie somente a configuração local

No PowerShell, dentro da pasta nova:

```powershell
Copy-Item "C:\CAMINHO\DA\PASTA-ANTIGA\server\.env" ".\server\.env"
npm run env:normalize
```

O normalizador preserva credenciais, tokens e chaves. Ele altera apenas limites operacionais antigos que estavam configurados com valores excessivos.

## 3. Instale as dependências

```powershell
npm install
```

Para uma instalação exatamente igual ao lockfile, prefira:

```powershell
npm ci
```

## 4. Valide o projeto

```powershell
npm test
npm run build
```

## 5. Inicie o sistema

Terminal 1:

```powershell
npm run dev:api
```

Terminal 2:

```powershell
npm run dev
```

Acesse `http://localhost:5173`.

## 6. Medição correta de performance

`npm run dev` usa o modo de desenvolvimento do React e do Vite. A nota do Lighthouse nesse modo não representa o build final.

Para medir o frontend de produção:

```powershell
npm run build
npm run preview
```

Acesse o endereço exibido pelo preview e execute o Lighthouse nessa URL.

## Limpeza segura da pasta antiga

O comando abaixo remove somente arquivos gerados e cópias redundantes. Ele não toca em `.env`, bancos ou backups:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\clean-workspace.ps1
```

Não apague `server\data`, `server\backup` ou `server\backups` antes de confirmar que os dados estão no MySQL e que os backups necessários foram copiados para outro local.
