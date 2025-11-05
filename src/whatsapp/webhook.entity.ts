import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type WebhookStatus = 'active' | 'inactive' | 'failed';

@Entity({ name: 'whatsapp_webhooks' })
@Index(['clientId', 'phoneNumber'], { unique: true })
@Index(['clientId', 'isActive'])
export class WhatsappWebhook {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Reference to the client (not a foreign key to allow flexibility with ClientsModule)
   */
  @Column({ type: 'integer' })
  clientId!: number;

  /**
   * Phone number associated with the WhatsApp connection
   * Format: e.g., "5511999999999" or stored as they come from Baileys
   */
  @Column({ length: 32 })
  phoneNumber!: string;

  /**
   * The webhook endpoint URL where messages will be sent
   * Must be HTTPS in production
   */
  @Column({ type: 'text' })
  webhookUrl!: string;

  /**
   * Whether this webhook is currently active
   */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /**
   * Current status of the webhook: active, inactive, or failed
   */
  @Column({ type: 'varchar', length: 24, default: 'active' })
  status!: WebhookStatus;

  /**
   * Number of failed delivery attempts for the last message
   */
  @Column({ type: 'integer', default: 0 })
  failureCount!: number;

  /**
   * Maximum number of retry attempts before marking as failed
   */
  @Column({ type: 'integer', default: 3 })
  maxRetries!: number;

  /**
   * Last error message encountered during delivery
   */
  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  /**
   * Timestamp of the last successful delivery
   */
  @Column({ type: 'timestamp', nullable: true })
  lastSuccessAt?: Date | null;

  /**
   * Timestamp of the last delivery attempt (success or failure)
   */
  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt?: Date | null;

  /**
   * Optional metadata for storing additional configuration
   */
  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
