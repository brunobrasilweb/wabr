import { IsString, IsEnum, IsOptional, IsUrl, IsNumber, Matches } from 'class-validator';
import { MessageType } from './message.entity';

export class SendMessageDto {
  @IsString()
  @IsOptional()
  // Baileys session identifier (userId). When provided, used to select the exact WhatsApp session.
  userId?: string;
  @IsString()
  @Matches(/^\d{10,}$/, { message: 'Recipient must be a valid international phone number' })
  recipient!: string;

  @IsEnum(MessageType)
  type!: MessageType;

  @IsString()
  text?: string;

  @IsUrl()
  @IsOptional()
  mediaUrl?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}

export class ReceiveMessageDto {
  @IsString()
  @Matches(/^\d{10,}$/, { message: 'From must be a valid international phone number' })
  from!: string;

  @IsString()
  messageId!: string;

  @IsEnum(MessageType)
  type!: MessageType;

  @IsString()
  @IsOptional()
  text?: string;

  @IsUrl()
  @IsOptional()
  mediaUrl?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  timestamp?: Date;
}

export class ForwardMessageDto {
  @IsString()
  messageId!: string;

  @IsString({ each: true })
  @Matches(/^\d{10,}$/, { each: true, message: 'Each recipient must be a valid international phone number' })
  recipients!: string[];
}

export class MessageResponseDto {
  messageId!: string;
  status!: string;
  timestamp?: Date;
  forwardedTo?: string[];
}
