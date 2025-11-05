# GitHub Copilot / AI Agent Instructions for wabr

This file gives compact, actionable guidance for an AI code assistant working in this repository. Keep it short — focus on patterns, commands, and code locations that let an agent be productive immediately.

## Big picture
- Tech stack: NestJS (v10), TypeScript, TypeORM, PostgreSQL. App bootstraps in `src/main.ts` and `src/app.module.ts`.
- Purpose: minimal API for Whatsapp-related integrations; modules are small and explicit (e.g. `clients`, `whatsapp`).
- Data flows: ConfigModule -> TypeOrmModule (autoLoadEntities). `ClientsModule` provides `ClientsService` and `TokenAuthGuard` used across modules for simple Bearer-token auth.

## Key locations (start here)
- `src/app.module.ts` — module wiring and TypeORM setup.
- `src/main.ts` — app bootstrap and Swagger config.
- `src/auth/token-auth.guard.ts` — token-based guard; reads `clients.ClientsService` (attach req.user = { client }).
- `src/clients/` — Client entity, service, seeder. Use `ClientsService.findByToken(token)` for auth checks.
- `src/whatsapp/` — Whatsapp feature (entity, service, controller, Baileys manager stub). Replace `BaileysManager` with real Baileys socket implementation when integrating.
- `docs/SETUP_AND_RUN.md` and `docs/TECHNICAL_DOCUMENTATION.md` — authoritative operational/run instructions.

## Conventions and patterns
- DI and layering: Controllers orchestrate, Services contain business logic; use `@InjectRepository(Entity)` for DB operations.
- Auth pattern: `TokenAuthGuard` is applied via `@UseGuards(TokenAuthGuard)` on controllers. The guard expects a `ClientsService` provider exported by `ClientsModule`. If you add providers that use the guard, import `ClientsModule` into that module.
- Entities: use TypeORM Entities under `src/*/*.entity.ts`. `autoLoadEntities: true` is enabled in `app.module.ts`.
- Seeds: `ClientsSeeder` is used for dev seeding — check the seeder implementation when altering clients behavior.

## Developer workflows & useful commands
- Install dependencies:
  - `npm install` (use `--legacy-peer-deps` if you hit peer dependency errors with @nestjs/swagger)
- Development (hot reload):
  - `npm run start:dev`
- Build for production:
  - `npm run build` then `node dist/main.js`
- Lint: `npm run lint`
- Notes: env files are loaded from `.env.local` then `.env`. See `docs/SETUP_AND_RUN.md` for recommended env entries (notably DB_* and DEV_CLIENT_TOKEN).

## Project-specific gotchas
- Peer dependency conflicts: the repo pins Nest v10 packages; `@nestjs/swagger` versions may require a different Nest major — prefer `--legacy-peer-deps` for installs in CI/local if needed.
- When adding modules that rely on `TokenAuthGuard`/`ClientsService`, explicitly import `ClientsModule` to provide `ClientsService` in that module's context (common DI pitfall).
- `DB_SYNC=true` may be set in development to auto-create schema (TypeORM `synchronize`). Don't set it in production.

## WhatsApp integration notes (current state)
- `src/whatsapp/baileys.manager.ts` is a stub that simulates QR generation and connection. It now uses `qrcode` to return a valid `data:image/png;base64,...` value.
- To implement real sessions:
  - Add `@adiwajshing/baileys` (or chosen Baileys fork) and replace `BaileysManager.createSession()` with code that instantiates the socket, listens for `connection.update` events and persists auth state into `WhatsappConnection.sessionData` (JSONB) or S3.
  - Reconnection: implement a background worker that retries up to 3 times before setting sessionStatus to `disconnected`.

## Examples (copyable patterns)
- Guard usage in a controller:

  ```ts
  @Controller('api/whatsapp')
  @UseGuards(TokenAuthGuard)
  export class WhatsappController { ... }
  ```

- TypeORM repository injection in a service:

  ```ts
  constructor(@InjectRepository(WhatsappConnection) private repo: Repository<WhatsappConnection>) {}
  ```

## What to update in this file
- When you change architecture (e.g. move to Prisma, migrate auth to JWT), update this file and `docs/TECHNICAL_DOCUMENTATION.md` briefly describing the reason.

---
If any section is unclear or you want more detail (for example: CI commands, DB migration strategy, or a code snippet for replacing the Baileys stub), tell me which part and I'll expand it.