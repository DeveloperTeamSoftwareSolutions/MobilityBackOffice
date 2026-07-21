# API — Mobility BackOffice

> Ultima actualizacion: 2026-07-20
> Version: 0.5.0

Toda respuesta incluye `success`. Los errores siguen el formato de Nest:
`{ message, error, statusCode }`.

## Autenticacion

| Metodo | Ruta | Guard | Descripcion |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` → `{ success, token, user, role, permissions }`. 401 credenciales invalidas, 403 sin rol en la app, 400 email mal formado |
| GET | `/api/auth/me` | Jwt | Claims del token propio, incluido `role` |

## Salud

| Metodo | Ruta | Guard | Descripcion |
|---|---|---|---|
| GET | `/api/health` | — | `{ success, name, version, status }` |

## Regiones comerciales

**Todo el modulo exige rol `Administrador`** (`SuperAdmin` pasa siempre por el `RolesGuard`).

> **Diferencia con MobilityManager**: alli las lecturas estaban abiertas a cualquier
> autenticado porque las consumian reportes externos. Aca no hay mas consumidor que esta UI,
> y dejar el mapa region↔CEBE legible para Marketing contradiria que la seccion no se le
> muestre. Si en el futuro un reporte necesita `/resolve`, la via es el sync por API key o
> agregar el rol correspondiente al decorador.

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/regions` | Listado paginado. Query: `page`, `limit` (max 200), `search`, `sortBy` (`code`\|`name`\|`sortOrder`\|`serverTimestamp`\|`cebeCount`), `sortDir` |
| GET | `/api/regions/groups` | Agrupaciones virtuales (CAYCAR = CA + CB) con su conteo de CEBEs efectivos |
| GET | `/api/regions/cebes/available` | Typeahead de CEBEs. Query: `q`, `limit` (max 50) |
| GET | `/api/regions/companies` | Typeahead de sociedades. Query: `q`, `limit` (max 50) |
| GET | `/api/regions/diagnostics/unmapped` | CEBEs del maestro sin ninguna region |
| GET | `/api/regions/diagnostics/multi` | CEBEs vinculados a mas de una region |
| GET | `/api/regions/:code/resolve` | Pares (CEBE, sociedad) efectivos. `CAYCAR` → union sin duplicados de CA y CB |
| GET | `/api/regions/:guid` | Region + sus vinculos. 404 si no existe |
| POST | `/api/regions/:guid/cebes` | Vincular. Body `{ cebes: [{ code, companyCode, name? }] }` → `{ success, linked }`. 400 si la lista viene vacia o si algun item no trae `companyCode`; 404 si la region no existe |
| DELETE | `/api/regions/:guid/cebes/:code/:companyCode` | Desvincular (soft delete). 404 si el vinculo no existia |

### Orden de rutas — load-bearing

Las rutas literales (`groups`, `cebes/available`, `companies`, `diagnostics/*`) y `:code/resolve`
se declaran **antes** que `:guid`. Invertir ese orden hace que `/groups` se interprete como un
guid. Esta anotado en el propio controller.

### Sync maquina-a-maquina

| Metodo | Ruta | Guard | Descripcion |
|---|---|---|---|
| POST | `/api/regions/sync` | `x-api-key` | Reconcilia el estado deseado de vinculos |

- Body: `{ regions: [{ code, cebes: [{ code, companyCode, name? }] }], source? }` (default `sap`).
- Header opcional `x-actor` (default `sap-sync`) para la traza.
- Respuesta: `{ success, regions, added, removed, skipped }`.
- **Nunca crea regiones**: los codigos ausentes del catalogo `Continents` vuelven en `skipped`.
- **Idempotente**: reenviar el mismo estado devuelve `added: 0, removed: 0`.
- Sin `REGIONS_SYNC_API_KEY` configurada el endpoint responde **403** (deshabilitado); con key
  incorrecta, **401**.

## Auditoria

Las escrituras dejan traza en `AuditLogs` con `AppId='MobilityBackOffice'`:

| Action | Category | Entity | EntityId |
|---|---|---|---|
| `LOGIN` / `LOGIN_FAILED` | `auth` | `Auth` | — |
| `REGION_CEBE_LINK` | `regions` | `ContinentProfitCenter` | codigo del CEBE |
| `REGION_CEBE_UNLINK` | `regions` | `ContinentProfitCenter` | codigo del CEBE |
| `REGION_SYNC` | `regions` | `ContinentProfitCenter` | — |
