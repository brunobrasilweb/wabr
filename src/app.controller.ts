import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { TokenAuthGuard } from './auth/token-auth.guard';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'Hello World!';
  }

  @Get('health')
  getHealth() {
    return { status: 'ok' };
  }

  // exemplo de rota protegida — retorna o client autenticado
  @UseGuards(TokenAuthGuard)
  @Get('me')
  getMe(@Req() req: any) {
    const client = req.user?.client;
    return {
      id: client?.id,
      name: client?.name,
      status: client?.status,
    };
  }
}
