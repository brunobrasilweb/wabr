# WhatsApp Messages API - Guia de Implementação Completo

## 📋 Índice

1. [Resumo Executivo](#resumo-executivo)
2. [Arquitetura](#arquitetura)
3. [Endpoints Implementados](#endpoints-implementados)
4. [Instalação e Configuração](#instalação-e-configuração)
5. [Uso dos Endpoints](#uso-dos-endpoints)
6. [Modelos de Dados](#modelos-de-dados)
7. [Tratamento de Erros](#tratamento-de-erros)
8. [Monitoramento e Logs](#monitoramento-e-logs)
9. [Próximos Passos](#próximos-passos)

---

## Resumo Executivo

A funcionalidade **WhatsApp Messages API** implementa um sistema completo de gerenciamento de mensagens para integração com WhatsApp via biblioteca **Baileys**. O sistema suporta:

✅ **5 Endpoints REST** para operações completas  
✅ **8 Tipos de Conteúdo** (texto, imagem, vídeo, áudio, documento, localização, contato, sticker)  
✅ **Fila Assíncrona** com BullMQ + Redis  
✅ **Rastreabilidade Completa** com Correlation IDs  
✅ **Autenticação** via Bearer Token  
✅ **Validações Robustas** de entrada  
✅ **Tratamento de Erros** seguindo padrões HTTP  

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                  REST API (Express)                     │
├─────────────────────────────────────────────────────────┤
│  MessagesController (5 endpoints)                       │
├─────────────────────────────────────────────────────────┤
│  MessagesService (lógica de negócio)                    │
├─────────────────────────────────────────────────────────┤
│  BullMQ Queue (messages)  │  PostgreSQL (histórico)     │
├─────────────────────────────────────────────────────────┤
│  MessagesProcessor (background jobs)                    │
├─────────────────────────────────────────────────────────┤
│  BaileysManager (integração WhatsApp Web)               │
├─────────────────────────────────────────────────────────┤
│  Redis (fila de jobs)                                   │
└─────────────────────────────────────────────────────────┘
```

### Fluxo de Envio de Mensagem

```
1. Cliente → POST /api/messages/send
   ↓
2. MessagesController valida entrada + extrai Bearer Token
   ↓
3. MessagesService.sendMessage():
   - Cria entidade Message com status PENDING
   - Salva no PostgreSQL
   - Enfileira job em BullMQ
   - Retorna messageId + timestamp (202 Accepted)
   ↓
4. MessagesProcessor.processSendMessage() (async):
   - Atualiza status para SENT
   - Envia via BaileysManager
   - Atualiza com whatsappMessageId
   - Status fica DELIVERED quando confirmado
   ↓
5. Cliente consulta GET /api/messages/{id}
   - Retorna status atual atualizado
```

### Fluxo de Recebimento

```
1. WhatsApp Webhook → POST /api/messages/receive
   ↓
2. MessagesController (sem auth)
   ↓
3. MessagesService.receiveMessage():
   - Valida messageId único (evita duplicatas)
   - Cria Message com status DELIVERED
   - Enfileira job para processamento
   ↓
4. MessagesProcessor.processReceiveMessage():
   - Aplica lógica customizada
   - Dispara eventos/webhooks
   - Atualiza integrações externas
```

---

## Endpoints Implementados

### 1️⃣ **POST /api/messages/send** - Enviar Mensagem

**Status:** `202 Accepted`

```bash
curl -X POST http://localhost:8080/api/messages/send \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "text",
    "text": "Olá!"
  }'
```

**Resposta:**
```json
{
  "messageId": "uuid-aqui",
  "status": "pending",
  "timestamp": "2025-11-05T18:00:00Z"
}
```

---

### 2️⃣ **POST /api/messages/receive** - Receber Mensagem (Webhook)

**Status:** `200 OK`

```bash
curl -X POST http://localhost:8080/api/messages/receive \
  -H "Content-Type: application/json" \
  -d '{
    "from": "5511988888888",
    "messageId": "wa_msgid_123",
    "type": "text",
    "text": "Oi!",
    "timestamp": "2025-11-05T17:59:00Z"
  }'
```

**Resposta:**
```json
{
  "status": "received",
  "processed": true
}
```

---

### 3️⃣ **GET /api/messages/{id}** - Consultar Mensagem

**Status:** `200 OK`

```bash
curl -X GET http://localhost:8080/api/messages/uuid-aqui \
  -H "Authorization: Bearer seu_token"
```

**Resposta:**
```json
{
  "id": "uuid-aqui",
  "messageId": "msg-uuid",
  "from": "5511999999999",
  "to": "5511988888888",
  "type": "text",
  "content": { "text": "Olá!" },
  "status": "delivered",
  "createdAt": "2025-11-05T18:00:00Z",
  "deliveredAt": "2025-11-05T18:00:10Z"
}
```

---

### 4️⃣ **DELETE /api/messages/{id}** - Deletar Mensagem

**Status:** `200 OK`

```bash
curl -X DELETE http://localhost:8080/api/messages/uuid-aqui \
  -H "Authorization: Bearer seu_token"
```

**Resposta:**
```json
{
  "messageId": "msg-uuid",
  "status": "deleted"
}
```

---

### 5️⃣ **POST /api/messages/forward** - Encaminhar Mensagem

**Status:** `200 OK`

```bash
curl -X POST http://localhost:8080/api/messages/forward \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "uuid-aqui",
    "recipients": ["5511977777777", "5511966666666"]
  }'
```

**Resposta:**
```json
{
  "forwardedTo": ["5511977777777", "5511966666666"],
  "status": "success"
}
```

---

## Instalação e Configuração

### Pré-requisitos

```bash
✓ Node.js 18+
✓ PostgreSQL 12+
✓ Redis 6+
✓ npm ou yarn
```

### 1. Dependências Instaladas

```bash
npm install --legacy-peer-deps class-validator class-transformer @types/uuid
```

### 2. Variáveis de Ambiente

Crie `.env` ou `.env.local`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=seu_password
DB_NAME=wabr
DB_SYNC=true          # Em desenvolvimento
DB_LOGGING=true       # Logs de SQL

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=      # Se tiver senha
REDIS_DB=0

# WhatsApp
BAILEYS_SESSION_DIR=./sessions

# API
PORT=8080
NODE_ENV=development
```

### 3. Iniciar a Aplicação

```bash
# Desenvolvimento (hot reload)
npm run start:dev

# Produção
npm run build && npm start
```

### 4. Testar Endpoints

**Opção 1: Usar Postman Collection**
```
Importar: tests/WhatsApp_Messages_API.postman_collection.json
```

**Opção 2: Usar Script Bash**
```bash
bash tests/messages-api.test.sh
```

**Opção 3: Usar cURL direto**
```bash
TOKEN="test-token-123"
curl -X POST http://localhost:8080/api/messages/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"5511999999999","type":"text","text":"Teste!"}'
```

---

## Modelos de Dados

### Entidade `Message`

```typescript
{
  id: UUID                      // PK
  messageId: string             // Unique - ID único da mensagem
  from: string                  // Telefone do remetente
  to: string                    // Telefone do destinatário
  type: MessageType             // text, image, video, etc
  content: {
    text?: string
    mediaUrl?: string
    caption?: string
    latitude?: number
    longitude?: number
    name?: string
    phone?: string
  }
  status: MessageStatus         // pending, sent, delivered, read, failed
  whatsappMessageId?: string    // ID retornado pelo WhatsApp
  correlationId?: string        // Para rastreamento
  errorMessage?: string         // Se falhou
  createdAt: Date              // Timestamp de criação
  updatedAt: Date              // Última atualização
  sentAt?: Date                // Quando foi enviado
  deliveredAt?: Date           // Quando foi entregue
  readAt?: Date                // Quando foi lido
  connectionId?: UUID          // Referência à conexão WhatsApp
}
```

### Enum `MessageType`

```typescript
'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact'
```

### Enum `MessageStatus`

```typescript
'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'deleted'
```

---

## Tratamento de Erros

### Códigos HTTP

| Código | Cenário |
|--------|---------|
| `202` | Mensagem aceita e enfileirada |
| `200` | Sucesso em GET/DELETE/POST |
| `400` | Validação falhou (número inválido, tipo errado) |
| `401` | Token ausente ou inválido |
| `403` | Sem permissão (ex: deletar msg recebida) |
| `404` | Mensagem/recurso não encontrado |
| `422` | Erro de mídia (arquivo inacessível) |
| `429` | Rate limit atingido |
| `500` | Erro interno do servidor |

### Exemplo de Erro

```json
{
  "statusCode": 400,
  "message": "Invalid recipient phone number format",
  "error": "Bad Request"
}
```

### Validações Implementadas

```typescript
✓ Número de telefone: /^\d{10,}$/ (mínimo 10 dígitos)
✓ Tipo de mensagem: Enum validado
✓ URL de mídia: URL válida (se presente)
✓ Destinatários: Todos os números validados
✓ Coordenadas: Números válidos (latitude/longitude)
✓ Contato: Nome e telefone obrigatórios
```

---

## Monitoramento e Logs

### Estrutura de Logs

```
[CORRELATION_ID] OPERAÇÃO | STATUS | DETALHES

Exemplo:
[550e8400-e29b...] POST /api/messages/send | pending | From: test-token-123
[550e8400-e29b...] Message saved to database | ID: 550e8400-e29b-41d4-a716...
[550e8400-e29b...] Message queued for sending | BullMQ job created
[550e8400-e29b...] Processing send job | status: SENT
[550e8400-e29b...] Message sent successfully | whatsappMessageId: wamsgid_XXX
```

### Níveis de Log

- **DEBUG:** Detalhes internos, rastreamento de operações
- **INFO:** Operações bem-sucedidas, marcos importantes
- **WARN:** Situações anormais que não causam falha
- **ERROR:** Erros que impediram a operação

### Monitoramento Recomendado

```sql
-- Mensagens por status (última hora)
SELECT status, COUNT(*) as total
FROM messages
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;

-- Taxa de falha
SELECT 
  CAST(COUNT(CASE WHEN status = 'failed' THEN 1 END) * 100.0 / 
       COUNT(*) AS NUMERIC(5,2)) as failure_rate
FROM messages
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Tempo médio de entrega
SELECT AVG(EXTRACT(EPOCH FROM (delivered_at - sent_at))) as avg_delivery_seconds
FROM messages
WHERE delivered_at IS NOT NULL AND sent_at IS NOT NULL;

-- Jobs processados pela fila
SELECT status, COUNT(*) as total
FROM bull_jobs
WHERE name = 'send' OR name = 'receive'
GROUP BY status;
```

### Alerts Recomendados

- ⚠️ Taxa de erro > 5% em 5 minutos
- ⚠️ Fila de mensagens > 1000 jobs pendentes
- ⚠️ Tempo de entrega > 30 segundos
- ⚠️ Desconexão de WhatsApp por > 5 minutos
- ⚠️ Redis indisponível

---

## Próximos Passos

### Fase 2: Melhorias de Integração

- [ ] **Webhook para Notificações**
  - Implementar callbacks quando mensagem é entregue/lida
  - POST para URLs configuradas do cliente
  
- [ ] **Eventos em Tempo Real**
  - WebSocket para status de entrega em vivo
  - Server-Sent Events (SSE) como alternativa

- [ ] **Retry Inteligente**
  - Detectar tipos de erro (rede vs autenticação)
  - Backoff adaptativo baseado em histórico

- [ ] **Rate Limiting**
  - Limitar por cliente/hora/dia
  - Respect WhatsApp rate limits

### Fase 3: Features Avançadas

- [ ] **Agendamento de Mensagens**
  - POST /messages/schedule
  - Processamento por timestamp

- [ ] **Templates de Mensagem**
  - Reutilizar estruturas comuns
  - Variáveis dinâmicas

- [ ] **Analytics e Dashboards**
  - Gráficos de volume
  - Taxa de sucesso por cliente
  - Custos estimados

- [ ] **Integrações**
  - CRM (Salesforce, HubSpot)
  - Automações (Zapier, Make)
  - Webhooks customizados

### Fase 4: Segurança e Performance

- [ ] **Criptografia de Dados**
  - Sensitive data em repouso
  - TLS para transit

- [ ] **Audit Trail Completo**
  - Todos os acessos registrados
  - Conformidade LGPD

- [ ] **Multi-tenant Support**
  - Isolamento por cliente
  - Quotas por organização

- [ ] **Otimizações**
  - Cache de mensagens frequentes
  - Compressão de mídia
  - CDN para assets

---

## Estrutura de Arquivos

```
src/messages/
├── message.entity.ts          # Entidade TypeORM
├── messages.dto.ts            # DTOs de validação
├── messages.service.ts        # Lógica de negócio
├── messages.controller.ts     # Endpoints REST
├── messages.processor.ts      # Processador de filas
├── messages.module.ts         # Módulo NestJS

tests/
├── messages-api.test.sh       # Script de testes bash
└── WhatsApp_Messages_API.postman_collection.json

docs/
├── MESSAGES_API.md            # Documentação detalhada
└── MESSAGES_IMPLEMENTATION.md # Este arquivo
```

---

## Exemplos de Uso Completo

### Cenário 1: Enviar Mensagem e Consultar Status

```bash
#!/bin/bash
TOKEN="seu_token"
BASE="http://localhost:8080/api"

# 1. Enviar
SEND=$(curl -s -X POST "$BASE/messages/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "text",
    "text": "Olá!"
  }')

MSG_ID=$(echo $SEND | jq -r '.messageId')
echo "Enviada com ID: $MSG_ID"

# 2. Aguardar processamento
sleep 3

# 3. Consultar status
curl -s -X GET "$BASE/messages/$MSG_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.status'
```

### Cenário 2: Broadcast para Múltiplos Destinatários

```bash
# 1. Enviar para primeiro destinatário
MSG=$(curl -s -X POST "$BASE/messages/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "text",
    "text": "Informativo importante!"
  }')

MSG_ID=$(echo $MSG | jq -r '.messageId')

# 2. Encaminhar para todos
curl -s -X POST "$BASE/messages/forward" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"messageId\": \"$MSG_ID\",
    \"recipients\": [
      \"5511977777777\",
      \"5511966666666\",
      \"5511955555555\"
    ]
  }" | jq '.status'
```

---

## Troubleshooting

### Erro: "listen EADDRINUSE"
```bash
# Porta 8080 em uso
lsof -i :8080
kill -9 <PID>
```

### Erro: "Connection refused" (Redis)
```bash
# Redis não está rodando
redis-server
# ou
docker run -d -p 6379:6379 redis:latest
```

### Erro: "PostgreSQL connection failed"
```bash
# Verificar conexão
psql -h localhost -U postgres -d wabr -c "SELECT 1"
```

### Mensagens não saem
```bash
# Verificar logs
tail -f logs/app.log | grep -i "messages\|error"

# Verificar fila
redis-cli
> KEYS bull:messages:*
> LLEN bull:messages:waiting
```

---

## Suporte e Contribuição

Para suporte, erros ou sugestões:
- Abra uma issue no repositório
- Use o correlation ID para rastrear problemas
- Envie logs relevantes

---

**Última atualização:** 2025-11-05  
**Versão:** 1.0.0 - Inicial  
**Status:** ✅ Implementação Completa
