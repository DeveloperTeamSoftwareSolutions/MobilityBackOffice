# Auditoria de acciones sobre base de datos — Mobility BackOffice (entorno PROD)

> Ultima actualizacion: 2026-09-22
> Version: 2.37.0

Trazabilidad de las acciones sobre `Mobility-PROD` generadas a partir del desarrollo de
BackOffice. La VM de desarrollo **no tiene credenciales** de esa base: la inspeccion se hace por
el endpoint de introspeccion del MobilityMiddleWare (solo lectura, solo estructura) y los
scripts los aplica una persona con acceso, por SSMS/sqlcmd.

| Fecha | Tipo | Objeto / accion | Base.schema | Script | Autor | Rollback | Estado |
|---|---|---|---|---|---|---|---|
| 2026-09-22 | READ | Relevamiento de estructura: `Continents`, `ContinentProfitCenters` (columnas e indices), `VIEW_ProfitCentersMobility`, `VIEW_V2_ProfitCentersMobility`, `VIEW_V2_CompaniesMobility`, `VIEW_RegionGroupProfitCenters`, columnas de `BusinessOrders`, base y collation | Mobility-PROD.dbo | — (`GET /api/v2/mobility/schema/...` del MW en `100.100.46.73:62700`) | Claude (Juan) | N/A | APLICADO |
| 2026-09-22 | READ | `SELECT RoleKey FROM dbo.Roles WHERE RoleKey LIKE 'MOBILITYBO%'` (antes y despues de aplicar los scripts) | Mobility-PROD.dbo | — (consulta directa) | Juan | N/A | APLICADO |
| 2026-09-22 | DML (script) | `006_AddSupportRole.sql` — rol `MOBILITYBO_SUPPORT` + permisos `SUPPORT_VIEW`/`SUPPORT_OVERRIDE` + mapeo (tambien a SUPERADMIN) | Mobility-PROD.dbo (`Roles`, `Permissions`, `RolePermissions`) | `apps/api/prisma/sql/006_AddSupportRole.sql` | Juan | Borrar las filas del rol y su mapeo | APLICADO |
| 2026-09-22 | DML (script) | `008_AddRevisionSapRole.sql` — rol `MOBILITYBO_REVISION_SAP` + permisos `REVISION_SAP_VIEW`/`REVISION_SAP_RESEND` + mapeo (tambien a SUPERADMIN) | Mobility-PROD.dbo (`Roles`, `Permissions`, `RolePermissions`) | `apps/api/prisma/sql/008_AddRevisionSapRole.sql` | Juan | Borrar las filas del rol y su mapeo | APLICADO |

## Notas

- **2026-09-22 — estado de PROD.** El relevamiento mostro que varios objetos que el checklist
  daba por pendientes ya estaban: la vista del script `005` (desde el 2026-08-04),
  `VIEW_RegionGroupProfitCenters` (2026-09-11) y las dos columnas de rechazo en `BusinessOrders`.
  Lo unico que faltaba de verdad eran los roles del `006` y del `008`, que se aplicaron ese dia.
  Detalle en `DEPLOY_SQL_PENDIENTE.md`.

- **El Sandbox `100.100.46.73` lee `Mobility-PROD`**, no `Mobility_QATEST`. Toda prueba hecha ahi
  escribe en produccion: tenerlo presente antes de un smoke test que cree o modifique filas.

- Los scripts `006` y `008` son **aditivos e idempotentes** (`IF NOT EXISTS`): no tocan datos de
  negocio, solo el catalogo de roles y permisos de ITManager. Asignar esos roles a una persona
  sigue siendo una accion manual en ITManager.
