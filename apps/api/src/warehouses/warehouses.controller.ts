import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BackOfficeRole } from '../auth/backoffice-role.enum';
import { actorFrom, AuthedRequest } from '../common/actor';
import {
  AvailabilityRaw,
  CenterRestrictionRaw,
  CentersRawQuery,
  CustomerWriteRaw,
  GroupCustomersRawQuery,
  GroupWriteRaw,
  WarehouseKeyRaw,
  WarehousesRawQuery,
  WarehousesService,
} from './warehouses.service';
import {
  AddCustomerGroupResult,
  CentersResult,
  CustomerGroupOption,
  GroupCustomersResult,
  RemoveCustomerGroupResult,
  ReservedCustomer,
  ReservedCustomerGroup,
  WarehousesResult,
} from './warehouses.types';

/**
 * Identidad del logueado para resolver su alcance.
 *
 * El `guid` del JWT de BackOffice es el `Users.Guid` canónico del ecosistema (`sub` es su
 * alias), el mismo con el que MobilityManager pide `user-scope`: no hay traducción de
 * identidades en el medio.
 */
function managerGuid(req: AuthedRequest): string {
  const guid = req.user?.guid ?? req.user?.sub;
  if (!guid) throw new UnauthorizedException('Token sin identidad de usuario');
  return guid;
}

/**
 * API de Centros y Almacenes. Espejo de la de MobilityManager, con el alcance por sociedad
 * inyectado server-side y los roles de BackOffice. Consume el CRUD del MobilityMiddleWare,
 * dueño de `[SAPServices]`: acá no hay tablas propias.
 *
 * **`Usuario` está en el decorador a propósito, y es load-bearing.** La visibilidad del front
 * se resuelve por exclusión (`roleAccess.ts`): una sección nueva le queda visible sola salvo
 * que pida un rol deliberado. Si acá se declarara sólo `Administrador`, a `Usuario` se le
 * mostraría la sección y la API le respondería 403 — la pantalla visible y rota. Es la misma
 * decisión que ya tomó Regiones (`regions.controller.ts`). `SuperAdmin` pasa siempre por el
 * `RolesGuard` y no hace falta listarlo.
 *
 * **Las lecturas también van gateadas por el rol**, que es la diferencia con MobilityManager:
 * allá las consumían reportes externos, acá el único consumidor es esta UI.
 */
@Controller('api/warehouses')
@Roles(BackOfficeRole.Administrador, BackOfficeRole.Usuario)
@UseGuards(JwtGuard, RolesGuard)
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  // GET /api/warehouses/centers — centros del alcance (vista inicial)
  @Get('centers')
  async centers(
    @Query() query: CentersRawQuery,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true } & CentersResult> {
    const result = await this.warehouses.getCenters(managerGuid(req), query);
    return { success: true, ...result };
  }

  // GET /api/warehouses/customers?companyCode=&centerCode=&warehouseCode= — clientes reservados
  @Get('customers')
  async reservedCustomers(
    @Query() query: WarehouseKeyRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true; data: ReservedCustomer[] }> {
    const data = await this.warehouses.getReservedCustomers(managerGuid(req), query);
    return { success: true, data };
  }

  // GET /api/warehouses/customer-search?q= — buscador de clientes
  @Get('customer-search')
  async customerSearch(
    @Query('q') q?: string,
  ): Promise<{ success: true; data: ReservedCustomer[] }> {
    const data = await this.warehouses.searchCustomers(q ?? '');
    return { success: true, data };
  }

  // POST /api/warehouses/customers — reservar un almacén a un cliente (lo restringe)
  @Post('customers')
  async addCustomer(
    @Body() body: CustomerWriteRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true }> {
    await this.warehouses.addCustomer(managerGuid(req), body, actorFrom(req));
    return { success: true };
  }

  // DELETE /api/warehouses/customers — quitar un cliente
  @Delete('customers')
  async removeCustomer(
    @Query() query: CustomerWriteRaw,
    @Body() body: CustomerWriteRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true }> {
    await this.warehouses.removeCustomer(
      managerGuid(req),
      { ...query, ...body },
      actorFrom(req),
    );
    return { success: true };
  }

  // ---- Grupos de clientes de SAP (requiere MW ≥ 1.357.0) ----

  // GET /api/warehouses/groups?companyCode=&centerCode=&warehouseCode= — grupos reservados
  @Get('groups')
  async reservedGroups(
    @Query() query: WarehouseKeyRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true; data: ReservedCustomerGroup[] }> {
    const data = await this.warehouses.getReservedGroups(managerGuid(req), query);
    return { success: true, data };
  }

  // GET /api/warehouses/groups/customers?companyCode=&customerGroupCode=&page=&limit=&search=
  //
  // ORDEN LOAD-BEARING: va antes que `groups` sólo por claridad de lectura; Nest las
  // distingue por la cantidad de segmentos. Lo que sí importa es que ninguna ruta de este
  // controller use parámetros de path, para que nunca compitan.
  @Get('groups/customers')
  async groupCustomers(
    @Query() query: GroupCustomersRawQuery,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true } & GroupCustomersResult> {
    const result = await this.warehouses.getGroupCustomers(managerGuid(req), query);
    return { success: true, ...result };
  }

  // GET /api/warehouses/group-search?companyCode=&q=&limit= — buscador de grupos
  @Get('group-search')
  async groupSearch(
    @Query('companyCode') companyCode: string | undefined,
    @Query('q') q: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true; data: CustomerGroupOption[] }> {
    const data = await this.warehouses.searchCustomerGroups(managerGuid(req), {
      companyCode,
      q,
      limit,
    });
    return { success: true, data };
  }

  // POST /api/warehouses/groups — reservar un almacén a un grupo (lo restringe)
  @Post('groups')
  async addGroup(
    @Body() body: GroupWriteRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true; data: AddCustomerGroupResult }> {
    const data = await this.warehouses.addCustomerGroup(
      managerGuid(req),
      body,
      actorFrom(req),
    );
    return { success: true, data };
  }

  // DELETE /api/warehouses/groups — quitar un grupo (sin clientes ni grupos, el almacén queda libre)
  @Delete('groups')
  async removeGroup(
    @Query() query: GroupWriteRaw,
    @Body() body: GroupWriteRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true; data: RemoveCustomerGroupResult }> {
    const data = await this.warehouses.removeCustomerGroup(
      managerGuid(req),
      { ...query, ...body },
      actorFrom(req),
    );
    return { success: true, data };
  }

  // PUT /api/warehouses/availability — restringir / liberar un almacén
  @Put('availability')
  async setAvailability(
    @Body() body: AvailabilityRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true }> {
    await this.warehouses.setAvailability(managerGuid(req), body, actorFrom(req));
    return { success: true };
  }

  // PUT /api/warehouses/center-restriction — restringir / liberar un CENTRO entero
  @Put('center-restriction')
  async setCenterRestricted(
    @Body() body: CenterRestrictionRaw,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true }> {
    await this.warehouses.setCenterRestricted(managerGuid(req), body, actorFrom(req));
    return { success: true };
  }

  // GET /api/warehouses?companyCode=&centerCode=&onlyRestricted=&search= — almacenes de un centro
  @Get()
  async warehousesOfCenter(
    @Query() query: WarehousesRawQuery,
    @Req() req: AuthedRequest,
  ): Promise<{ success: true } & WarehousesResult> {
    const result = await this.warehouses.getWarehousesOfCenter(managerGuid(req), query);
    return { success: true, ...result };
  }
}
