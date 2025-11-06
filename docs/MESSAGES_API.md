# WhatsApp Messages API - Documentação Completa

## Visão Geral

Esta API fornece endpoints REST para gerenciamento completo de mensagens WhatsApp, incluindo envio, recebimento, consulta, exclusão e encaminhamento de mensagens com suporte a múltiplos tipos de mídia.

## Endpoints

### 1. Envio de Mensagens

**Endpoint:** `POST /api/messages/send`  
**Autenticação:** Bearer Token (obrigatório)  
**Status:** 202 Accepted

#### Request

```bash
curl -X POST http://localhost:8080/api/messages/send \
  -H "Authorization: Bearer seu_token_aqui" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "text",
    "text": "Olá, tudo bem?"
  }'
```

#### Exemplos por Tipo de Mensagem

**Texto:**
```json
{
  "recipient": "5511999999999",
  "type": "text",
  "text": "Olá, tudo bem?"
}
```

**Imagem:**
```json
{
  "recipient": "5511999999999",
  "type": "image",
  "mediaUrl": "https://cdn.exemplo.com/imagem.jpg",
  "caption": "Minha foto"
}
```

**Vídeo:**
```json
{
  "recipient": "5511999999999",
  "type": "video",
  "mediaUrl": "https://cdn.exemplo.com/video.mp4",
  "caption": "Video legal"
}
```

**Áudio:**
```json
{
  "recipient": "5511999999999",
  "type": "audio",
  "mediaUrl": "https://cdn.exemplo.com/audio.ogg"
}
```

**Documento:**
```json
{
  "recipient": "5511999999999",
  "type": "document",
  "mediaUrl": "https://cdn.exemplo.com/arquivo.pdf",
  "caption": "Meu documento"
}
```

**Localização:**
```json
{
  "recipient": "5511999999999",
  "type": "location",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "caption": "São Paulo, Brasil"
}
```

**Contato:**
```json
{
  "recipient": "5511999999999",
  "type": "contact",
  "name": "João Silva",
  "phone": "5511988888888"
}
```

**Sticker:**
```json
{
  "recipient": "5511999999999",
  "type": "sticker",
  "mediaUrl": "https://cdn.exemplo.com/sticker.webp"
}
```

#### Response (202 Accepted)

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "timestamp": "2025-11-05T18:00:00Z"
}
```

#### Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 400 | Entrada inválida (número mal formatado, tipo de mídia inválido) |
| 401 | Não autenticado ou token inválido |
| 403 | Não autorizado (#131030 - número não autorizado) |
| 422 | Erro de mídia (arquivo inacessível ou corrompido) |
| 429 | Rate limited |
| 500 | Erro interno do servidor |

---

### 2. Recebimento de Mensagens

**Endpoint:** `POST /api/messages/receive`  
**Autenticação:** Nenhuma (webhook do WhatsApp)  
**Status:** 200 OK

#### Request (Webhook)

```bash
curl -X POST http://localhost:8080/api/messages/receive \
  -H "Content-Type: application/json" \
  -d '{
    "from": "5511988888888",
    "messageId": "XYZ789",
    "type": "text",
    "text": "Oi, quero saber mais!",
    "timestamp": "2025-11-05T17:59:00Z"
  }'
```

#### Response (200 OK)

```json
{
  "status": "received",
  "processed": true
}
```

#### Resposta para Duplicata

```json
{
  "status": "duplicated",
  "processed": false
}
```

#### Notas

- Mensagens duplicadas (mesmo messageId) são descartadas automaticamente
- As mensagens são enfileiradas em Redis/BullMQ para processamento assíncrono
- Implementar retry automático em caso de falha

---

### 3. Consulta de Mensagens

**Endpoint:** `GET /api/messages/{id}`  
**Autenticação:** Bearer Token (obrigatório)  
**Status:** 200 OK

#### Request

```bash
curl -X GET "http://localhost:8080/api/messages/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer seu_token_aqui"
```

#### Response (200 OK)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "from": "5511999999999",
  "to": "5511988888888",
  "type": "text",
  "content": {
    "text": "Olá, tudo bem?"
  },
  "status": "delivered",
  "whatsappMessageId": "wamsgid_1234567890_ABC123DEF",
  "correlationId": "550e8400-e29b-41d4-a716-446655440002",
  "createdAt": "2025-11-05T18:00:00Z",
  "updatedAt": "2025-11-05T18:00:15Z",
  "sentAt": "2025-11-05T18:00:05Z",
  "deliveredAt": "2025-11-05T18:00:10Z",
  "readAt": null
}
```

#### Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 401 | Não autenticado |
| 404 | Mensagem não encontrada |

---

### 4. Exclusão de Mensagens

**Endpoint:** `DELETE /api/messages/{id}`  
**Autenticação:** Bearer Token (obrigatório)  
**Status:** 200 OK

#### Request

```bash
curl -X DELETE "http://localhost:8080/api/messages/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer seu_token_aqui"
```

#### Response (200 OK)

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "deleted"
}
```

#### Response (Parcialmente Deletada)

Quando a mensagem já expirou no WhatsApp (> 4 horas):

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "partially_deleted"
}
```

#### Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 401 | Não autenticado |
| 403 | Apenas mensagens enviadas pelo sistema podem ser deletadas |
| 404 | Mensagem não encontrada |

---

### 5. Encaminhamento de Mensagens

**Endpoint:** `POST /api/messages/forward`  
**Autenticação:** Bearer Token (obrigatório)  
**Status:** 200 OK

#### Request

```bash
curl -X POST http://localhost:8080/api/messages/forward \
  -H "Authorization: Bearer seu_token_aqui" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "550e8400-e29b-41d4-a716-446655440000",
    "recipients": [
      "5511977777777",
      "5511966666666"
    ]
  }'
```

#### Response (200 OK)

```json
{
  "forwardedTo": [
    "5511977777777",
    "5511966666666"
  ],
  "status": "success"
}
```

#### Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 400 | Entrada inválida (número mal formatado) |
| 401 | Não autenticado |
| 404 | Mensagem não encontrada |

---

## Estados das Mensagens

| Status | Descrição |
|--------|-----------|
| `pending` | Mensagem enfileirada para envio |
| `sent` | Mensagem enviada ao WhatsApp |
| `delivered` | Mensagem entregue no celular |
| `read` | Mensagem lida pelo destinatário |
| `failed` | Envio falhou |
| `deleted` | Mensagem foi deletada |

---

## Tipos de Mensagem

| Tipo | Campo Obrigatório | Campos Opcionais |
|------|-------------------|------------------|
| `text` | `text` | - |
| `image` | `mediaUrl` | `caption` |
| `video` | `mediaUrl` | `caption` |
| `audio` | `mediaUrl` | - |
| `document` | `mediaUrl` | `caption` |
| `location` | `latitude`, `longitude` | `caption` |
| `contact` | `name`, `phone` | - |
| `sticker` | `mediaUrl` | - |

---

## Autenticação

Todos os endpoints protegidos requerem um token Bearer no header:

```
Authorization: Bearer seu_token_aqui
```

O token é obtido do cliente durante a criação/ativação da conta.

---

## ID de Correlação

Toda operação gera automaticamente um `correlationId` para rastreabilidade completa:

```json
{
  "correlationId": "550e8400-e29b-41d4-a716-446655440002"
}
```

Use este ID para rastrear logs e operações relacionadas.

---

## Tratamento de Erros

Todos os erros seguem o padrão HTTP e incluem mensagem descritiva:

```json
{
  "statusCode": 400,
  "message": "Invalid recipient phone number format",
  "error": "Bad Request"
}
```

---

## Retry Logic (BullMQ)

- **Tentativas:** 3 (configurável)
- **Backoff:** Exponencial (2s, 4s, 8s)
- **TTL:** Não expiram (processadas ou movidas para DLQ após todas as tentativas)

---

## Limites e Quotas

- **Taxa de envio:** Respeitada pelo WhatsApp (geralmente ~60 msgs/min por número)
- **Tamanho de mídia:** Limitado pelo WhatsApp (~16MB)
- **Tamanho de texto:** Máximo ~4096 caracteres
- **Duração de áudio:** Máximo ~16MB (geralmente ~5-10 minutos)

---

## Exemplo de Fluxo Completo

### 1. Enviar mensagem

```bash
curl -X POST http://localhost:8080/api/messages/send \
  -H "Authorization: Bearer token123" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "5511999999999",
    "type": "text",
    "text": "Olá!"
  }'

# Response
{
  "messageId": "msg_123",
  "status": "pending",
  "timestamp": "2025-11-05T18:00:00Z"
}
```

### 2. Consultar status

```bash
curl -X GET "http://localhost:8080/api/messages/msg_123" \
  -H "Authorization: Bearer token123"

# Response (alguns segundos depois)
{
  "messageId": "msg_123",
  "status": "delivered",  # Atualizado!
  "sentAt": "2025-11-05T18:00:05Z",
  "deliveredAt": "2025-11-05T18:00:10Z"
}
```

### 3. Encaminhar para outro destinatário

```bash
curl -X POST http://localhost:8080/api/messages/forward \
  -H "Authorization: Bearer token123" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "msg_123",
    "recipients": ["5511977777777"]
  }'

# Response
{
  "forwardedTo": ["5511977777777"],
  "status": "success"
}
```

---

## Webhook WhatsApp (Recebimento)

Configure seu webhook do WhatsApp para chamar:

```
POST /api/messages/receive
```

Com o seguinte payload:

```json
{
  "from": "5511988888888",
  "messageId": "wamsgid_XXX",
  "type": "text",
  "text": "Mensagem do usuário",
  "timestamp": "2025-11-05T17:59:00Z"
}
```

A resposta esperada é:

```json
{
  "status": "received",
  "processed": true
}
```

---

## Logs e Rastreabilidade

Todas as operações são registradas com:

- **Timestamp:** Data e hora exata
- **Correlation ID:** Para rastrear operação completa
- **Client ID:** Qual cliente fez a operação
- **Status:** Sucesso ou erro
- **Detalhes:** Informações específicas da operação

Exemplo de log:

```
[2025-11-05T18:00:00Z] [550e8400...] POST /api/messages/send | Client: abc123 | Status: pending
[2025-11-05T18:00:05Z] [550e8400...] Message sent via WhatsApp | ID: wamsgid_XXX
[2025-11-05T18:00:10Z] [550e8400...] Message delivered | Status: delivered
```

---

## Próximos Passos

1. ✅ Implementar endpoints básicos
2. ⏳ Integração completa com Baileys (receber eventos de delivery/read)
3. ⏳ Webhook para notificações em tempo real
4. ⏳ Dashboard de monitoramento
5. ⏳ Análise e métricas de mensagens
