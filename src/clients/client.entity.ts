import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ClientStatus = 'active' | 'inactive' | 'revoked';

@Entity({ name: 'clients' })
export class Client {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ length: 120 })
  name!: string;

  // Token stored as string, unique index recommended in production
  @Column({ length: 256, unique: true })
  token!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: ClientStatus;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
