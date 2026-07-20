import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente de base de datos. La base es COMPARTIDA con MobilityManager: BackOffice
 * no la posee y no corre migraciones (prisma migrate / db push están prohibidos).
 * Las queries de negocio van por `$queryRaw` con control explícito de collation.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
