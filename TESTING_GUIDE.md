# Webhook Testing Guide

## Unit Testing

### WebhookService Tests

```typescript
// src/whatsapp/webhook.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { WebhookService, SendWebhookOptions } from './webhook.service';
import { WhatsappWebhook } from './webhook.entity';
import { WhatsappWebhookEvent } from './webhook-event.entity';

describe('WebhookService', () => {
  let service: WebhookService;
  let webhookRepo: any;
  let eventRepo: any;
  let queue: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: getRepositoryToken(WhatsappWebhook),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WhatsappWebhookEvent),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getQueueToken('webhooks'),
          useValue: {
            add: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    webhookRepo = module.get(getRepositoryToken(WhatsappWebhook));
    eventRepo = module.get(getRepositoryToken(WhatsappWebhookEvent));
    queue = module.get(getQueueToken('webhooks'));
  });

  describe('registerWebhook', () => {
    it('should register a new webhook', async () => {
      const newWebhook = {
        id: 'uuid-1',
        clientId: 1,
        phoneNumber: '5511999999999',
        webhookUrl: 'https://example.com/webhook',
        isActive: true,
        status: 'active',
        maxRetries: 3,
      };

      webhookRepo.findOne.mockResolvedValue(null);
      webhookRepo.create.mockReturnValue(newWebhook);
      webhookRepo.save.mockResolvedValue(newWebhook);

      const result = await service.registerWebhook(
        1,
        '5511999999999',
        'https://example.com/webhook',
        3,
      );

      expect(result).toEqual(newWebhook);
      expect(webhookRepo.create).toHaveBeenCalled();
      expect(webhookRepo.save).toHaveBeenCalled();
    });

    it('should reject invalid webhook URL', async () => {
      await expect(
        service.registerWebhook(1, '5511999999999', 'http://example.com/webhook', 3),
      ).rejects.toThrow('Invalid webhook URL');
    });
  });

  describe('sendWebhookEvent', () => {
    it('should create event and enqueue delivery', async () => {
      const webhook = {
        id: 'webhook-uuid-1',
        clientId: 1,
        phoneNumber: '5511999999999',
        webhookUrl: 'https://example.com/webhook',
        maxRetries: 3,
      };

      const event = {
        id: 'event-uuid-1',
        webhookId: 'webhook-uuid-1',
        status: 'pending',
      };

      webhookRepo.findOne.mockResolvedValue(webhook);
      eventRepo.create.mockReturnValue(event);
      eventRepo.save.mockResolvedValue(event);
      queue.add.mockResolvedValue({});

      const result = await service.sendWebhookEvent({
        clientId: 1,
        phoneNumber: '5511999999999',
        messageId: 'msg_123',
        from: '5511999999999',
        to: '5511888888888',
        type: 'text',
        content: 'Hello',
      });

      expect(result.status).toBe('pending');
      expect(queue.add).toHaveBeenCalledWith(
        'deliver',
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('deliverWebhookPayload', () => {
    it('should mark event as delivered on success', async () => {
      // Implementation details...
    });

    it('should retry on failure', async () => {
      // Implementation details...
    });
  });
});
```

## Integration Testing

### End-to-End Webhook Flow

```typescript
// test/webhook.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Webhook E2E Tests', () => {
  let app: INestApplication;
  let clientToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Get a valid client token for testing
    clientToken = process.env.DEV_CLIENT_TOKEN || 'test-token';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/webhooks/register', () => {
    it('should register a webhook', () => {
      return request(app.getHttpServer())
        .post('/api/webhooks/register')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          phone_number: '5511999999999',
          webhook_url: 'https://webhook.example.com/receive',
          max_retries: 3,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.webhook.id).toBeDefined();
          expect(res.body.webhook.phone_number).toBe('5511999999999');
        });
    });

    it('should reject invalid webhook URL', () => {
      return request(app.getHttpServer())
        .post('/api/webhooks/register')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          phone_number: '5511999999999',
          webhook_url: 'http://webhook.example.com/receive',
          max_retries: 3,
        })
        .expect(400);
    });

    it('should require authentication', () => {
      return request(app.getHttpServer())
        .post('/api/webhooks/register')
        .send({
          phone_number: '5511999999999',
          webhook_url: 'https://webhook.example.com/receive',
        })
        .expect(401);
    });
  });

  describe('GET /api/webhooks/list', () => {
    it('should list webhooks for client', () => {
      return request(app.getHttpServer())
        .get('/api/webhooks/list')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(Array.isArray(res.body.webhooks)).toBe(true);
        });
    });
  });

  describe('PATCH /api/webhooks/:id', () => {
    let webhookId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/webhooks/register')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          phone_number: '5511999999999',
          webhook_url: 'https://webhook.example.com/receive',
          max_retries: 3,
        });

      webhookId = res.body.webhook.id;
    });

    it('should update webhook', () => {
      return request(app.getHttpServer())
        .patch(`/api/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          max_retries: 5,
          is_active: false,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.webhook.max_retries).toBe(5);
          expect(res.body.webhook.is_active).toBe(false);
        });
    });
  });

  describe('GET /api/webhooks/:id/events', () => {
    it('should list webhook events', () => {
      return request(app.getHttpServer())
        .get('/api/webhooks/:id/events?limit=10&offset=0')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('success');
          expect(res.body.count).toBe(0); // No events yet
          expect(res.body.total).toBe(0);
        });
    });
  });
});
```

## Manual Testing with curl

### 1. Register Webhook

```bash
TOKEN="your-client-token"
WEBHOOK_URL="https://webhook.site/unique-id"  # Use webhook.site for testing

curl -X POST http://localhost:8080/api/webhooks/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "5511999999999",
    "webhook_url": "'$WEBHOOK_URL'",
    "max_retries": 3
  }'
```

### 2. Create WhatsApp Connection

```bash
curl -X POST http://localhost:8080/api/whatsapp/connect \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-123",
    "phone_number": "5511999999999"
  }'
```

### 3. Scan QR Code

The response from step 2 will contain a `qr_code`. Use WhatsApp or a QR code scanner to authenticate.

### 4. Send Test Message

Send a WhatsApp message to the registered number from another phone.

### 5. Check Webhook Events

```bash
WEBHOOK_ID="from-register-response"

curl -X GET "http://localhost:8080/api/webhooks/$WEBHOOK_ID/events" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### 6. Verify Webhook Delivery

Visit `webhook.site` to see the received payload in real-time.

## Load Testing

### k6 Load Test Script

```javascript
// test/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m30s', target: 100 },
    { duration: '20s', target: 0 },
  ],
};

export default function () {
  const payload = {
    client_id: 1,
    message_id: `msg_${__VU}_${__ITER}`,
    from: '5511999999999',
    to: '5511888888888',
    timestamp: new Date().toISOString(),
    type: 'text',
    content: 'Load test message',
  };

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Event-ID': `event_${__VU}_${__ITER}`,
    },
  };

  const res = http.post(
    'https://webhook.site/unique-id',
    JSON.stringify(payload),
    params,
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  sleep(1);
}
```

Run with:
```bash
k6 run test/load-test.js
```

## Monitoring Checklist

- [ ] Verify webhook URL is accessible
- [ ] Check webhook timeout (should be ~10 seconds)
- [ ] Verify retry attempts are working
- [ ] Check database for event records
- [ ] Monitor Redis queue depth
- [ ] Verify authentication token is valid
- [ ] Check application logs for errors
- [ ] Verify HTTPS is enforced in production

## Database Verification Queries

```sql
-- Check webhook configuration
SELECT * FROM whatsapp_webhooks 
WHERE client_id = 1 AND phone_number = '5511999999999';

-- Check event status
SELECT 
  id, 
  message_id, 
  status, 
  attempt_count, 
  http_status, 
  error,
  created_at 
FROM whatsapp_webhook_events 
ORDER BY created_at DESC 
LIMIT 10;

-- Check failed events
SELECT 
  id, 
  webhook_id, 
  status, 
  attempt_count, 
  error 
FROM whatsapp_webhook_events 
WHERE status = 'failed' 
ORDER BY created_at DESC 
LIMIT 10;

-- Webhook metrics
SELECT 
  webhook_id, 
  COUNT(*) as total_events,
  COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  ROUND(100.0 * COUNT(CASE WHEN status = 'delivered' THEN 1 END) / COUNT(*), 2) as success_rate
FROM whatsapp_webhook_events 
GROUP BY webhook_id;
```

## Debugging Commands

```bash
# Check Redis connection
redis-cli ping

# View webhook queue
redis-cli LLEN bull:webhooks:deliver

# Inspect failed jobs
redis-cli HGETALL bull:webhooks:deliver:failed

# Clear queue (careful!)
redis-cli DEL bull:webhooks:*

# Application logs with webhook filter
npm run start:dev | grep -i webhook

# Database logs
tail -f /var/log/postgres/postgresql.log | grep -i webhook
```

---

**Status**: Ready for comprehensive testing
