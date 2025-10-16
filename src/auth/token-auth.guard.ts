import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ClientsService } from '../clients/clients.service';

@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(private readonly clientsService: ClientsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const auth = req.headers?.authorization as string | undefined;
    if (!auth) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Invalid Authorization format');
    }

    const token = parts[1];
    const client = await this.clientsService.findByToken(token);
    if (!client) {
      throw new UnauthorizedException('Invalid token');
    }

    if (client.status !== 'active') {
      throw new UnauthorizedException('Client inactive');
    }

    // attach to request for controllers to use
    req.user = { client };
    return true;
  }
}
