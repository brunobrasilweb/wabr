import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WhatsappWebhook } from './webhook.entity';

export type WebhookEventStatus = 'pending' | 'sent' | 'delivered' | 'failed';

@Entity({ name: 'whatsapp_webhook_events' })
@Index(['webhookId', 'status'])
@Index(['messageId'])
@Index(['createdAt'])
export class WhatsappWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Reference to the webhook configuration
   */
  @Column({ type: 'uuid' })
  webhookId!: string;

  @ManyToOne(() => WhatsappWebhook, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'webhookId' })
  webhook?: WhatsappWebhook;

  /**
   * The WhatsApp message ID
   */
  @Column({ length: 64 })
  messageId!: string;

  /**
   * Sender phone number (from)
   */
  @Column({ length: 32 })
  from!: string;

  /**
   * Recipient phone number (to)
   */
  @Column({ length: 32 })
  to!: string;

  /**
   * Message type (text, image, audio, etc.)
   */
  @Column({ length: 32, default: 'text' })
  messageType!: string;

  /**
   * Message content or metadata
   */
  @Column({ type: 'text', nullable: true })
  content?: string | null;

  /**
   * Full payload sent to the webhook
   */
  @Column({ type: 'json' })
  payload!: Record<string, unknown>;

  /**
   * Current delivery status
   */
  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: WebhookEventStatus;

  /**
   * Number of attempts made to deliver this event
   */
  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  /**
   * HTTP status code returned by the webhook endpoint (if delivered)
   */
  @Column({ type: 'integer', nullable: true })
  httpStatus?: number | null;

  /**
   * Response received from the webhook endpoint
   */
  @Column({ type: 'text', nullable: true })
  response?: string | null;

  /**
   * Error message if delivery failed
   */
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /**
   * Next scheduled retry timestamp
   */
  @Column({ type: 'timestamp', nullable: true })
  nextRetryAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date | null;
}
