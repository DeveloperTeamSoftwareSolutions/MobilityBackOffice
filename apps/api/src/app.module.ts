import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { RegionsModule } from './regions/regions.module';
import { AuthorizersModule } from './authorizers/authorizers.module';
import { SupportModule } from './support/support.module';
import { TemplatesModule } from './templates/templates.module';
import { RevisionSapModule } from './revision-sap/revision-sap.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ConsistencyModule } from './consistency/consistency.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    AuditModule,
    AuthModule,
    RegionsModule,
    AuthorizersModule,
    SupportModule,
    TemplatesModule,
    RevisionSapModule,
    WarehousesModule,
    ConsistencyModule,
    HealthModule,
  ],
})
export class AppModule {}
