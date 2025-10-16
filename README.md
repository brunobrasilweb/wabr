# wabr-nest-hello

Projeto NestJS mínimo que expõe um endpoint REST `GET /` que retorna "Hello World!".

Requisitos
- Node.js (>= 18 recomendado)
- npm

Rodando localmente (PowerShell)

1. Instalar dependências:

```powershell
cd 'c:/Users/bruno/Inoovexa/Workspace/wabr'
npm install
```

2. Rodar em modo desenvolvimento (hot-reload):

```powershell
npm run start:dev
```

3. Ou build + node:

```powershell
npm run build
node dist/main.js
```

4. Testar endpoint:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/ -UseBasicParsing
# Deve retornar: Hello World!
```

Se quiser executar em outra porta, defina a variável de ambiente `PORT` antes de iniciar:

```powershell
$env:PORT = '4000'; npm run build; node dist/main.js
```
