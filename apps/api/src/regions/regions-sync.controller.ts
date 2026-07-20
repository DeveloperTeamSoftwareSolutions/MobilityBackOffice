import { Controller, Post, Body, Headers, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { RegionsService } from './regions.service';
import { SyncPayload } from './regions.types';

/**
 * Web service de sync de Regiones (segunda vía de carga, obligatoria). Recibe el
 * estado deseado (regiones + sus CEBEs) y reconcilia altas/bajas de forma idempotente.
 * Autenticado por `x-api-key` (`ApiKeyGuard`), pensado para alimentarse desde SAP.
 */
@Controller('api/regions/sync')
@UseGuards(ApiKeyGuard)
export class RegionsSyncController {
  constructor(private readonly regions: RegionsService) {}

  // POST /api/regions/sync — reconcilia el batch (x-api-key)
  @Post()
  async sync(@Body() body: SyncPayload, @Headers('x-actor') actorHeader?: string) {
    const actor = (actorHeader || '').trim() || 'sap-sync';
    const result = await this.regions.sync(body, actor);
    return { success: true, ...result };
  }
}
