# Webhook Integration Implementation Guide

## Complete Integration Steps

This guide shows how to fully integrate the webhook functionality with your application's clientId mapping.

## Step 1: Update WhatsappConnection Entity

Add `clientId` to store the relationship between a WhatsApp session and a client:

```typescript
// src/whatsapp/whatsapp.entity.ts

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type WhatsappSessionStatus = 'connected' | 'disconnected' | 'reconnecting';

@Entity({ name: 'whatsapp_connections' })
export class WhatsappConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  // NEW: Add this column to track which client owns this WhatsApp connection
  @Column({ type: 'integer', nullable: false })
  clientId!: number;

  @Column({ length: 32 })
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 24, default: 'disconnected' })
  sessionStatus!: WhatsappSessionStatus;

  @Column({ type: 'json', nullable: true })
  sessionData?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

## Step 2: Run Database Migration

Execute the SQL migration to create webhook tables:

```bash
psql -U postgres -d your_db_name < docs/MIGRATION_WEBHOOK_SETUP.sql
```

Or run manually in your database client:

```sql
-- Copy content from docs/MIGRATION_WEBHOOK_SETUP.sql
-- Execute the CREATE TABLE statements
```

## Step 3: Update WhatsappService.createConnection()

Modify the method to accept and store clientId:

```typescript
// src/whatsapp/whatsapp.service.ts

async createConnection(
  clientId: number,  // NEW parameter
  userId: string,
  phoneNumber: string
): Promise<{ connection: WhatsappConnection; qr?: string }> {
  // enforce one active session per user
  const existing = await this.repo.findOne({ where: { userId } });
  if (existing && existing.sessionStatus === 'connected') {
    const err: any = new Error('Sessão já existente');
    err.code = 'SESSION_EXISTS';
    throw err;
  }

  // Create DB record BEFORE starting Baileys session
  const conn = this.repo.create({
    clientId,  // NEW: Store client reference
    userId,
    phoneNumber,
    sessionStatus: 'reconnecting',
    sessionData: null,
  } as any);

  const savedConn = await this.repo.save(conn as any);
  this.logger.log(
    `Created DB session record for clientId=${clientId}, userId=${userId} before starting Baileys`
  );

  try {
    const baileysSession = await this.baileys.createSession(userId, phoneNumber);

    savedConn.sessionStatus = baileysSession.connected ? 'connected' : 'reconnecting';
    savedConn.sessionData = baileysSession.sessionData
      ? { raw: baileysSession.sessionData }
      : ({ sessionId: baileysSession.sessionId } as any);

    const updated = await this.repo.save(savedConn as any);
    return { connection: updated, qr: baileysSession.qr };
  } catch (err) {
    savedConn.sessionStatus = 'disconnected';
    await this.repo.save(savedConn as any);
    throw err;
  }
}
```

## Step 4: Enable Message Webhook Processing

Complete the message event handler in WhatsappService.onModuleInit():

```typescript
// src/whatsapp/whatsapp.service.ts - in onModuleInit()

this.logger.log('Attaching BaileysManager.message listener for webhook processing');
this.baileys.events.on('message', async (payload: any) => {
  try {
    const { sessionId, userId, phoneNumber, message } = payload || {};
    if (!userId || !message) {
      this.logger.warn('message event missing userId or message, ignoring');
      return;
    }

    this.logger.log(
      `Received message event: userId=${userId}, messageId=${message.messageId}, from=${message.from}`
    );

    // Find the connection record to get clientId
    const connection = await this.repo.findOne({ where: { userId } });
    if (!connection) {
      this.logger.warn(`No connection found for userId=${userId}`);
      return;
    }

    // Now we have clientId from the connection!
    const clientId = connection.clientId;

    // Send webhook event
    try {
      await this.webhookService.sendWebhookEvent({
        clientId,
        phoneNumber: connection.phoneNumber,
        messageId: message.messageId,
        from: message.from,
        to: message.to,
        type: message.type,
        content: message.content,
      });
      
      this.logger.log(`Webhook event sent for messageId=${message.messageId}`);
    } catch (err) {
      this.logger.warn(`Failed to send webhook event: ${(err as any)?.message}`);
      // Continue - don't block message processing
    }
  } catch (e) {
    this.logger.error('Error processing message event', e as any);
  }
});
```

## Step 5: Update WhatsappController

Pass `clientId` when creating WhatsApp connections:

```typescript
// src/whatsapp/whatsapp.controller.ts

@Post('connect')
async connect(@Body() body: ConnectDto) {
  const { user_id, phone_number } = body as any;
  if (!user_id || !phone_number) {
    return { statusCode: 400, message: 'Invalid params' };
  }

  try {
    // Get client ID from request context (TokenAuthGuard sets it)
    const req = this; // In real code, inject Request object
    const clientId = (req as any).user?.client?.id;
    
    if (!clientId) {
      throw new UnauthorizedException('Client ID not found');
    }

    // Pass clientId to service
    const { connection, qr } = await this.svc.createConnection(
      clientId,    // NEW: Pass clientId
      user_id,
      phone_number
    );

    return {
      status: connection.sessionStatus === 'connected' ? 'connected' : 'reconnecting',
      qr_code: qr,
      session_id: connection.id,
    };
  } catch (err: any) {
    this.logger.error('connect error', err?.stack ?? err);
    if (err.code === 'SESSION_EXISTS') {
      throw new BadRequestException('Sessão já existente');
    }
    throw new InternalServerErrorException(err?.message ?? 'Internal error');
  }
}
```

## Step 6: Update TokenAuthGuard to Provide Client ID

Ensure the `TokenAuthGuard` properly sets the client in the request:

```typescript
// src/auth/token-auth.guard.ts (verify/update as needed)

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ClientsService } from '../clients/clients.service';

@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(private readonly clientsService: ClientsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }

    const client = await this.clientsService.findByToken(token);
    if (!client) {
      throw new UnauthorizedException('Invalid token');
    }

    // Attach client to request so it can be accessed by controllers
    request.user = { client };
    return true;
  }

  private extractTokenFromHeader(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }
}
```

## Step 7: Test the Complete Flow

### 1. Register a Webhook

```bash
curl -X POST http://localhost:8080/api/webhooks/register \
  -H "Authorization: Bearer YOUR_CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "5511999999999",
    "webhook_url": "https://your-webhook-endpoint.com/receive",
    "max_retries": 3
  }'
```

### 2. Create a WhatsApp Connection

```bash
curl -X POST http://localhost:8080/api/whatsapp/connect \
  -H "Authorization: Bearer YOUR_CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-uuid-123",
    "phone_number": "5511999999999"
  }'
```

### 3. Scan QR Code

The response will include a `qr_code`. Use it to authenticate with WhatsApp.

### 4. Send a Test Message

Send a message to the WhatsApp number from another phone. The system will:

1. Receive message in BaileysManager
2. Emit `message` event
3. WhatsappService listener catches event
4. WebhookService creates event record and enqueues job
5. WebhookProcessor sends HTTP POST to your webhook URL

### 5. Check Webhook Events

```bash
curl -X GET "http://localhost:8080/api/webhooks/WEBHOOK_ID/events" \
  -H "Authorization: Bearer YOUR_CLIENT_TOKEN"
```

## Step 8: Handle Webhook Payloads

Your webhook endpoint should receive and process:

```json
{
  "client_id": 1,
  "message_id": "msg_abc123",
  "from": "5511999999999",
  "to": "5511888888888",
  "timestamp": "2025-11-05T14:23:00Z",
  "type": "text",
  "content": "Hello from WhatsApp!",
  "metadata": {}
}
```

Example Node.js/Express handler:

```typescript
@Post('/receive')
async handleWebhookPayload(@Body() payload: any) {
  console.log('Received webhook payload:', payload);
  
  // Process the message
  const { client_id, message_id, from, to, content } = payload;
  
  // Store in your database, trigger automations, etc.
  await this.messageService.processIncomingMessage({
    clientId: client_id,
    messageId: message_id,
    senderPhone: from,
    recipientPhone: to,
    content: content,
  });
  
  // Return 200 OK to confirm receipt
  return { status: 'received' };
}
```

## Environment Configuration

Ensure your `.env` file has Redis configuration:

```env
# .env.local or .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Optional: For production
NODE_ENV=production
```

## Monitoring

Check the application logs for webhook activity:

```bash
# Watch logs for webhook processing
npm run start:dev | grep -i webhook
```

Expected log output:

```
[WhatsappService] Attaching BaileysManager.message listener for webhook processing
[BaileysManager] Emitting incoming message: msg_abc123
[WhatsappService] Received message event: userId=uuid-123, messageId=msg_abc123
[WebhookService] Enqueued webhook delivery for eventId=event-uuid
[WebhookProcessor] Processing webhook delivery job: eventId=event-uuid, attempt=1
[WebhookService] Webhook delivered successfully for eventId=event-uuid, statusCode=200
```

## Troubleshooting

### Webhook not triggering

1. Check Redis is running: `redis-cli ping` (should return PONG)
2. Verify clientId was stored: `SELECT * FROM whatsapp_connections WHERE user_id='...'`
3. Check logs for message events
4. Ensure webhook URL is accessible and returns 200-299

### Stuck in pending status

1. Check Redis queue: `redis-cli KEYS 'bull:webhooks:*'`
2. Check event status: `SELECT * FROM whatsapp_webhook_events WHERE status='pending'`
3. Restart the processor to reprocess jobs
4. Use retry endpoint: `POST /api/webhooks/events/EVENT_ID/retry`

### Timeout errors

1. Increase timeout in WebhookService: `private readonly WEBHOOK_TIMEOUT = 15000;`
2. Check webhook endpoint performance
3. Verify network connectivity to webhook URL

## Next Steps

1. ✅ Deploy to production
2. ✅ Monitor webhook delivery metrics
3. ✅ Implement custom headers authentication for webhooks
4. ✅ Add webhook signing (HMAC-SHA256)
5. ✅ Set up alerting for failed deliveries
