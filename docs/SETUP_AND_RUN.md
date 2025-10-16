# Setup e Execução — WABR API

Este documento descreve como configurar e executar a aplicação localmente e em produção.

Pré-requisitos
- Node.js >= 18
- npm
- PostgreSQL (opcional para rodar sem DB, porém recomendado para testar features)

Instalação
1. Instalar dependências:

```powershell
cd 'c:/Users/bruno/Inoovexa/Workspace/wabr'
npm install
```

Variáveis de ambiente
Crie um arquivo `.env` (ou `.env.local`) com as seguintes variáveis mínimas:

```
PORT=8080
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=postgres
DB_SYNC=true
DEV_CLIENT_TOKEN=dev-token-please-change
DEV_CLIENT_NAME=local-dev-client
```

Nota: `DB_SYNC=true` permitirá que TypeORM crie as tabelas automaticamente — usar somente em desenvolvimento.

Rodando em desenvolvimento (hot-reload)

```powershell
npm run start:dev
```

Build e execução (produção)

```powershell
npm run build
node dist/main.js
```

Testes rápidos
- Acesse `GET /` — deve retornar `Hello World!`
- Acesse `GET /health` — deve retornar `{ status: 'ok' }`
- Acesse `GET /me` sem header Authorization — deve retornar 401
- Acesse `GET /me` com header `Authorization: Bearer dev-token-please-change` — deve retornar dados do client seed

Swagger
- Após iniciar, a documentação Swagger estará em `http://localhost:<PORT>/docs`

Logs
- Logs básicos são exibidos no console. Para produção, configure um logger centralizado.

Fim.
