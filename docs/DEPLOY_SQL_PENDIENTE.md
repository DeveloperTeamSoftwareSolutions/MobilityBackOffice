# Checklist de scripts SQL — Mobility BackOffice

> Ultima actualizacion: 2026-07-20
> Version: 0.1.0

Documento **vivo**: marcar la casilla y anotar la fecha al aplicar cada script en cada entorno.

## Reglas de aplicacion

- Aplicacion **manual** (SSMS o sqlcmd) conectandose a la base destino.
- **Prohibido** `prisma migrate` y `prisma db push`: la base es compartida y BackOffice no la posee.
- Todos los scripts son **idempotentes** (`IF NOT EXISTS` / `CREATE OR ALTER`): re-ejecutar es seguro.
- Los scripts **no llevan `USE`** — dependen de la conexion. Verificar la base antes de correr.
- Los indices unicos **filtrados** (`WHERE DeletedTimestamp IS NULL`) exigen
  `SET QUOTED_IDENTIFIER ON`. Con sqlcmd hay que pasar **`-I`** o falla con **Msg 1934**.
- Sandbox y local suelen apuntar a la **misma** base `Mobility_QATEST`. Si es asi, verificar que
  los objetos existan y saltear. Solo si Sandbox apunta a otra base se corre todo.

## Bases por entorno

| Entorno | Base | Instancia |
|---|---|---|
| Local / Sandbox | `Mobility_QATEST` | `100.66.245.49:1433` |
| Produccion | `Mobility-PROD` | `100.66.245.49:1433` |

## Scripts

| # | Script | Contenido | QATEST | PROD |
|---|---|---|---|---|
| 001 | `001_RegisterMobilityBackOfficeApp.sql` | Registro de la app + 3 roles en ITManager (`Applications`, `Roles`) | [ ] | [ ] |
| 002 | `002_ContinentProfitCenters.sql` | Tabla M:N region↔CEBE + 2 indices | [x] ya aplicado por MM — **verificar** | [ ] |
| 003 | `003_ContinentProfitCentersCompanyCode.sql` | `CompanyCode` + clave unica triple | [x] ya aplicado por MM — **verificar** | [ ] |
| 004 | `004_ViewProfitCentersMobility.sql` | Versiona `dbo.VIEW_ProfitCentersMobility` (se consumia sin estar en ningun repo) | [ ] verificar existencia | [ ] verificar existencia |

Orden de ejecucion: **001 → 002 → 003 → 004**. El 003 requiere que el 002 ya exista.

Los scripts 002 y 003 son los `004_` y `006_` del repo MobilityManager, renumerados. Ya fueron
aplicados a QATEST desde alli, por eso figuran como "verificar" y no como pendientes: hay que
confirmar que los objetos existen antes de asumirlo.

## Riesgo abierto — renombre SA → AN

La region `SA` (Sudamerica) se renombro a `AN` (Andina) en QATEST. **Antes de tocar PROD** hay
que verificar que ningun otro sistema (DuwyDashy, MobilityMiddleWare) filtre por el `'SA'` viejo.
`Continents` es una tabla compartida y BackOffice la trata como solo lectura.

## Verificacion rapida de objetos

```sql
SELECT name FROM sys.tables  WHERE name IN ('ContinentProfitCenters', 'Continents');
SELECT name FROM sys.views   WHERE name = 'VIEW_ProfitCentersMobility';
SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('ContinentProfitCenters') AND name = 'CompanyCode';
SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('ContinentProfitCenters');
```
