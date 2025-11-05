import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type WhatsappSessionStatus = 'connected' | 'disconnected' | 'reconnecting';

@Entity({ name: 'whatsapp_connections' })
export class WhatsappConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

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
