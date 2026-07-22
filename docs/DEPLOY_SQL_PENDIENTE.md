# Checklist de scripts SQL — Mobility BackOffice

> Ultima actualizacion: 2026-07-20
> Version: 1.1.0

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
| 001 | `001_RegisterMobilityBackOfficeApp.sql` | Registro de la app + 3 roles en ITManager (`Applications`, `Roles`) | [x] **aplicado 2026-07-20** | [ ] |
| 002 | `002_ContinentProfitCenters.sql` | Tabla M:N region↔CEBE + 2 indices | [x] verificado 2026-07-20 (aplicado por MM) | [ ] |
| 003 | `003_ContinentProfitCentersCompanyCode.sql` | `CompanyCode` + clave unica triple | [x] verificado 2026-07-20 (aplicado por MM) | [ ] |
| 004 | `004_ViewProfitCentersMobility.sql` | Versiona `dbo.VIEW_ProfitCentersMobility` (se consumia sin estar en ningun repo) | [x] verificado 2026-07-20 (ya existia; **el script NO la modifico**) | [ ] |

Orden de ejecucion: **001 → 002 → 003 → 004**. El 003 requiere que el 002 ya exista.

Los scripts 002 y 003 son los `004_` y `006_` del repo MobilityManager, renumerados.

### Estado verificado en QATEST — 2026-07-20

Verificado por consulta directa, no asumido:

- `ContinentProfitCenters` y `Continents`: existen.
- Columna `CompanyCode`: existe (`NVARCHAR(32)`).
- Indices de `ContinentProfitCenters`: `PK_`, `UQ_..._Guid`, `IX_..._CompanyCode`,
  `IX_..._ProfitCenterCode`, y el unico filtrado triple
  `UX_ContinentProfitCenters_Cont_Cebe_Company_Active`. El unico por par ya no esta:
  confirma que el 003 corrio completo.
- `VIEW_ProfitCentersMobility`: existe. El script 004 la detecto y **no la modifico**.
- App `MobilityBackOffice` + 3 roles: creados por el 001. Re-ejecutado para confirmar
  idempotencia: sigue habiendo 1 fila en `Applications` y 3 en `Roles`.

### PROD — NO verificado

**No se pudo conectar a `Mobility-PROD`**: las credenciales disponibles son de QATEST y el
login del usuario `sa` es rechazado en PROD. Todo lo que figura como pendiente en la columna
PROD esta **sin confirmar**, en ambos sentidos: puede que algun objeto ya exista.

Antes de desplegar a produccion hay que correr la verificacion de abajo con credenciales de PROD.

## Riesgo abierto — renombre SA → AN

La region `SA` (Sudamerica) se renombro a `AN` (Andina) en QATEST. **Antes de tocar PROD** hay
que verificar que ningun otro sistema (DuwyDashy, MobilityMiddleWare) filtre por el `'SA'` viejo.
`Continents` es una tabla compartida y BackOffice la trata como solo lectura.

## Verificacion rapida de objetos

```sql
SELECT 'tabla ContinentProfitCenters' AS objeto,
       CASE WHEN OBJECT_ID('dbo.ContinentProfitCenters') IS NULL THEN 'FALTA' ELSE 'OK' END AS estado
UNION ALL SELECT 'tabla Continents',
       CASE WHEN OBJECT_ID('dbo.Continents') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT 'columna CompanyCode',
       CASE WHEN COL_LENGTH('dbo.ContinentProfitCenters','CompanyCode') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT 'vista VIEW_ProfitCentersMobility',
       CASE WHEN OBJECT_ID('dbo.VIEW_ProfitCentersMobility') IS NULL THEN 'FALTA' ELSE 'OK' END
UNION ALL SELECT 'app MobilityBackOffice registrada',
       CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.Applications WHERE AppId='MobilityBackOffice')
            THEN 'FALTA' ELSE 'OK' END;

-- Indices: debe estar el unico filtrado TRIPLE, no el de par.
SELECT i.name, i.is_unique, i.has_filter
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.ContinentProfitCenters') AND i.name IS NOT NULL
ORDER BY i.name;
```

Ejecucion con sqlcmd (recordar `-I`, y correr desde el directorio del script: sqlcmd rompe
con rutas absolutas de Windows en `-i`):

```bash
cd apps/api/prisma/sql
sqlcmd -S <host>,1433 -U <user> -d Mobility_QATEST -C -I -b -i 001_RegisterMobilityBackOfficeApp.sql
```
