import { Controller, Get } from '@nestjs/common';
import { APP_NAME, APP_VERSION } from '../version';

@Controller('api/health')
export class HealthController {
  @Get()
  check(): {
    success: boolean;
    name: string;
    version: string;
    status: string;
  } {
    return {
      success: true,
      name: APP_NAME,
      version: APP_VERSION,
      status: 'ok',
    };
  }
}
