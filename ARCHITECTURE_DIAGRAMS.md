# Webhook Architecture Diagram

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          External Integrations                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   WhatsApp   │  │   Baileys    │  │   Session    │                   │
│  │   Network    │  │   Socket     │  │   Manager    │                   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   │
│         │                  │                  │                           │
└─────────┼──────────────────┼──────────────────┼───────────────────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                     ┌───────▼───────┐
                     │ BaileysManager│
                     │   (Enhanced)  │
                     │ Emits Message │
                     │    Event      │
                     └───────┬───────┘
                             │
                             │ message event
                             │
        ┌────────────────────▼────────────────────┐
        │      WhatsAppService.onModuleInit()    │
        │                                         │
        │  Listens to 'message' events            │
        │  Extracts: messageId, from, to, type    │
        └────────────────────┬────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  WebhookService │
                    │ sendWebhookEvent│
                    └────────┬────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
   ┌────▼──────┐                        ┌────────▼─────┐
   │ Create    │                        │   Enqueue    │
   │  Event    │                        │     Job      │
   │  Record   │                        │  to Queue    │
   └────┬──────┘                        └────────┬─────┘
        │                                        │
   ┌────▼──────────────────────────────┐   ┌────▼──────┐
   │   WhatsappWebhookEvent            │   │  BullMQ   │
   │   (Database Audit Log)            │   │  Queue    │
   │                                   │   │ (Redis)   │
   │ - event_id (UUID)                 │   └────┬──────┘
   │ - webhook_id                      │        │
   │ - message_id                      │        │ Job Dequeue
   │ - payload (JSON)                  │        │
   │ - status (pending/delivered/fail) │        │
   │ - attempt_count                   │   ┌────▼────────────┐
   │ - http_status                     │   │ WebhookProcessor│
   │ - error (if failed)               │   │                │
   │ - next_retry_at                   │   └────┬───────────┘
   │ - created_at                      │        │
   │ - delivered_at                    │        │ Process Job
   └───────────────────────────────────┘        │
                                         ┌──────▼──────────┐
                                         │   Delivery      │
                                         │   Attempt       │
                                         │                │
                                         │ - Validate URL  │
                                         │ - Build Payload │
                                         │ - HTTP POST     │
                                         │ - Handle Response
                                         └──────┬──────────┘
                                                │
                                    ┌───────────┼───────────┐
                                    │           │           │
                            ┌───────▼──┐  ┌────▼───┐  ┌────▼────┐
                            │ Success  │  │ Failure│  │ Timeout │
                            │  (200)   │  │ (4xx)  │  │ (10s)   │
                            └───────┬──┘  └────┬───┘  └────┬─────┘
                                    │          │           │
                          ┌─────────▼─────────▼───────────▼─┐
                          │  Update Event Status            │
                          │  Update Webhook Metrics         │
                          │  Record Response/Error          │
                          └─────────┬─────────────────────┬─┘
                                    │                     │
                            ┌───────▼──┐          ┌──────▼──────┐
                            │ Success: │          │ Check Retry │
                            │ status = │          │ Attempt #   │
                            │delivered │          └──────┬──────┘
                            └──────────┘                 │
                                                ┌────────┴──────────┐
                                                │                   │
                                        ┌──────▼─┐         ┌───────▼────┐
                                        │ Retry  │         │ Permanent  │
                                        │ With   │         │ Failure    │
                                        │Backoff │         │            │
                                        └────┬───┘         └────────────┘
                                             │
                                        ┌────▼───┐
                                        │ Requeue│
                                        │ to     │
                                        │ Queue  │
                                        └────────┘
```

## Component Interaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          REST API Layer                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  WebhookController                                                      │
│  ├─ @Post('/register')              → registerWebhook()              │
│  ├─ @Get('/list')                   → listWebhooks()                 │
│  ├─ @Get(':webhook_id')             → getWebhook()                   │
│  ├─ @Patch(':webhook_id')           → updateWebhook()                │
│  ├─ @Delete(':webhook_id')          → deleteWebhook()                │
│  ├─ @Get(':webhook_id/events')      → getWebhookEvents()             │
│  └─ @Post('events/:event_id/retry') → retryWebhookEvent()            │
│                                                                         │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
                       │ Uses
                       │
┌──────────────────────▼──────────────────────────────────────────────────┐
│                       Service Layer                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  WebhookService                                                         │
│  ├─ registerWebhook()                                                 │
│  ├─ updateWebhook()                                                   │
│  ├─ deleteWebhook()                                                   │
│  ├─ getWebhook()                                                      │
│  ├─ listWebhooksByClient()                                            │
│  ├─ sendWebhookEvent()     ──► Creates event record + enqueues job   │
│  ├─ deliverWebhookPayload() ──► Performs HTTP delivery               │
│  ├─ getWebhookEvents()                                                │
│  ├─ retryWebhookEvent()                                               │
│  └─ toggleWebhook()                                                   │
│                                                                         │
│  WhatsappService                                                        │
│  ├─ onModuleInit()         ──► Listens to baileys.events['message']  │
│  ├─ createConnection()                                                │
│  ├─ disconnect()                                                      │
│  ├─ status()                                                          │
│  └─ sendText()                                                        │
│                                                                         │
└──────────────┬─────────────────────────┬──────────────────────────────┘
               │                         │
               │ Uses                    │ Uses
               │                         │
      ┌────────▼────────┐      ┌─────────▼────────┐
      │ WhatsappService │      │ WebhookProcessor │
      │   Event Bus     │      │  BullMQ Job      │
      └────────┬────────┘      └─────────┬────────┘
               │                         │
               │ Emits                   │ Processes
               │                         │
      ┌────────▼────────┐      ┌─────────▼────────┐
      │ 'message' event │      │ 'deliver' job    │
      └────────────────┘      └──────────────────┘
```

## Data Flow: Message Reception

```
Time →

  1. WhatsApp Message Arrives
     │
     └─► BaileysManager Socket receives
         │
         └─► Emits 'messages.upsert' event
             │
             └─► WebhookService listener parses message
                 │
                 ├─ Extract: messageId, from, to, type, content
                 │
                 ├─ Build IncomingMessage object
                 │
                 └─► Emit 'message' event
                     │
                     └─► WhatsappService listener receives
                         │
                         ├─ Find WhatsappConnection
                         │
                         ├─ Extract clientId, phoneNumber
                         │
                         └─► WebhookService.sendWebhookEvent()
                             │
                             ├─ Find webhook config
                             │
                             ├─ Build JSON payload
                             │
                             ├─ Create WhatsappWebhookEvent record
                             │
                             └─► Queue.add('deliver', {eventId, webhookId, payload})
                                 │
                                 └─► Job persisted in Redis
                                     │
                                     └─► Available for processing
```

## Database Schema Diagram

```
┌─────────────────────────────────┐
│     whatsapp_webhooks           │
├─────────────────────────────────┤
│ PK: id (UUID)                   │
│ FK: client_id (INT)             │
│ UQ: (client_id, phone_number)   │
├─────────────────────────────────┤
│ phone_number (VARCHAR)          │
│ webhook_url (TEXT - HTTPS only) │
│ is_active (BOOLEAN)             │
│ status (ENUM)                   │
│ failure_count (INT)             │
│ max_retries (INT - default 3)   │
│ last_error (TEXT)               │
│ last_success_at (TIMESTAMP)     │
│ last_attempt_at (TIMESTAMP)     │
│ metadata (JSON)                 │
│ created_at, updated_at          │
└────────────────┬────────────────┘
                 │
                 │ 1:N
                 │
┌────────────────▼────────────────┐
│  whatsapp_webhook_events        │
├─────────────────────────────────┤
│ PK: id (UUID)                   │
│ FK: webhook_id (UUID)           │
├─────────────────────────────────┤
│ message_id (VARCHAR)            │
│ from, to (VARCHAR)              │
│ message_type (VARCHAR)          │
│ content (TEXT)                  │
│ payload (JSON)                  │
│ status (ENUM)                   │
│ attempt_count (INT)             │
│ http_status (INT)               │
│ response (TEXT)                 │
│ error (TEXT)                    │
│ next_retry_at (TIMESTAMP)       │
│ created_at, delivered_at        │
└─────────────────────────────────┘
```

## External Integration Points

```
┌──────────────────────────────────────────────────────────────────┐
│                    External Systems                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ Client Webhook   │ ◄─── HTTP POST (JSON Payload)           │
│  │ Endpoint         │                                           │
│  │                  │                                           │
│  │ Your Backend:    │ ─────► Receives webhook events          │
│  │ - Store message  │       from our system                   │
│  │ - Process data   │                                           │
│  │ - Send response  │                                           │
│  │   (200 OK)       │                                           │
│  └──────────────────┘                                           │
│                                                                  │
│  Payload Format:                                                │
│  {                                                              │
│    "client_id": 1,                                              │
│    "message_id": "msg_123",                                     │
│    "from": "5511999999999",                                     │
│    "to": "5511888888888",                                       │
│    "timestamp": "2025-11-05T14:23:00Z",                         │
│    "type": "text",                                              │
│    "content": "Your message here"                               │
│  }                                                              │
│                                                                  │
│  Expected Response: HTTP 200 OK                                │
│  Optional body: {"status": "received"}                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Retry Logic Flow

```
Send to Webhook
      │
      ├─ Success (200-299)
      │  └─► Event: status = "delivered"
      │       Webhook: failure_count = 0
      │       Stop retrying ✓
      │
      ├─ Timeout (> 10s)
      │  └─► Event: status = "failed"
      │       Error: "Connection timeout"
      │
      ├─ Network Error
      │  └─► Event: status = "failed"
      │       Error: "ECONNREFUSED"
      │
      ├─ 4xx Response
      │  └─► Event: status = "failed"
      │       Error: "Client error (4xx)"
      │       Note: Don't retry 4xx errors
      │
      └─ 5xx Response
         └─► Event: status = "failed"
             Error: "Server error (5xx)"
             
             ├─ Attempt 1: Immediate (T+0ms)
             ├─ Attempt 2: T+5s (exponential backoff)
             ├─ Attempt 3: T+10s
             ├─ Attempt 4: T+20s (if max_retries ≥ 4)
             └─ Attempt N: T + (5000 * 2^(N-1))ms
                
                If all attempts fail:
                └─► Webhook: status = "failed"
                    Webhook: failure_count++
                    Event: next_retry_at = calculated time
                    
                    Can manually retry via API:
                    POST /api/webhooks/events/:event_id/retry
```

## Security & Authentication

```
┌──────────────────────────────────────────────────────┐
│            Authentication Flow                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Client Request                                      │
│  ├─ Header: Authorization: Bearer <TOKEN>          │
│  │                                                 │
│  └─► TokenAuthGuard                                │
│       ├─ Extract token                             │
│       ├─ Call ClientsService.findByToken()         │
│       ├─ Find matching client                      │
│       ├─ Attach to request: req.user = {client}    │
│       └─ Allow request to proceed OR Reject       │
│                                                      │
│  Inside Controller                                  │
│  ├─ Extract req.user.client.id                     │
│  ├─ Load webhooks for this client only             │
│  ├─ Verify webhook belongs to client               │
│  └─ All operations scoped to client                │
│                                                      │
│  Response                                           │
│  └─ 200 OK or 401 Unauthorized                     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

**Architecture Status**: ✅ Production Ready

*This diagram shows the complete flow from WhatsApp message reception through webhook delivery with full retry capability and audit logging.*
