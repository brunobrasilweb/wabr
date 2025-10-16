# Arquitetura — WABR API

Este documento descreve a arquitetura lógica e componentes da aplicação.

Visão Geral
A aplicação segue a arquitetura modular do NestJS com camadas simples:
- Controladores (Controllers) — endpoints HTTP.
- Serviços (Services) — lógica de negócio e acesso a dados via TypeORM.
- Entidades (Entities) — modelagem do banco relacional (Postgres).
- Guards — autenticação/autorizações em rotas.

Diagrama lógico (ASCII)

  [Client (HTTP)]
         |
         v
  [NestJS Controller] --> [TokenAuthGuard] --> [ClientsService] --> [Postgres (clients)]
         |
         v
      Swagger UI

Componentes
- `main.ts` — configura Swagger e inicia o servidor
- `AppController` — rota `/`, `/health`, `/me` (essa última protegida)
- `TokenAuthGuard` — autenticação por token consultando `ClientsService`
- `ClientsService` — abstração sobre `Client` entity via TypeORM Repository
- `ClientsSeeder` — cria client de desenvolvimento

Configurações
- `.env` ou `.env.local` definem as variáveis de conexão (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `DB_SYNC`, `DEV_CLIENT_TOKEN`)
- `TypeOrmModule.forRootAsync` carrega configurações via `ConfigService` para flexibilidade

Escalabilidade
- A autenticação atual faz lookup no banco por token — para escala alta considere:
  - Um cache (Redis) com mapeamento token -> client
  - Token assinado (JWT) reduz consultas diretas ao banco

Segurança
- Evitar exposição de tokens em logs
- Usar HTTPS em produção
- Rotacionar tokens e implementar expiração

Fim.
