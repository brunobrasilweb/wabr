import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import axios, { AxiosError } from 'axios';
import { WhatsappWebhook, WebhookStatus } from './webhook.entity';
import { WhatsappWebhookEvent, WebhookEventStatus } from './webhook-event.entity';

export interface WebhookPayload {
  client_id: number;
  message_id: string;
  from: string;
  to: string;
  timestamp: string;
  type: string;
  content?: string;
  [key: string]: unknown;
}

export interface SendWebhookOptions {
  clientId: number;
  phoneNumber: string;
  messageId: string;
  from: string;
  to: string;
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly logger = new Logger(WebhookService.name);
  private readonly WEBHOOK_TIMEOUT = 10000; // 10 seconds
  private readonly INITIAL_RETRY_DELAY = 5000; // 5 seconds

  constructor(
    @InjectRepository(WhatsappWebhook)
    private readonly webhookRepo: Repository<WhatsappWebhook>,
    @InjectRepository(WhatsappWebhookEvent)
    private readonly eventRepo: Repository<WhatsappWebhookEvent>,
    @InjectQueue('webhooks')
    private readonly webhookQueue: Queue,
  ) {}

  onModuleInit() {
    this.logger.log('WebhookService initialized');
  }

  /**
   * Normalize phone numbers to a canonical digit-only form. Strips any @domain
   * suffix and non-digit characters. Example: '5511999999999@s.whatsapp.net' -> '5511999999999'
   */
  private normalizePhone(phone: string): string {
    if (!phone) return phone;
    let p = String(phone).trim();
    const atIdx = p.indexOf('@');
    if (atIdx !== -1) p = p.substring(0, atIdx);
    // remove non-digit characters
    p = p.replace(/\D+/g, '');
    return p;
  }

  /**
   * Register a new webhook for a client
   */
  async registerWebhook(
    clientId: number,
    phoneNumber: string,
    webhookUrl: string,
    maxRetries: number = 3,
  ): Promise<WhatsappWebhook> {
    // Validate webhook URL
    if (!this.isValidWebhookUrl(webhookUrl)) {
      throw new Error('Invalid webhook URL. Must be HTTPS.');
    }

    // Normalize phone number to a canonical form for storage and lookup
    const normalizedPhone = this.normalizePhone(phoneNumber);

    // Check if webhook already exists for this client + phone
    let existing = await this.webhookRepo.findOne({
      where: { clientId, phoneNumber: normalizedPhone },
    });

    if (existing) {
      // Update existing webhook
      existing.webhookUrl = webhookUrl;
      existing.isActive = true;
      existing.status = 'active';
      existing.maxRetries = maxRetries;
      existing.failureCount = 0;
      existing.lastError = null;
      return this.webhookRepo.save(existing);
    }

    // Create new webhook
    const webhook = this.webhookRepo.create({
      clientId,
      phoneNumber: normalizedPhone,
      webhookUrl,
      isActive: true,
      status: 'active',
      maxRetries,
      failureCount: 0,
      lastError: null,
    });

    return this.webhookRepo.save(webhook);
  }

  /**
   * Update webhook configuration
   */
  async updateWebhook(
    webhookId: string,
    update: Partial<WhatsappWebhook>,
  ): Promise<WhatsappWebhook> {
    const webhook = await this.webhookRepo.findOne({ where: { id: webhookId } });
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    if (update.webhookUrl && !this.isValidWebhookUrl(update.webhookUrl)) {
      throw new Error('Invalid webhook URL. Must be HTTPS.');
    }
    // Normalize phone number if provided in the update
    if (update.phoneNumber) {
      (update as any).phoneNumber = this.normalizePhone(update.phoneNumber as any);
    }

    Object.assign(webhook, update);
    return this.webhookRepo.save(webhook);
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    const webhook = await this.webhookRepo.findOne({ where: { id: webhookId } });
    if (!webhook) {
      throw new Error('Webhook not found');
    }
    await this.webhookRepo.remove(webhook);
  }

  /**
   * Get webhook by ID
   */
  async getWebhook(webhookId: string): Promise<WhatsappWebhook | null> {
    return this.webhookRepo.findOne({ where: { id: webhookId } });
  }

  /**
   * Get webhook for a specific client and phone number
   */
  async getWebhookByClientAndPhone(
    clientId: number,
    phoneNumber: string,
  ): Promise<WhatsappWebhook | null> {
    const normalized = this.normalizePhone(phoneNumber);
    return this.webhookRepo.findOne({
      where: { clientId, phoneNumber: normalized, isActive: true },
    });
  }

  /**
   * List all webhooks for a client
   */
  async listWebhooksByClient(clientId: number): Promise<WhatsappWebhook[]> {
    return this.webhookRepo.find({
      where: { clientId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find any active webhook by phone number regardless of client.
   * This is a best-effort helper used as a fallback when clientId mapping is not available.
   */
  async findAnyActiveWebhookByPhone(phoneNumber: string): Promise<WhatsappWebhook | null> {
    const normalized = this.normalizePhone(phoneNumber);
    return this.webhookRepo.findOne({ where: { phoneNumber: normalized, isActive: true } });
  }

  /**
   * Send a message payload to the configured webhook
   * Creates a webhook event record and enqueues delivery job
   */
  async sendWebhookEvent(options: SendWebhookOptions): Promise<WhatsappWebhookEvent> {
    const { clientId, phoneNumber, messageId, from, to, type, content, metadata } = options;

    // Find active webhook for this client + phone
    const webhook = await this.getWebhookByClientAndPhone(clientId, phoneNumber);
    if (!webhook) {
      this.logger.warn(
        `No active webhook found for clientId=${clientId} phoneNumber=${phoneNumber}`,
      );
      throw new Error('No active webhook configured');
    }

    // Build payload
    const payload: WebhookPayload = {
      client_id: clientId,
      message_id: messageId,
      from,
      to,
      timestamp: new Date().toISOString(),
      type,
      ...(content && { content }),
      ...(metadata && { metadata }),
    };

    // Create event record
    const event = this.eventRepo.create({
      webhookId: webhook.id,
      messageId,
      from,
      to,
      messageType: type,
      content: content || null,
      payload,
      status: 'pending' as WebhookEventStatus,
      attemptCount: 0,
    });

    const savedEvent = await this.eventRepo.save(event);

    // Enqueue delivery job
    try {
      await this.webhookQueue.add(
        'deliver',
        {
          eventId: savedEvent.id,
          webhookId: webhook.id,
          payload,
          attemptNumber: 0,
        },
        {
          attempts: webhook.maxRetries,
          backoff: {
            type: 'exponential',
            delay: this.INITIAL_RETRY_DELAY,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log(`Enqueued webhook delivery for eventId=${savedEvent.id}`);
    } catch (err) {
      this.logger.error('Failed to enqueue webhook delivery', err as any);
      // Continue anyway - event is recorded in DB
    }

    return savedEvent;
  }

  /**
   * Perform actual HTTP delivery to webhook endpoint
   * This is called by the queue processor
   */
  async deliverWebhookPayload(
    eventId: string,
    webhookId: string,
    payload: WebhookPayload,
    attemptNumber: number,
  ): Promise<{ success: boolean; statusCode?: number; response?: string; error?: string }> {
    try {
      // Fetch webhook and event from DB
      const webhook = await this.getWebhook(webhookId);
      if (!webhook || !webhook.isActive) {
        throw new Error('Webhook is not active');
      }

      const event = await this.eventRepo.findOne({ where: { id: eventId } });
      if (!event) {
        throw new Error('Event not found');
      }

      // Perform HTTP POST
      this.logger.log(`Attempting webhook delivery #${attemptNumber + 1} to ${webhook.webhookUrl}`);

      // Decide if we should print full payloads. Enable if explicit env var set or not in production.
      const showPayloads = process.env.LOG_WEBHOOK_PAYLOADS === 'true' || process.env.NODE_ENV !== 'production';
      let payloadStr = '<unserializable>';
      try {
        payloadStr = JSON.stringify(payload);
      } catch (e) {
        payloadStr = '<unserializable>';
      }

      if (showPayloads) {
        // Use debug level for payload details; also write to console as a reliable fallback
        try {
          this.logger.debug(`Dispatching to webhook url=${webhook.webhookUrl} payload=${payloadStr}`);
        } catch (e) {
          // ignore logger failures
        }
        try {
          // console.log ensures the message appears even if Nest logger is configured differently
          // Keep format concise to be greppable in logs
          // eslint-disable-next-line no-console
          console.log(`[webhook] dispatch url=${webhook.webhookUrl} payload=${payloadStr}`);
        } catch (e) {
          // ignore
        }
      } else {
        this.logger.debug(`Dispatching to webhook url=${webhook.webhookUrl} payload=<hidden>`);
      }

      const response = await axios.post(webhook.webhookUrl, payload, {
        timeout: this.WEBHOOK_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event-ID': eventId,
          'X-Webhook-Timestamp': new Date().toISOString(),
        },
      });

      // Success
      this.logger.log(
        `Webhook delivery successful for eventId=${eventId}, statusCode=${response.status}`,
      );

      // Update event as delivered
      event.status = 'delivered';
      event.attemptCount = attemptNumber + 1;
      event.httpStatus = response.status;
      event.response = JSON.stringify(response.data);
      event.deliveredAt = new Date();
      await this.eventRepo.save(event);

      // Update webhook metrics
      webhook.failureCount = 0;
      webhook.lastSuccessAt = new Date();
      webhook.lastAttemptAt = new Date();
      webhook.lastError = null;
      webhook.status = 'active';
      await this.webhookRepo.save(webhook);

      return {
        success: true,
        statusCode: response.status,
        response: JSON.stringify(response.data),
      };
    } catch (err: any) {
      this.logger.warn(
        `Webhook delivery failed for eventId=${eventId}, attempt=${attemptNumber + 1}`,
        err?.message ?? err,
      );

      // Update event with error
      const event = await this.eventRepo.findOne({ where: { id: eventId } });
      if (event) {
        event.attemptCount = attemptNumber + 1;
        event.status = 'failed';
        const errorMsg = this.extractErrorMessage(err);
        event.error = errorMsg;
        event.httpStatus = err?.response?.status || null;
        event.response = err?.response?.data ? JSON.stringify(err.response.data) : null;

        // Check if this was the last attempt
        const webhook = await this.getWebhook(webhookId);
        if (webhook && attemptNumber + 1 >= webhook.maxRetries) {
          event.status = 'failed';
          // Calculate next retry
          const delay = this.INITIAL_RETRY_DELAY * Math.pow(2, attemptNumber);
          event.nextRetryAt = new Date(Date.now() + delay);
        }

        await this.eventRepo.save(event);
      }

      // Update webhook failure metrics
      const webhook = await this.getWebhook(webhookId);
      if (webhook) {
        webhook.failureCount = (webhook.failureCount || 0) + 1;
        webhook.lastAttemptAt = new Date();
        webhook.lastError = this.extractErrorMessage(err);

        // Mark webhook as failed if too many consecutive failures
        if (webhook.failureCount >= 5) {
          webhook.status = 'failed';
          this.logger.warn(`Webhook marked as failed due to ${webhook.failureCount} consecutive failures`);
        }

        await this.webhookRepo.save(webhook);
      }

      // Re-throw error to let BullMQ retry
      throw new Error(`Webhook delivery failed: ${this.extractErrorMessage(err)}`);
    }
  }

  /**
   * Get delivery events for a webhook
   */
  async getWebhookEvents(
    webhookId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ events: WhatsappWebhookEvent[]; total: number }> {
    const [events, total] = await this.eventRepo.findAndCount({
      where: { webhookId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    return { events, total };
  }

  /**
   * Retry a failed webhook event
   */
  async retryWebhookEvent(eventId: string): Promise<WhatsappWebhookEvent> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) {
      throw new Error('Event not found');
    }

    // Reset event for retry
    event.status = 'pending';
    event.attemptCount = 0;
    event.error = null;
    event.response = null;
    event.httpStatus = null;
    event.nextRetryAt = null;
    const saved = await this.eventRepo.save(event);

    // Re-enqueue
    try {
      const webhook = await this.getWebhook(event.webhookId);
      if (webhook) {
        await this.webhookQueue.add(
          'deliver',
          {
            eventId: saved.id,
            webhookId: event.webhookId,
            payload: event.payload,
            attemptNumber: 0,
          },
          {
            attempts: webhook.maxRetries,
            backoff: {
              type: 'exponential',
              delay: this.INITIAL_RETRY_DELAY,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }
    } catch (err) {
      this.logger.error('Failed to re-enqueue webhook event', err as any);
    }

    return saved;
  }

  /**
   * Toggle webhook active status
   */
  async toggleWebhook(webhookId: string, isActive: boolean): Promise<WhatsappWebhook> {
    const webhook = await this.getWebhook(webhookId);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    webhook.isActive = isActive;
    webhook.status = isActive ? 'active' : 'inactive';
    return this.webhookRepo.save(webhook);
  }

  /**
   * Validate webhook URL (must be HTTPS)
   */
  private isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Allow HTTP in development, enforce HTTPS in production
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && parsed.protocol !== 'https:') {
        return false;
      }
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (e) {
      return false;
    }
  }

  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(err: any): string {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    if (err.response?.statusText) return `${err.response.status} ${err.response.statusText}`;
    return JSON.stringify(err);
  }
}
