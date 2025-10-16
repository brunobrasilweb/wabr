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

Conectando ao Postgres

1. Crie um arquivo `.env` baseado em `.env.example` e ajuste as variáveis de conexão:

```powershell
cp .env.example .env
# abra e ajuste DB_HOST, DB_USER, DB_PASS, DB_NAME se necessário
```

2. Instale dependências e rode a aplicação (uma vez):

```powershell
npm install
npm run build
node dist/main.js
```

Observações:
- A opção `DB_SYNC=true` fará o TypeORM sincronizar automaticamente o schema (apenas para desenvolvimento).
- Para produção, mantenha `DB_SYNC=false` e use migrations.

Se quiser executar em outra porta, defina a variável de ambiente `PORT` antes de iniciar:

```powershell
$env:PORT = '4000'; npm run build; node dist/main.js
```

Swagger UI

Depois de iniciar a aplicação, a documentação Swagger estará disponível em:

```powershell
# por padrão
http://localhost:8080/docs

# se alterou a porta
http://localhost:<PORT>/docs
```
