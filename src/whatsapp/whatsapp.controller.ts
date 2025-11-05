import { Body, Controller, Get, Param, Post, UseGuards, Logger, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { TokenAuthGuard } from '../auth/token-auth.guard';

class ConnectDto {
  user_id!: string;
  phone_number!: string;
}

class DisconnectDto {
  user_id!: string;
}

@Controller('api/whatsapp')
@UseGuards(TokenAuthGuard)
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);
  constructor(private readonly svc: WhatsappService) {}

  @Post('connect')
  async connect(@Body() body: ConnectDto) {
    const { user_id, phone_number } = body as any;
    if (!user_id || !phone_number) {
      return { statusCode: 400, message: 'Invalid params' };
    }

    try {
      const { connection, qr } = await this.svc.createConnection(user_id, phone_number);
      return { status: connection.sessionStatus === 'connected' ? 'connected' : 'reconnecting', qr_code: qr, session_id: connection.id };
    } catch (err: any) {
      this.logger.error('connect error', err?.stack ?? err);
      if (err.code === 'SESSION_EXISTS') {
        throw new BadRequestException('Sessão já existente');
      }
      throw new InternalServerErrorException(err?.message ?? 'Internal error');
    }
  }

  @Post('disconnect')
  async disconnect(@Body() body: DisconnectDto) {
    const { user_id } = body as any;
    if (!user_id) return { statusCode: 400, message: 'Invalid params' };

    try {
      const conn = await this.svc.disconnect(user_id);
      return { status: 'disconnected', session_id: conn.id };
    } catch (err: any) {
      this.logger.error('disconnect error', err?.stack ?? err);
      if (err.code === 'NOT_FOUND') throw new NotFoundException('Sessão inexistente');
      throw new InternalServerErrorException(err?.message ?? 'Internal error');
    }
  }

  @Get('status/:user_id')
  async status(@Param('user_id') userId: string) {
    try {
      const st = await this.svc.status(userId);
      return { status: st.status, last_update: st.lastUpdate.toISOString() };
    } catch (err: any) {
      this.logger.error('status error', err?.stack ?? err);
      if (err.code === 'NOT_FOUND') throw new NotFoundException('Sessão inexistente');
      throw new InternalServerErrorException(err?.message ?? 'Internal error');
    }
  }
}
