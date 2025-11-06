import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WhatsappConnection } from '../whatsapp/whatsapp.entity';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  STICKER = 'sticker',
  LOCATION = 'location',
  CONTACT = 'contact',
}

export enum MessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
  DELETED = 'deleted',
}

@Entity('messages')
@Index(['messageId'], { unique: true })
@Index(['from', 'createdAt'])
@Index(['to', 'createdAt'])
@Index(['status'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  messageId!: string;

  @Column({ type: 'varchar' })
  from!: string;

  @Column({ type: 'varchar' })
  to!: string;

  @Column({ type: 'enum', enum: MessageType })
  type!: MessageType;

  @Column({ type: 'jsonb' })
  content!: {
    text?: string;
    mediaUrl?: string;
    caption?: string;
    latitude?: number;
    longitude?: number;
    name?: string;
    phone?: string;
  };

  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.PENDING })
  status: MessageStatus = MessageStatus.PENDING;

  @Column({ type: 'varchar', nullable: true })
  whatsappMessageId?: string;

  @Column({ type: 'varchar', nullable: true })
  correlationId?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date;

  @ManyToOne(() => WhatsappConnection, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'connectionId' })
  connection?: WhatsappConnection;

  @Column({ type: 'uuid', nullable: true })
  connectionId?: string;
}
