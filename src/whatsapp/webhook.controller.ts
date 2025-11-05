import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  Query,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookService } from './webhook.service';
import { TokenAuthGuard } from '../auth/token-auth.guard';
import { ClientsService } from '../clients/clients.service';

class RegisterWebhookDto {
  phone_number!: string;
  webhook_url!: string;
  max_retries?: number;
}

class UpdateWebhookDto {
  webhook_url?: string;
  is_active?: boolean;
  max_retries?: number;
}

@Controller('api/webhooks')
@UseGuards(TokenAuthGuard)
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly clientsService: ClientsService,
  ) {}

  /**
   * Extract client ID from request
   */
  private getClientId(req: Request & { user?: any }): number {
    const clientId = req?.user?.client?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client ID not found in request');
    }
    return clientId;
  }

  /**
   * Register or update a webhook for a WhatsApp connection
   * POST /api/webhooks/register
   */
  @Post('register')
  async registerWebhook(
    @Body() body: RegisterWebhookDto,
    @Req() req: Request & { user?: any },
  ) {
    try {
      const { phone_number, webhook_url, max_retries = 3 } = body;

      if (!phone_number || !webhook_url) {
        throw new BadRequestException('phone_number and webhook_url are required');
      }

      // Get client ID from request context (TokenAuthGuard sets it)
      const clientId = this.getClientId(req);

      const webhook = await this.webhookService.registerWebhook(
        clientId,
        phone_number,
        webhook_url,
        max_retries,
      );

      return {
        status: 'success',
        webhook: {
          id: webhook.id,
          client_id: webhook.clientId,
          phone_number: webhook.phoneNumber,
          webhook_url: webhook.webhookUrl,
          is_active: webhook.isActive,
          status: webhook.status,
          max_retries: webhook.maxRetries,
          created_at: webhook.createdAt.toISOString(),
          updated_at: webhook.updatedAt.toISOString(),
        },
      };
    } catch (err: any) {
      this.logger.error('registerWebhook error', err?.stack ?? err);
      if (err instanceof BadRequestException || err instanceof UnauthorizedException) {
        throw err;
      }
      if (err.message?.includes('Invalid webhook URL')) {
        throw new BadRequestException(err.message);
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to register webhook');
    }
  }

  /**
   * List all webhooks for the authenticated client
   * GET /api/webhooks/list
   */
  @Get('list')
  async listWebhooks(@Req() req: Request & { user?: any }) {
    try {
      const clientId = this.getClientId(req);

      const webhooks = await this.webhookService.listWebhooksByClient(clientId);

      return {
        status: 'success',
        count: webhooks.length,
        webhooks: webhooks.map((w) => ({
          id: w.id,
          client_id: w.clientId,
          phone_number: w.phoneNumber,
          webhook_url: w.webhookUrl,
          is_active: w.isActive,
          status: w.status,
          failure_count: w.failureCount,
          max_retries: w.maxRetries,
          last_error: w.lastError,
          last_success_at: w.lastSuccessAt?.toISOString(),
          last_attempt_at: w.lastAttemptAt?.toISOString(),
          created_at: w.createdAt.toISOString(),
          updated_at: w.updatedAt.toISOString(),
        })),
      };
    } catch (err: any) {
      this.logger.error('listWebhooks error', err?.stack ?? err);
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to list webhooks');
    }
  }

  /**
   * Get a specific webhook by ID
   * GET /api/webhooks/:webhook_id
   */
  @Get(':webhook_id')
  async getWebhook(
    @Param('webhook_id') webhookId: string,
    @Req() req: Request & { user?: any },
  ) {
    try {
      const clientId = this.getClientId(req);

      const webhook = await this.webhookService.getWebhook(webhookId);
      if (!webhook) {
        throw new NotFoundException('Webhook not found');
      }

      // Verify ownership
      if (webhook.clientId !== clientId) {
        throw new UnauthorizedException('You do not have access to this webhook');
      }

      return {
        status: 'success',
        webhook: {
          id: webhook.id,
          client_id: webhook.clientId,
          phone_number: webhook.phoneNumber,
          webhook_url: webhook.webhookUrl,
          is_active: webhook.isActive,
          status: webhook.status,
          failure_count: webhook.failureCount,
          max_retries: webhook.maxRetries,
          last_error: webhook.lastError,
          last_success_at: webhook.lastSuccessAt?.toISOString(),
          last_attempt_at: webhook.lastAttemptAt?.toISOString(),
          created_at: webhook.createdAt.toISOString(),
          updated_at: webhook.updatedAt.toISOString(),
        },
      };
    } catch (err: any) {
      this.logger.error('getWebhook error', err?.stack ?? err);
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to get webhook');
    }
  }

  /**
   * Update webhook configuration
   * PATCH /api/webhooks/:webhook_id
   */
  @Patch(':webhook_id')
  async updateWebhook(
    @Param('webhook_id') webhookId: string,
    @Body() body: UpdateWebhookDto,
    @Req() req: Request & { user?: any },
  ) {
    try {
      const clientId = this.getClientId(req);

      // Verify ownership first
      const webhook = await this.webhookService.getWebhook(webhookId);
      if (!webhook) {
        throw new NotFoundException('Webhook not found');
      }
      if (webhook.clientId !== clientId) {
        throw new UnauthorizedException('You do not have access to this webhook');
      }

      const updateData: any = {};
      if (body.webhook_url) updateData.webhookUrl = body.webhook_url;
      if (body.is_active !== undefined) updateData.isActive = body.is_active;
      if (body.max_retries) updateData.maxRetries = body.max_retries;

      const updated = await this.webhookService.updateWebhook(webhookId, updateData);

      return {
        status: 'success',
        webhook: {
          id: updated.id,
          client_id: updated.clientId,
          phone_number: updated.phoneNumber,
          webhook_url: updated.webhookUrl,
          is_active: updated.isActive,
          status: updated.status,
          max_retries: updated.maxRetries,
          created_at: updated.createdAt.toISOString(),
          updated_at: updated.updatedAt.toISOString(),
        },
      };
    } catch (err: any) {
      this.logger.error('updateWebhook error', err?.stack ?? err);
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      if (err.message?.includes('Invalid webhook URL')) {
        throw new BadRequestException(err.message);
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to update webhook');
    }
  }

  /**
   * Delete a webhook
   * DELETE /api/webhooks/:webhook_id
   */
  @Delete(':webhook_id')
  async deleteWebhook(
    @Param('webhook_id') webhookId: string,
    @Req() req: Request & { user?: any },
  ) {
    try {
      const clientId = this.getClientId(req);

      // Verify ownership first
      const webhook = await this.webhookService.getWebhook(webhookId);
      if (!webhook) {
        throw new NotFoundException('Webhook not found');
      }
      if (webhook.clientId !== clientId) {
        throw new UnauthorizedException('You do not have access to this webhook');
      }

      await this.webhookService.deleteWebhook(webhookId);

      return {
        status: 'success',
        message: 'Webhook deleted successfully',
      };
    } catch (err: any) {
      this.logger.error('deleteWebhook error', err?.stack ?? err);
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to delete webhook');
    }
  }

  /**
   * Get delivery events for a webhook
   * GET /api/webhooks/:webhook_id/events
   */
  @Get(':webhook_id/events')
  async getWebhookEvents(
    @Param('webhook_id') webhookId: string,
    @Query('limit') limit: string = '50',
    @Query('offset') offset: string = '0',
    @Req() req: Request & { user?: any },
  ) {
    try {
      const clientId = this.getClientId(req);

      // Verify ownership
      const webhook = await this.webhookService.getWebhook(webhookId);
      if (!webhook) {
        throw new NotFoundException('Webhook not found');
      }
      if (webhook.clientId !== clientId) {
        throw new UnauthorizedException('You do not have access to this webhook');
      }

      const limitNum = Math.min(parseInt(limit, 10) || 50, 100); // Max 100
      const offsetNum = parseInt(offset, 10) || 0;

      const { events, total } = await this.webhookService.getWebhookEvents(
        webhookId,
        limitNum,
        offsetNum,
      );

      return {
        status: 'success',
        total,
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          webhook_id: e.webhookId,
          message_id: e.messageId,
          from: e.from,
          to: e.to,
          message_type: e.messageType,
          content: e.content,
          status: e.status,
          attempt_count: e.attemptCount,
          http_status: e.httpStatus,
          error: e.error,
          response: e.response,
          next_retry_at: e.nextRetryAt?.toISOString(),
          created_at: e.createdAt.toISOString(),
          delivered_at: e.deliveredAt?.toISOString(),
        })),
      };
    } catch (err: any) {
      this.logger.error('getWebhookEvents error', err?.stack ?? err);
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to get webhook events');
    }
  }

  /**
   * Retry a failed webhook event
   * POST /api/webhooks/events/:event_id/retry
   */
  @Post('events/:event_id/retry')
  async retryWebhookEvent(
    @Param('event_id') eventId: string,
    @Req() req: Request & { user?: any },
  ) {
    try {
      const clientId = this.getClientId(req);

      // For now, we assume eventId belongs to client's webhook
      // In production, you'd verify this through webhook ownership
      const event = await this.webhookService['eventRepo'].findOne({
        where: { id: eventId },
        relations: ['webhook'],
      });

      if (!event) {
        throw new NotFoundException('Event not found');
      }

      // Verify webhook ownership
      const webhook = await this.webhookService.getWebhook(event.webhookId);
      if (!webhook || webhook.clientId !== clientId) {
        throw new UnauthorizedException('You do not have access to this event');
      }

      const retried = await this.webhookService.retryWebhookEvent(eventId);

      return {
        status: 'success',
        message: 'Event requeued for delivery',
        event: {
          id: retried.id,
          status: retried.status,
          attempt_count: retried.attemptCount,
        },
      };
    } catch (err: any) {
      this.logger.error('retryWebhookEvent error', err?.stack ?? err);
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      throw new InternalServerErrorException(err?.message ?? 'Failed to retry event');
    }
  }
}
