import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { httpStatus, middlewareErrorCode } from '../common/middleware-error';
import {
  AddCustomerGroupResult,
  CustomerGroupOption,
  GroupCustomer,
  RemoveCustomerGroupResult,
  ReservedCustomerGroup,
} from './warehouses.types';

/**
 * Reglas y contrato de las reservas de almacén por GRUPO de clientes de SAP.
 *
 * El dueño de la regla es MobilityMiddleWare (≥ 1.357.0); esta capa valida lo mismo antes de
 * salir para no gastar un viaje en algo que ya se sabe que se rechaza, y traduce sus errores
 * al castellano. Ver `docs/SPEC_BACKOFFICE_ALMACENES.md`.
 */

/**
 * Primera versión del middleware con `/warehouse-customers/groups`, `/group-search` y
 * `/groups/customers`. Un middleware anterior responde 404 sin cuerpo a esas rutas.
 *
 * Mismo patrón que `MIN_MW_VERSION_REGION_GROUPS` en `regions.client.ts`: un piso mal puesto
 * da por bueno un middleware que responde 404, y el usuario ve un error crudo en lugar de
 * "falta desplegar el MW".
 */
export const MIN_MW_VERSION_CUSTOMER_GROUPS = '1.357.0';

/**
 * Grupos que NO se pueden reservar. El 37 es "Clientes Terceros": junta a los clientes que no
 * pertenecen a ningún holding (17.260 en 13 sociedades), así que reservarle un almacén
 * equivale a no reservarlo. Decisión del negocio del 2026-09-17: sólo el 37.
 *
 * Se compara el código EXACTO: en SAP `NE` y `ÑE` son grupos distintos y los dos existen.
 */
export const NON_ASSIGNABLE_CUSTOMER_GROUP_CODES: readonly string[] = ['37'];

/** Largo de `CustomerDetails.CustomerGroupCode` (`nvarchar(2)`). */
export const CUSTOMER_GROUP_CODE_MAX_LENGTH = 2;

export const CUSTOMER_GROUP_MESSAGES = {
  required: 'customerGroupCode es requerido',
  invalid: 'El código de grupo debe tener 1 o 2 caracteres',
  notAssignable:
    'El grupo 37 (Clientes Terceros) no se puede usar para reservar almacenes: junta clientes que no pertenecen a ningún holding',
  withoutCustomers: 'El grupo no tiene clientes en la sociedad del almacén',
  actorTooLong:
    'El usuario que hace el cambio no se puede registrar: su identificador es demasiado largo',
  warehouseNotFound: 'Almacén no encontrado',
  notDeployed:
    'La reserva por grupo todavía no está disponible en este entorno: falta desplegar la tabla WarehouseCustomerGroups',
  oldMiddleware: `La reserva por grupo todavía no está disponible en este entorno: requiere MW ≥ ${MIN_MW_VERSION_CUSTOMER_GROUPS}`,
  unavailable: 'El servicio de almacenes no está disponible',
  badRequest: 'Datos inválidos',
} as const;

/**
 * Normaliza y valida un código de grupo para una ESCRITURA. Recorta espacios (el MW también
 * lo hace) pero NO cambia mayúsculas: el código se compara exacto.
 */
export function normalizeCustomerGroupCode(raw: unknown): string {
  const code = raw == null ? '' : String(raw).trim();
  if (!code) throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.required);
  if (code.length > CUSTOMER_GROUP_CODE_MAX_LENGTH) {
    throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.invalid);
  }
  if (NON_ASSIGNABLE_CUSTOMER_GROUP_CODES.includes(code)) {
    throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.notAssignable);
  }
  return code;
}

/** Códigos de error estables del middleware (`{ success:false, error, code }`). */
export type CustomerGroupErrorCode =
  | 'required_fields_missing'
  | 'customer_group_code_invalid'
  | 'customer_group_not_assignable'
  | 'customer_group_without_customers'
  | 'user_id_too_long'
  | 'user_email_too_long'
  | 'warehouse_not_found'
  | 'customer_groups_not_deployed';

/**
 * Traduce el error del middleware en los endpoints de grupos. Mira el `code`, **nunca el
 * texto** (que viene en inglés y puede cambiar con cualquier reescritura del otro lado).
 *
 * Dos casos que parecen iguales y no lo son:
 * - `503 customer_groups_not_deployed`: el MW es nuevo pero falta la tabla. Es un problema de
 *   deploy de SQL, no del MW.
 * - `404` sin `code`: el MW es anterior a 1.357.0 y la ruta no existe (Express responde su
 *   HTML). Es un problema de deploy del MW. El único 404 real de estos endpoints trae
 *   `code: warehouse_not_found`.
 *
 * Los dos terminan en el mismo lugar para quien está mirando la pantalla —"no está disponible
 * en este entorno"— porque para el usuario la diferencia no cambia nada; el mensaje dice cuál
 * de los dos deploys falta para quien tenga que arreglarlo.
 */
export function throwCustomerGroupError(err: unknown): never {
  const status = httpStatus(err);
  const code = middlewareErrorCode(err) as CustomerGroupErrorCode | undefined;

  switch (code) {
    case 'required_fields_missing':
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.badRequest);
    case 'customer_group_code_invalid':
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.invalid);
    case 'customer_group_not_assignable':
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.notAssignable);
    case 'customer_group_without_customers':
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.withoutCustomers);
    case 'user_id_too_long':
    case 'user_email_too_long':
      throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.actorTooLong);
    case 'warehouse_not_found':
      throw new NotFoundException(CUSTOMER_GROUP_MESSAGES.warehouseNotFound);
    case 'customer_groups_not_deployed':
      throw new ServiceUnavailableException(CUSTOMER_GROUP_MESSAGES.notDeployed);
    default:
      break;
  }

  if (status === 400) throw new BadRequestException(CUSTOMER_GROUP_MESSAGES.badRequest);
  if (status === 404) throw new ServiceUnavailableException(CUSTOMER_GROUP_MESSAGES.oldMiddleware);
  throw new ServiceUnavailableException(CUSTOMER_GROUP_MESSAGES.unavailable);
}

// ---- Mappers: forma del MW → tipos de BackOffice ----
// Explícitos a propósito: si el MW renombra un campo, el test de costura
// (`customer-groups.spec.ts`) lo muestra como valor por defecto en lugar de dejarlo pasar.

type Raw = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function mapReservedGroup(r: Raw): ReservedCustomerGroup {
  return {
    guid: str(r.guid).trim(),
    customerGroupCode: str(r.customerGroupCode),
    customerGroupName: strOrNull(r.customerGroupName),
    customerCount: num(r.customerCount),
    userId: strOrNull(r.userId),
    userEmail: strOrNull(r.userEmail),
    timeStamp: num(r.timeStamp),
    serverTimestamp: num(r.serverTimestamp),
  };
}

export function mapGroupOption(r: Raw): CustomerGroupOption {
  const customerGroupCode = str(r.customerGroupCode);
  return {
    customerGroupCode,
    customerGroupName: strOrNull(r.customerGroupName),
    customerCount: num(r.customerCount),
    // Doble llave: aunque el MW lo marcara asignable, el 37 no lo es.
    assignable:
      r.assignable === true && !NON_ASSIGNABLE_CUSTOMER_GROUP_CODES.includes(customerGroupCode),
  };
}

export function mapGroupCustomer(r: Raw): GroupCustomer {
  return {
    customerCode: strOrNull(r.customerCode),
    customerName: strOrNull(r.customerName),
  };
}

export function mapAddGroupResult(r: Raw): AddCustomerGroupResult {
  const w = (r.warehouse ?? {}) as Raw;
  return {
    warehouse: {
      guid: str(w.guid).trim(),
      companyCode: str(w.companyCode),
      centerCode: str(w.centerCode),
      warehouseCode: str(w.warehouseCode),
    },
    customerGroupCode: str(r.customerGroupCode),
    customerGroupName: strOrNull(r.customerGroupName),
    customerCount: num(r.customerCount),
    reactivated: r.reactivated === true,
    alreadyExisted: r.alreadyExisted === true,
  };
}

export function mapRemoveGroupResult(r: Raw): RemoveCustomerGroupResult {
  return {
    removed: r.removed === true,
    stillRestricted: r.stillRestricted === true,
  };
}
