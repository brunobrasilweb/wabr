import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Logger,
  HttpStatus,
  HttpCode,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { SendMessageDto, ReceiveMessageDto, ForwardMessageDto, MessageResponseDto } from './messages.dto';
import { TokenAuthGuard } from '../auth/token-auth.guard';
import { Message } from './message.entity';
import { v4 as uuidv4 } from 'uuid';

@ApiTags('Messages')
@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(private readonly messagesService: MessagesService) {}

  /**
   * Send a new message
   */
  @Post('send')
  @UseGuards(TokenAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Send a new message',
    description: 'Envia uma nova mensagem para um destinatário via WhatsApp',
  })
  @ApiResponse({
    status: 202,
    description: 'Message queued for sending',
    schema: {
      example: {
        messageId: 'abc123',
        status: 'pending',
        timestamp: '2025-11-05T18:00:00Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Media error' })
  async sendMessage(
    @Body() dto: SendMessageDto,
    @Req() req: any,
  ): Promise<MessageResponseDto> {
    const correlationId = uuidv4();
    this.logger.log(`[${correlationId}] POST /api/messages/send`);

    try {
      const clientId = req.user?.client?.id;
      const result = await this.messagesService.sendMessage(dto, clientId, correlationId);
      return result as MessageResponseDto;
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${correlationId}] sendMessage error: ${err?.message}`);
      throw error;
    }
  }

  /**
   * Receive a message from webhook
   */
  @Post('receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a message from WhatsApp',
    description: 'Processa mensagens recebidas via webhook do WhatsApp',
  })
  @ApiResponse({
    status: 200,
    description: 'Message received and queued',
    schema: {
      example: {
        status: 'received',
        processed: true,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async receiveMessage(
    @Body() dto: ReceiveMessageDto,
  ): Promise<{ status: string; processed: boolean }> {
    const correlationId = uuidv4();
    this.logger.log(`[${correlationId}] POST /api/messages/receive from ${dto.from}`);

    try {
      const result = await this.messagesService.receiveMessage(dto, correlationId);
      return result;
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${correlationId}] receiveMessage error: ${err?.message}`);
      throw error;
    }
  }

  /**
   * Get message by ID
   */
  @Get(':id')
  @UseGuards(TokenAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get message details',
    description: 'Retorna detalhes de uma mensagem previamente enviada ou recebida',
  })
  @ApiResponse({
    status: 200,
    description: 'Message details',
    schema: {
      example: {
        messageId: 'abc123',
        from: '5511999999999',
        to: '5511988888888',
        type: 'text',
        content: {
          text: 'Olá, tudo bem?',
        },
        status: 'delivered',
        timestamp: '2025-11-05T18:00:00Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMessage(
    @Param('id') messageId: string,
  ): Promise<Message> {
    const correlationId = uuidv4();
    this.logger.log(`[${correlationId}] GET /api/messages/${messageId}`);

    try {
      return await this.messagesService.getMessageById(messageId);
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${correlationId}] getMessage error: ${err?.message}`);
      throw error;
    }
  }

  /**
   * Delete a message
   */
  @Delete(':id')
  @UseGuards(TokenAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a message',
    description: 'Exclui uma mensagem do histórico local e, quando possível, do WhatsApp',
  })
  @ApiResponse({
    status: 200,
    description: 'Message deleted',
    schema: {
      example: {
        messageId: 'abc123',
        status: 'deleted',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Cannot delete received messages' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteMessage(
    @Param('id') messageId: string,
  ): Promise<{ messageId: string; status: string }> {
    const correlationId = uuidv4();
    this.logger.log(`[${correlationId}] DELETE /api/messages/${messageId}`);

    try {
      return await this.messagesService.deleteMessage(messageId, correlationId);
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${correlationId}] deleteMessage error: ${err?.message}`);
      throw error;
    }
  }

  /**
   * Forward a message to multiple recipients
   */
  @Post('forward')
  @UseGuards(TokenAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Forward a message',
    description: 'Encaminha uma mensagem existente para um ou mais destinatários',
  })
  @ApiResponse({
    status: 200,
    description: 'Message forwarded',
    schema: {
      example: {
        forwardedTo: ['5511977777777', '5511966666666'],
        status: 'success',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async forwardMessage(
    @Body() dto: ForwardMessageDto,
    @Req() req: any,
  ): Promise<{ forwardedTo: string[]; status: string }> {
    const correlationId = uuidv4();
    this.logger.log(`[${correlationId}] POST /api/messages/forward`);

    try {
      const clientId = req.user?.client?.id;
      return await this.messagesService.forwardMessage(dto, clientId, correlationId);
    } catch (error) {
      const err = error as any;
      this.logger.error(`[${correlationId}] forwardMessage error: ${err?.message}`);
      throw error;
    }
  }
}
