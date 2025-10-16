# API — WABR

Documentação dos endpoints disponíveis na aplicação.

Base URL: http://localhost:8080 (configurável via `PORT`)

Endpoints

1) GET /
- Descrição: endpoint público de exemplo
- Resposta: 200
- Body: string — `Hello World!`

2) GET /health
- Descrição: health-check
- Resposta: 200
- Body: { status: 'ok' }

3) GET /me
- Descrição: rota protegida que retorna dados do client autenticado
- Autenticação: header `Authorization: Bearer <token>` (TokenAuthGuard)
- Resposta: 200 — { id, name, status } do client
- Erros:
  - 401 Missing Authorization header
  - 401 Invalid Authorization format
  - 401 Invalid token
  - 401 Client inactive

Exemplos (PowerShell)

Request sem auth:
```powershell
Invoke-RestMethod -Uri http://localhost:8080/me -UseBasicParsing
```

Request com token seed:
```powershell
$headers = @{ Authorization = 'Bearer dev-token-please-change' }
Invoke-RestMethod -Uri http://localhost:8080/me -Headers $headers -UseBasicParsing
```

Modelos
Client
- id: number
- name: string
- token: string
- status: 'active' | 'inactive' | 'revoked'
- metadata?: object
- createdAt: string (ISO)
- updatedAt: string (ISO)

Fim.
