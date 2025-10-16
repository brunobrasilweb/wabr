# Documentação Técnica — WABR API

Este documento descreve em detalhes a arquitetura, modelos de dados, fluxos de autenticação e decisões técnicas do projeto "wabr-nest-hello" (WABR API).

Sumário
- Visão Geral
- Objetivos e Público-alvo
- Tecnologias
- Estrutura do Projeto
- Módulos Principais
- Modelos de Dados
- Fluxo de Autenticação
- Seeders e dados de desenvolvimento
- Boas práticas e recomendações

Visão Geral
O projeto é uma API REST minimalista implementada em NestJS. Fornece endpoints públicos (ex.: `/`, `/health`) e endpoints protegidos via autenticação por token (guard `TokenAuthGuard`). Há um módulo `clients` que mantém clientes (Client entity) com tokens que servem como credenciais.

Objetivos
- Servir como base para projetos que precisam de autenticação baseada em token simples.
- Demonstrar integração com TypeORM e Postgres.

Tecnologias
- Node.js (>=18 recomendado)
- NestJS 10
- TypeScript 5
- TypeORM
- PostgreSQL
- Swagger (documentação interativa)

Estrutura do Projeto
- `src/` — Código fonte
  - `main.ts` — bootstrap da aplicação e configuração do Swagger
  - `app.module.ts` — módulos importados (Config, TypeORM, Clients)
  - `app.controller.ts` — endpoints públicos e protegidos de exemplo
  - `auth/token-auth.guard.ts` — guarda para autenticação por token
  - `clients/` — módulo que contém `Client` entity, `ClientsService` e `ClientsSeeder`

Módulos Principais
- AppModule
  - ConfigModule (global) carrega `.env.local` e `.env`
  - TypeOrmModule configurado via `forRootAsync` usando `ConfigService`
  - ClientsModule exporta `ClientsService` e `TokenAuthGuard`

Modelos de Dados
Entidade `Client` (tabela `clients`):
- `id: number` — PK auto-increment
- `name: string` — nome do cliente
- `token: string` — token Bearer único (campo `unique`)
- `status: 'active'|'inactive'|'revoked'` — status do cliente
- `metadata?: json` — campo JSON opcional
- `createdAt`, `updatedAt` — timestamps automáticos

Recomendações de produção
- Não armazenar tokens em texto simples sem proteção adicional.
- Use hash (por exemplo HMAC ou token com assinatura JWT) ou um serviço de gerenciamento de credenciais.
- Garanta índice único no campo `token` no banco de dados (já configurado no entity).

Fluxo de Autenticação
1. O cliente envia uma requisição com header `Authorization: Bearer <token>`.
2. `TokenAuthGuard` extrai o token e chama `ClientsService.findByToken(token)`.
3. Se existir e `status === 'active'` o guard anexa `req.user = { client }` e permite a rota.
4. Caso contrário, lança `UnauthorizedException` com mensagens específicas.

Seeders e dados de desenvolvimento
- `ClientsSeeder` roda na inicialização do módulo e garante que exista um client padrão com token `DEV_CLIENT_TOKEN` ou `dev-token-please-change`.
- Isso facilita testes locais sem precisar inserir manualmente registros.

Boas práticas e próximas melhorias
- Implementar migrations (TypeORM migrations) para gerenciar schema em produção.
- Adicionar testes unitários/integration (Jest) cobrindo o guard, service e controller.
- Adicionar logging estruturado e métricas.
- Considerar implementação de rate-limiting para endpoints sensíveis.

Fim do documento.
