import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { v4 as uuidv4 } from 'uuid';
import { Message, MessageStatus, MessageType } from './message.entity';
import { SendMessageDto, ReceiveMessageDto, ForwardMessageDto } from './messages.dto';
import { BaileysManager } from '../whatsapp/baileys.manager';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectQueue('messages')
    private readonly messagesQueue: Queue,
    private readonly baileysManager: BaileysManager,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Send a new message to a recipient
   */
  async sendMessage(
    dto: SendMessageDto,
    clientId: string,
    correlationId?: string,
  ): Promise<{ messageId: string; status: string; timestamp: Date }> {
    const id = correlationId || uuidv4();
    
    try {
      this.logger.log(`[${id}] Starting sendMessage to ${dto.recipient}`, {
        clientId,
        type: dto.type,
      });

      // Validate recipient
      if (!this.isValidPhoneNumber(dto.recipient)) {
        throw new BadRequestException('Invalid recipient phone number format');
      }

      // Resolve WhatsApp session: prefer explicit dto.userId (Baileys session id) when provided
      let connection = null as any;
      if ((dto as any).userId) {
        connection = await this.whatsappService.getConnectionByUserId((dto as any).userId);
      } else {
        const clientIdNum = clientId != null ? Number(clientId) : null;
        connection = await this.whatsappService.getConnectionByClientId(clientIdNum as any);
      }

      if (!connection) {
        throw new BadRequestException('Nenhuma sessão do WhatsApp encontrada para o user_id fornecido ou para este tenant (clientId)');
      }

      // Create message entity using the session phone number as `from`
      const message = this.messageRepository.create({
        messageId: uuidv4(),
        from: connection.phoneNumber || connection.userId, // prefer actual phone number
        to: dto.recipient,
        type: dto.type,
        content: this.buildContent(dto),
        status: MessageStatus.PENDING,
        correlationId: id,
      });

      // Save to database
      const savedMessage = await this.messageRepository.save(message);
      this.logger.debug(`[${id}] Message saved to database with ID: ${savedMessage.id}`);

      // Queue for async processing
      await this.messagesQueue.add(
        'send',
        {
          messageId: savedMessage.id,
          dbMessageId: savedMessage.id,
          recipient: dto.recipient,
          type: dto.type,
          content: dto,
          // pass userId (Baileys session identifier) so processor can pick the correct socket
          userId: connection.userId,
          correlationId: id,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log(`[${id}] Message queued for sending: ${savedMessage.messageId}`);

      return {
        messageId: savedMessage.messageId,
        status: MessageStatus.PENDING,
        timestamp: savedMessage.createdAt,
      };
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error in sendMessage: ${err?.message}`, err?.stack);
      throw error;
    }
  }

  /**
   * Receive a message from WhatsApp webhook
   */
  async receiveMessage(
    dto: ReceiveMessageDto,
    correlationId?: string,
  ): Promise<{ status: string; processed: boolean }> {
    const id = correlationId || uuidv4();

    try {
      this.logger.log(`[${id}] Receiving message from ${dto.from}`, {
        messageId: dto.messageId,
        type: dto.type,
      });

      // Check for duplicate
      const existing = await this.messageRepository.findOne({
        where: { messageId: dto.messageId },
      });

      if (existing) {
        this.logger.warn(`[${id}] Duplicate message detected: ${dto.messageId}`);
        return { status: 'duplicated', processed: false };
      }

      // Create message entity
      const message = this.messageRepository.create({
        messageId: dto.messageId,
        from: dto.from,
        to: 'system', // Will be the WhatsApp number
        type: dto.type,
        content: {
          text: dto.text,
          mediaUrl: dto.mediaUrl,
          caption: dto.caption,
        },
        status: MessageStatus.DELIVERED,
        correlationId: id,
        deliveredAt: dto.timestamp || new Date(),
      });

      const savedMessage = await this.messageRepository.save(message);
      this.logger.debug(`[${id}] Inbound message saved: ${savedMessage.id}`);

      // Queue for async processing
      await this.messagesQueue.add(
        'receive',
        {
          messageId: savedMessage.id,
          from: dto.from,
          type: dto.type,
          content: dto,
          correlationId: id,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log(`[${id}] Message queued for processing`);

      return { status: 'received', processed: true };
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error in receiveMessage: ${err?.message}`, err?.stack);
      throw error;
    }
  }

  /**
   * Get message by ID
   */
  async getMessageById(messageId: string): Promise<Message> {
    const message = await this.messageRepository.findOne({
      where: { messageId },
      relations: ['connection'],
    });

    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    return message;
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string, correlationId?: string): Promise<{ messageId: string; status: string }> {
    const id = correlationId || uuidv4();

    try {
      this.logger.log(`[${id}] Deleting message: ${messageId}`);

      const message = await this.messageRepository.findOne({
        where: { messageId },
      });

      if (!message) {
        throw new NotFoundException(`Message ${messageId} not found`);
      }

      // Only outbound messages that were actually sent to WhatsApp (have whatsappMessageId)
      if (!message.whatsappMessageId) {
        throw new ForbiddenException('Only outbound messages can be deleted');
      }

      // Update status
      message.status = MessageStatus.DELETED;
      await this.messageRepository.save(message);

      // Try to delete from WhatsApp if within deletion window
      if (message.whatsappMessageId && message.sentAt) {
        const hoursElapsed = (Date.now() - message.sentAt.getTime()) / (1000 * 60 * 60);
        if (hoursElapsed < 4) {
          // WhatsApp allows deletion within ~4 hours
          await this.messagesQueue.add(
            'delete',
            {
              messageId: message.id,
              whatsappMessageId: message.whatsappMessageId,
              correlationId: id,
            },
            { attempts: 2, backoff: { type: 'exponential', delay: 1000 } },
          );
        }
      }

      this.logger.log(`[${id}] Message deleted: ${messageId}`);

      return {
        messageId,
        status: message.whatsappMessageId ? 'deleted' : 'partially_deleted',
      };
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error in deleteMessage: ${err?.message}`, err?.stack);
      throw error;
    }
  }

  /**
   * Forward a message to multiple recipients
   */
  async forwardMessage(
    dto: ForwardMessageDto,
    clientId: string,
    correlationId?: string,
  ): Promise<{ forwardedTo: string[]; status: string }> {
    const id = correlationId || uuidv4();

    try {
      this.logger.log(`[${id}] Forwarding message to ${dto.recipients.length} recipients`, {
        messageId: dto.messageId,
        clientId,
      });

      // Get original message
      const originalMessage = await this.messageRepository.findOne({
        where: { messageId: dto.messageId },
      });

      if (!originalMessage) {
        throw new NotFoundException(`Message ${dto.messageId} not found`);
      }

      // Validate all recipients
      for (const recipient of dto.recipients) {
        if (!this.isValidPhoneNumber(recipient)) {
          throw new BadRequestException(`Invalid recipient: ${recipient}`);
        }
      }

      // resolve connection for tenant
      const clientIdNum = clientId != null ? Number(clientId) : null;
      const connection = await this.whatsappService.getConnectionByClientId(clientIdNum as any);
      if (!connection) {
        throw new BadRequestException('Nenhuma sessão do WhatsApp encontrada para este tenant (clientId)');
      }

      const forwardedMessages = [];

      // Create message for each recipient
      for (const recipient of dto.recipients) {
        const message = this.messageRepository.create({
          messageId: uuidv4(),
          from: connection.phoneNumber || connection.userId,
          to: recipient,
          type: originalMessage.type,
          content: {
            ...originalMessage.content,
            caption: `[Forwarded] ${originalMessage.content.caption || ''}`.trim(),
          },
          status: MessageStatus.PENDING,
          correlationId: id,
        });

        const savedMessage = await this.messageRepository.save(message);
        forwardedMessages.push(savedMessage);

        // Queue for sending
        await this.messagesQueue.add(
          'send',
          {
            messageId: savedMessage.id,
            recipient,
            type: originalMessage.type,
            content: originalMessage.content,
            userId: connection.userId,
            correlationId: id,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
      }

      this.logger.log(`[${id}] Message forwarded to ${forwardedMessages.length} recipients`);

      return {
        forwardedTo: dto.recipients,
        status: 'success',
      };
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error in forwardMessage: ${err?.message}`, err?.stack);
      throw error;
    }
  }

  /**
   * Update message status (internal use)
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    whatsappMessageId?: string,
  ): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (message) {
      message.status = status;
      if (whatsappMessageId) {
        message.whatsappMessageId = whatsappMessageId;
      }
      if (status === MessageStatus.SENT) {
        message.sentAt = new Date();
      } else if (status === MessageStatus.DELIVERED) {
        message.deliveredAt = new Date();
      } else if (status === MessageStatus.READ) {
        message.readAt = new Date();
      }
      await this.messageRepository.save(message);
    }
  }

  /**
   * Mark message as failed
   */
  async markAsFailed(messageId: string, error: string): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (message) {
      message.status = MessageStatus.FAILED;
      message.errorMessage = error;
      await this.messageRepository.save(message);
    }
  }

  /**
   * Helper: validate phone number format
   */
  private isValidPhoneNumber(phone: string): boolean {
    return /^\d{10,}$/.test(phone);
  }

  /**
   * Helper: build content object from DTO
   */
  private buildContent(dto: SendMessageDto): any {
    return {
      text: dto.text,
      mediaUrl: dto.mediaUrl,
      caption: dto.caption,
      latitude: dto.latitude,
      longitude: dto.longitude,
      name: dto.name,
      phone: dto.phone,
    };
  }

  /**
   * Get message history for a client
   */
  async getMessageHistory(
    clientId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ messages: Message[]; total: number }> {
    const [messages, total] = await this.messageRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { messages, total };
  }
}
