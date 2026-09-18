# Auditoria de acciones sobre base de datos — Mobility BackOffice (entorno QATEST/SAPServices)

> Ultima actualizacion: 2026-09-18
> Version: 2.0.0

Trazabilidad de las acciones sobre base de datos generadas durante el desarrollo de
BackOffice. Instancia: `100.66.245.49:1433`. Bases tocadas: `Mobility_QATEST`, `SAPServices`.
No hay acceso a PROD desde la VM (PROD vive en otro host).

| Fecha | Tipo | Objeto / accion | Base.schema | Script | Autor | Rollback | Estado |
|---|---|---|---|---|---|---|---|
| 2026-08-05 | READ | Inspeccion de columnas/indices de `Continents`, `ContinentProfitCenters` | Mobility_QATEST.dbo | — (sqlcmd inline) | Claude (Juan) | N/A | APLICADO |
| 2026-08-05 | READ | Inspeccion de columnas de `Companies` | SAPServices.dbo | — | Claude (Juan) | N/A | APLICADO |
| 2026-08-05 | READ | `sys.databases` (relevamiento de bases de la instancia) | master | — | Claude (Juan) | N/A | APLICADO |
| 2026-08-05 | READ | `OBJECT_DEFINITION(VIEW_V2_CompaniesMobility)` (extraccion para el script 005) | Mobility_QATEST.dbo | — | Claude (Juan) | N/A | APLICADO |
| 2026-08-05 | INSERT+DELETE | Fila de prueba E2E `ProfitCenterCode='ZZE2E'` en `ContinentProfitCenters` (alta via API/Middleware, verificacion, y **borrado fisico** posterior — neto cero) | Mobility_QATEST.dbo | — (smoke test) | Claude (Juan) | Ejecutado (DELETE, 0 filas residuo) | REVERTIDO |
| 2026-08-05 | DDL (script) | `005_ViewV2CompaniesMobility.sql` — crea `VIEW_V2_CompaniesMobility` | Mobility_QATEST.dbo | `apps/api/prisma/sql/005_ViewV2CompaniesMobility.sql` | Claude (Juan) | `DROP VIEW dbo.VIEW_V2_CompaniesMobility` | YA EXISTIA EN QATEST (no re-aplicado); **PENDIENTE en PROD** |
| 2026-09-18 | INSERT+DELETE / UPDATE | Verificacion del traspaso de Almacenes: reserva de grupo `T3` y de cliente `10001321` en el almacen `2500/2501/0069` (alta y baja), restriccion y liberacion del centro `2501`, y 4 filas en `AuditLogs` | Mobility_QATEST.dbo (`WarehouseCustomerGroups`, `AuditLogs`, `RestrictedCenters`) y SAPServices.dbo (`WarehouseCustomers`, `Warehouses.Availability`) | — (por la API de BackOffice 2.37.0 contra el MW 1.357.0) | Claude (Juan) | Revertido en la misma corrida | APLICADO |

## Notas

- **2026-09-18 — verificacion del traspaso de Almacenes (paso 4).** Todo lo que se escribio se
  revirtio en la misma corrida: el almacen `2500/2501/0069` quedo libre y el centro `2501` sin
  restringir, comprobado despues por `/schema` y por los endpoints del MW. Lo unico que queda es lo
  que tiene que quedar: las filas de `AuditLogs` (son el registro) y una fila borrada logicamente en
  `WarehouseCustomerGroups` y otra en `WarehouseCustomers`, que es como funciona el soft delete.
  Detalle de las 37 verificaciones en `SPEC_BACKOFFICE_ALMACENES.md`.

- La fila de prueba `ZZE2E` se creo dos veces (una por POST directo al Middleware, otra por el
  flujo de BackOffice) para validar el camino de escritura; ambas se **borraron fisicamente**
  con `DELETE ... WHERE ProfitCenterCode='ZZE2E'` (sqlcmd `-I` por el indice unico filtrado).
  Verificado: 0 filas residuo. No se toco ningun vinculo real.
- El script `005` es idempotente (`CREATE OR ALTER VIEW`). En QATEST la vista ya existia, asi
  que no hubo cambio. Queda **pendiente de aplicar en `Mobility-PROD`** (ver
  `docs/DEPLOY_SQL_PENDIENTE.md`).
