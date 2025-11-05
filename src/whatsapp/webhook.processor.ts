import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { WebhookService } from './webhook.service';

interface WebhookDeliveryJob {
  eventId: string;
  webhookId: string;
  payload: Record<string, unknown>;
  attemptNumber: number;
}

@Processor('webhooks')
@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Process webhook delivery job
   * Triggered by BullMQ queue when job is dequeued
   */
  @Process('deliver')
  async handleWebhookDelivery(job: Job<WebhookDeliveryJob>) {
    const { eventId, webhookId, payload, attemptNumber } = job.data;

    this.logger.log(
      `Processing webhook delivery job: eventId=${eventId}, attempt=${attemptNumber + 1}`,
    );

    try {
      const result = await this.webhookService.deliverWebhookPayload(
        eventId,
        webhookId,
        payload as any,
        attemptNumber,
      );

      if (result.success) {
        this.logger.log(`Webhook delivered successfully: eventId=${eventId}`);
        return {
          success: true,
          statusCode: result.statusCode,
          message: 'Webhook delivered',
        };
      }

      throw new Error(result.error || 'Unknown delivery error');
    } catch (err: any) {
      this.logger.error(
        `Webhook delivery failed for eventId=${eventId}, attempt=${attemptNumber + 1}`,
        err?.message ?? err,
      );

      // Re-throw so BullMQ knows to retry
      throw new Error(`Webhook delivery failed: ${err?.message ?? err}`);
    }
  }
}
