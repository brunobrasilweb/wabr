import { Processor, Process } from '@nestjs/bull';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bull';
import { MessagesService } from './messages.service';
import { BaileysManager } from '../whatsapp/baileys.manager';
import { MessageType, MessageStatus } from './message.entity';

@Processor('messages')
export class MessagesProcessor {
  private readonly logger = new Logger(MessagesProcessor.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly baileysManager: BaileysManager,
  ) {}

  /**
   * Process outbound message sending
   */
  @Process('send')
  async processSendMessage(job: Job<any>): Promise<void> {
    const { messageId, recipient, type, content, userId, correlationId } = job.data;
    const id = correlationId;

    try {
      this.logger.log(`[${id}] Processing send job for message ${messageId} (userId=${userId})`);

      // Format recipient JID
      const jid = this.formatJID(recipient);

      // Send via BaileysManager using userId so the correct socket is chosen
      let whatsappMessageId: string | undefined;
      try {
        const res = await this.baileysManager.sendMessage(userId, jid, type, content);
        if (res && res.ok && (res.id || res.id === '')) {
          whatsappMessageId = res.id;
        }
        if (res && !res.ok) {
          throw new Error(`BaileysManager error: ${res.error || 'unknown'}`);
        }
      } catch (err) {
        this.logger.error(`[${id}] Error sending via BaileysManager: ${(err as any)?.message}`);
        // mark message as failed
        await this.messagesService.markAsFailed(messageId, (err as any)?.message || 'Baileys send error');
        throw err;
      }

      // Update with WhatsApp message ID and set status to SENT/DELIVERED
      if (whatsappMessageId) {
        await this.messagesService.updateMessageStatus(messageId, MessageStatus.SENT, whatsappMessageId);
        // Optionally mark as delivered as in older flow
        await this.messagesService.updateMessageStatus(messageId, MessageStatus.DELIVERED, whatsappMessageId);
      } else {
        // If no id, still mark as failed
        await this.messagesService.markAsFailed(messageId, 'no-whatsapp-id-returned');
        throw new Error('no-whatsapp-id-returned');
      }

      this.logger.log(`[${id}] Message sent successfully: ${messageId}`);
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error sending message: ${err?.message}`, err?.stack);
      // let bull retry according to job attempts
      throw error;
    }
  }

  /**
   * Process inbound message receipt
   */
  @Process('receive')
  async processReceiveMessage(job: Job<any>): Promise<void> {
    const { messageId, from, type, content, correlationId } = job.data;
    const id = correlationId;

    try {
      this.logger.log(`[${id}] Processing receive job for message ${messageId}`);

      // Here you can add custom logic for processing received messages
      // For example: webhook integration, CRM sync, bot responses, etc.

      this.logger.log(`[${id}] Inbound message processed: ${messageId}`);
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error processing inbound message: ${err?.message}`, err?.stack);
      throw error;
    }
  }

  /**
   * Process message deletion
   */
  @Process('delete')
  async processDeleteMessage(job: Job<any>): Promise<void> {
    const { messageId, whatsappMessageId, correlationId } = job.data;
    const id = correlationId;

    try {
      this.logger.log(`[${id}] Processing delete job for message ${messageId}`);

      // Delete from WhatsApp if possible
      if (whatsappMessageId) {
        await this.deleteFromWhatsApp(whatsappMessageId, id);
      }

      this.logger.log(`[${id}] Message deletion processed: ${messageId}`);
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${id}] Error deleting message: ${err?.message}`, err?.stack);
      throw error;
    }
  }

  /**
   * Send message via WhatsApp through Baileys
   */
  private async sendViaWhatsApp(
    recipient: string,
    type: MessageType,
    content: any,
    correlationId: string,
  ): Promise<string | undefined> {
    const id = correlationId;

    try {
      this.logger.debug(`[${id}] Sending ${type} message to ${recipient}`);

      // Format recipient JID
      const jid = this.formatJID(recipient);

      // For now, use text message as default
      // In a full implementation, you would use the actual Baileys socket
      // from BaileysManager to send different message types
      if (type === MessageType.TEXT) {
        // This is a simplified implementation
        // In production, get the socket from BaileysManager via a new public method
        this.logger.debug(`[${id}] Message type: ${type}, content: ${content.text}`);
      }

      // Generate a mock WhatsApp message ID (in production, this comes from Baileys)
      const mockWhatsappMessageId = `wamsgid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.logger.debug(`[${id}] Message sent via WhatsApp, ID: ${mockWhatsappMessageId}`);

      return mockWhatsappMessageId;
    } catch (error) {
      const err = error as any;
      this.logger.error(
        `[${id}] Error sending via WhatsApp: ${err?.message}`,
        err?.stack,
      );
      throw error;
    }
  }

  /**
   * Delete message from WhatsApp
   */
  private async deleteFromWhatsApp(whatsappMessageId: string, correlationId: string): Promise<void> {
    const id = correlationId;

    try {
      this.logger.debug(`[${id}] Deleting message from WhatsApp: ${whatsappMessageId}`);

      // In a full implementation, get the socket from BaileysManager
      // and call the delete method on it
      
      this.logger.debug(`[${id}] Message deletion from WhatsApp attempted`);
    } catch (error) {
      const err = error as any;
      this.logger.warn(
        `[${id}] Could not delete message from WhatsApp: ${err?.message}`,
      );
      // Don't throw - deletion from WhatsApp is best-effort
    }
  }

  /**
   * Build WhatsApp message object based on type
   */
  private buildWhatsAppMessage(type: MessageType, content: any): any {
    switch (type) {
      case MessageType.TEXT:
        return {
          text: content.text || '',
        };

      case MessageType.IMAGE:
        return {
          image: { url: content.mediaUrl },
          caption: content.caption || undefined,
        };

      case MessageType.VIDEO:
        return {
          video: { url: content.mediaUrl },
          caption: content.caption || undefined,
        };

      case MessageType.AUDIO:
        return {
          audio: { url: content.mediaUrl },
          mimetype: 'audio/ogg; codecs=opus',
        };

      case MessageType.DOCUMENT:
        return {
          document: { url: content.mediaUrl },
          fileName: content.caption || 'document',
          mimetype: 'application/pdf',
        };

      case MessageType.LOCATION:
        return {
          location: {
            degreesLatitude: content.latitude || 0,
            degreesLongitude: content.longitude || 0,
          },
        };

      case MessageType.CONTACT:
        return {
          contacts: {
            displayName: content.name || 'Contact',
            contacts: [
              {
                displayName: content.name || 'Contact',
                vcard: this.buildVCard(content.name, content.phone),
              },
            ],
          },
        };

      case MessageType.STICKER:
        return {
          sticker: { url: content.mediaUrl },
        };

      default:
        return {
          text: content.text || '',
        };
    }
  }

  /**
   * Build vCard for contact
   */
  private buildVCard(name: string, phone: string): string {
    return `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL:${phone}
END:VCARD`;
  }

  /**
   * Format phone number to JID format for WhatsApp
   */
  private formatJID(phone: string): string {
    // Remove any non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as WhatsApp JID (number@s.whatsapp.net)
    return `${cleaned}@s.whatsapp.net`;
  }
}
