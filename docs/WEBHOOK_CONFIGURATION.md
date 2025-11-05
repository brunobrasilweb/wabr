# Webhook Configuration for WhatsApp Message Processing

## Overview

This document describes the webhook functionality that enables each client to receive and process incoming WhatsApp messages through their own configured HTTP endpoint.

## Architecture

### Components

1. **WhatsappWebhook Entity** - Stores webhook configuration for each client-phone combination
2. **WhatsappWebhookEvent Entity** - Audit log for all webhook deliveries and attempts
3. **WebhookService** - Business logic for managing webhooks and payload delivery
4. **WebhookController** - REST API endpoints for webhook management
5. **WebhookProcessor** - BullMQ job processor for asynchronous delivery with retries
6. **BaileysManager** - Enhanced to emit `message` events when new WhatsApp messages arrive

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Incoming WhatsApp Message (via Baileys)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ BaileysManager       │
            │ emits 'message' event│
            └──────────┬───────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ WhatsappService      │
            │ processes message    │
            └──────────┬───────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │ WebhookService         │
          │ .sendWebhookEvent()    │
          │ - Create event record  │
          │ - Enqueue job          │
          └────────────┬───────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │ BullMQ Queue           │
          │ (webhooks:deliver)     │
          │ Redis persistence      │
          └────────────┬───────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │ WebhookProcessor       │
          │ deliverWebhookPayload()│
          │ - HTTP POST to webhook │
          │ - Retry on failure     │
          │ - Update event status  │
          └────────────┬───────────┘
                       │
                    Success or Failure
                       │
                       ▼
          ┌────────────────────────┐
          │ Client's Webhook URL   │
          │ (external endpoint)    │
          │ POST receives payload  │
          └────────────────────────┘
```

## Database Schema

### WhatsappWebhook
Stores the webhook configuration per client:

```sql
CREATE TABLE whatsapp_webhooks (
  id UUID PRIMARY KEY,
  client_id INTEGER NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  webhook_url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(24) DEFAULT 'active',
  failure_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  last_success_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id, phone_number)
);
```

### WhatsappWebhookEvent
Audit log for each message delivery attempt:

```sql
CREATE TABLE whatsapp_webhook_events (
  id UUID PRIMARY KEY,
  webhook_id UUID NOT NULL,
  message_id VARCHAR(64) NOT NULL,
  from VARCHAR(32) NOT NULL,
  to VARCHAR(32) NOT NULL,
  message_type VARCHAR(32) DEFAULT 'text',
  content TEXT,
  payload JSON NOT NULL,
  status VARCHAR(24) DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  http_status INTEGER,
  response TEXT,
  error TEXT,
  next_retry_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP,
  FOREIGN KEY (webhook_id) REFERENCES whatsapp_webhooks(id) ON DELETE CASCADE
);
```

## REST API Endpoints

All endpoints require Bearer token authentication via the `TokenAuthGuard`.

### 1. Register Webhook
**POST** `/api/webhooks/register`

Register a new webhook or update an existing one for a phone number.

**Request:**
```json
{
  "phone_number": "5511999999999",
  "webhook_url": "https://your-domain.com/api/webhooks/whatsapp",
  "max_retries": 3
}
```

**Response (201):**
```json
{
  "status": "success",
  "webhook": {
    "id": "uuid-1234",
    "client_id": 1,
    "phone_number": "5511999999999",
    "webhook_url": "https://your-domain.com/api/webhooks/whatsapp",
    "is_active": true,
    "status": "active",
    "max_retries": 3,
    "created_at": "2025-11-05T14:23:00Z",
    "updated_at": "2025-11-05T14:23:00Z"
  }
}
```

### 2. List Webhooks
**GET** `/api/webhooks/list`

List all webhooks for the authenticated client.

**Response (200):**
```json
{
  "status": "success",
  "count": 2,
  "webhooks": [
    {
      "id": "uuid-1234",
      "client_id": 1,
      "phone_number": "5511999999999",
      "webhook_url": "https://your-domain.com/api/webhooks/whatsapp",
      "is_active": true,
      "status": "active",
      "failure_count": 0,
      "max_retries": 3,
      "last_error": null,
      "last_success_at": "2025-11-05T15:00:00Z",
      "last_attempt_at": "2025-11-05T15:00:00Z",
      "created_at": "2025-11-05T14:23:00Z",
      "updated_at": "2025-11-05T14:23:00Z"
    }
  ]
}
```

### 3. Get Webhook Details
**GET** `/api/webhooks/:webhook_id`

Retrieve details for a specific webhook.

**Response (200):**
```json
{
  "status": "success",
  "webhook": { /* same structure as above */ }
}
```

### 4. Update Webhook
**PATCH** `/api/webhooks/:webhook_id`

Update webhook configuration.

**Request:**
```json
{
  "webhook_url": "https://new-domain.com/api/webhooks/whatsapp",
  "is_active": true,
  "max_retries": 5
}
```

**Response (200):** Same as GET webhook

### 5. Delete Webhook
**DELETE** `/api/webhooks/:webhook_id`

Remove a webhook configuration.

**Response (200):**
```json
{
  "status": "success",
  "message": "Webhook deleted successfully"
}
```

### 6. Get Webhook Events
**GET** `/api/webhooks/:webhook_id/events?limit=50&offset=0`

Retrieve delivery events for a webhook (paginated).

**Response (200):**
```json
{
  "status": "success",
  "total": 150,
  "count": 50,
  "events": [
    {
      "id": "event-uuid-1",
      "webhook_id": "webhook-uuid-1",
      "message_id": "msg_987654",
      "from": "5511999999999",
      "to": "5511888888888",
      "message_type": "text",
      "content": "Olá! Gostaria de mais informações.",
      "status": "delivered",
      "attempt_count": 1,
      "http_status": 200,
      "error": null,
      "response": "{\"acknowledged\": true}",
      "next_retry_at": null,
      "created_at": "2025-11-05T14:23:00Z",
      "delivered_at": "2025-11-05T14:23:05Z"
    }
  ]
}
```

### 7. Retry Failed Event
**POST** `/api/webhooks/events/:event_id/retry`

Manually retry delivery of a failed webhook event.

**Response (200):**
```json
{
  "status": "success",
  "message": "Event requeued for delivery",
  "event": {
    "id": "event-uuid-1",
    "status": "pending",
    "attempt_count": 0
  }
}
```

## Webhook Payload Format

When a message is received, the system sends the following JSON payload to your webhook URL via **HTTP POST**:

```json
{
  "client_id": 1,
  "message_id": "msg_987654",
  "from": "5511999999999",
  "to": "5511888888888",
  "timestamp": "2025-11-05T14:23:00Z",
  "type": "text",
  "content": "Olá! Gostaria de mais informações.",
  "metadata": {}
}
```

### Payload Fields

| Field | Type | Description |
|-------|------|-------------|
| `client_id` | integer | The client ID |
| `message_id` | string | Unique message identifier from Baileys |
| `from` | string | Sender phone number (e.g., "5511999999999") |
| `to` | string | Recipient phone number |
| `timestamp` | string | ISO 8601 timestamp when message was received |
| `type` | string | Message type (text, image, audio, video, document, etc.) |
| `content` | string | Message content (text for text messages, caption for media) |
| `metadata` | object | Additional metadata |

## Retry Strategy

### Exponential Backoff

Failed deliveries are retried with exponential backoff:

- **Attempt 1**: Immediate
- **Attempt 2**: ~5 seconds later
- **Attempt 3**: ~10 seconds later
- **Attempt 4**: ~20 seconds later (if max_retries > 3)

### Success Criteria

The webhook endpoint must respond with:
- HTTP Status: **200-299** (successful)
- Content-Type: Any format accepted

### Failure Handling

If all retry attempts fail:
1. Event is marked as `failed` in `WhatsappWebhookEvent`
2. Webhook status is updated in `WhatsappWebhook`
3. `failure_count` is incremented
4. After 5 consecutive failures, webhook status is set to `failed`
5. Manual retry can be triggered via the retry endpoint

### Redis/BullMQ Queue

- **Queue Name**: `webhooks`
- **Job Type**: `deliver`
- **Persistence**: Redis stores pending and failed jobs
- **Environment Variables**:
  ```env
  REDIS_HOST=localhost
  REDIS_PORT=6379
  REDIS_PASSWORD=
  REDIS_DB=0
  ```

## Implementation Notes

### Current State

The webhook infrastructure is fully implemented with the following components:

1. ✅ Database entities and schema
2. ✅ WebhookService with CRUD operations
3. ✅ WebhookController with REST API
4. ✅ BullMQ queue and processor
5. ✅ Exponential retry logic
6. ✅ Event audit logging
7. ⚠️ **PARTIAL**: Message event integration (see below)

### Next Steps: Integrate clientId Mapping

Currently, the `WhatsappConnection` entity stores `userId` but doesn't have a direct link to `clientId`. To complete the webhook integration:

1. **Add `clientId` to WhatsappConnection**:
   ```typescript
   @Column({ type: 'integer', nullable: false })
   clientId!: number;
   ```

2. **Update WhatsappService.onModuleInit()**:
   ```typescript
   this.baileys.events.on('message', async (payload: any) => {
     const connection = await this.repo.findOne({ where: { userId } });
     const clientId = connection.clientId; // Now available
     
     await this.webhookService.sendWebhookEvent({
       clientId,
       phoneNumber: connection.phoneNumber,
       messageId: message.messageId,
       from: message.from,
       to: message.to,
       type: message.type,
       content: message.content,
     });
   });
   ```

3. **Update WhatsappService.createConnection()**:
   ```typescript
   async createConnection(clientId: number, userId: string, phoneNumber: string) {
     const conn = this.repo.create({
       clientId,  // Store client relationship
       userId,
       phoneNumber,
       sessionStatus: 'reconnecting',
     });
     // ...
   }
   ```

## Error Handling

### HTTP Errors

- **400 Bad Request**: Invalid webhook URL (must be HTTPS in production)
- **401 Unauthorized**: Invalid bearer token or client mismatch
- **404 Not Found**: Webhook or event not found
- **500 Internal Server Error**: Database or processing errors

### Webhook Delivery Errors

- **Timeout (10s)**: Treated as delivery failure, triggers retry
- **Network Error**: Retry with exponential backoff
- **4xx/5xx Response**: Logged in event, triggers retry for 5xx

## Development & Testing

### Local Setup

```bash
# Install Redis
# macOS: brew install redis
# Linux: apt-get install redis-server
# Windows: Download from https://github.com/microsoftarchive/redis/releases

# Start Redis
redis-server

# Set environment variables
export REDIS_HOST=localhost
export REDIS_PORT=6379

# Run the application
npm run start:dev
```

### Testing Webhook Delivery

1. Register a webhook with a test URL (use `ngrok` or similar for local testing):
   ```bash
   ngrok http 3000
   ```

2. Create a simple test endpoint:
   ```typescript
   @Post('/test-webhook')
   testWebhook(@Body() body: any) {
     console.log('Received webhook:', body);
     return { status: 'ok' };
   }
   ```

3. Query webhook events to verify delivery:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://localhost:8080/api/webhooks/WEBHOOK_ID/events
   ```

## Security Considerations

1. **HTTPS Enforcement**: All webhook URLs must be HTTPS in production
2. **Bearer Token Authentication**: Clients must authenticate with valid tokens
3. **Client Isolation**: Clients can only access their own webhooks
4. **Rate Limiting**: (Future) Implement rate limiting for webhook registrations
5. **Signature Verification**: (Future) Add HMAC signatures to webhook payloads
6. **IP Whitelisting**: (Future) Support IP restrictions for webhooks

## Monitoring & Observability

### Metrics to Track

- Total webhooks registered
- Delivery success rate (%)
- Average delivery time (ms)
- Failed delivery count
- Retry attempts per message

### Logging

All webhook operations are logged via NestJS Logger:

```
[WebhookService] Enqueued webhook delivery for eventId=uuid
[WebhookProcessor] Processing webhook delivery job
[WebhookService] Webhook delivered successfully
[WebhookService] Webhook delivery failed for eventId=uuid
```

## Future Enhancements

1. **Webhook Signing**: Add HMAC-SHA256 signatures for payload verification
2. **Delivery Analytics**: Dashboard showing success rates, latencies
3. **Rate Limiting**: Configurable rate limits per client
4. **Custom Headers**: Allow clients to configure authentication headers
5. **Batch Delivery**: Option to batch multiple messages in single request
6. **Dead Letter Queue**: Separate storage for permanently failed deliveries
7. **Webhook Testing**: Built-in test delivery feature
