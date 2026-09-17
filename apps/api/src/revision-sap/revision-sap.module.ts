import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { RevisionSapController } from './revision-sap.controller';
import { RevisionSapService } from './revision-sap.service';
import { RevisionSapClient } from './revision-sap.client';

/**
 * Órdenes rechazadas por SAP: bandeja, detalle sin precios, centros y destinos, y el
 * cambio de destino por ítem. El reenvío a SAP todavía no está conectado.
 * Ver docs/SPEC_REVISION_ORDENES_SAP.md.
 */
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [RevisionSapController],
  providers: [RevisionSapService, RevisionSapClient],
})
export class RevisionSapModule {}
