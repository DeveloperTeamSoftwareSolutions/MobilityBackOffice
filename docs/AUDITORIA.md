# Auditoria — Mobility BackOffice

> Ultima actualizacion: 2026-07-21
> Version: 1.0.0

Toda accion relevante deja traza en `AuditLogs`, la tabla **central compartida** con ITManager
y MobilityManager. BackOffice escribe sus filas con `AppId='MobilityBackOffice'`.

## El servicio

`AuditService` (`apps/api/src/audit/audit.service.ts`, modulo global) es el unico punto que
conoce el mapeo a la tabla. Dos metodos:

| Metodo | Cuando usarlo | Si el insert falla |
|---|---|---|
| `record(entry)` | La auditoria es parte del contrato (ej. login) | Propaga el error |
| `safeRecord(entry)` | La accion de negocio ya ocurrio y no debe revertirse por un fallo del audit | Loguea y sigue |

El `AppId` sale de `itmanager.appId` (config) si no se pasa explicito.

## Forma de la fila

`AuditLogs` tiene columnas genericas (no especificas de una app):

| Columna | Contenido |
|---|---|
| `AppId` | `MobilityBackOffice` |
| `GuidUsers` | guid del actor, o NULL si no se identifico |
| `Action` | verbo del evento (ver catalogo) |
| `Entity` | entidad afectada |
| `EntityId` | identificador de la entidad, si aplica |
| `Category` | dominio (`auth`, `regions`) |
| `Detail` | texto libre que arma cada dominio; incluye la identidad legible |
| `TimeStamp` / `ServerTimestamp` | epoch ms |

`AuditLogs` no tiene columnas de email ni de resultado: la identidad legible va en `Detail` y el
resultado se distingue por `Action` (p. ej. `LOGIN` vs `LOGIN_FAILED`).

## Catalogo de acciones

### Autenticacion (`Category='auth'`, `Entity='Auth'`)

| Action | Cuando | GuidUsers | Metodo |
|---|---|---|---|
| `LOGIN` | acceso exitoso | guid del usuario | `record` |
| `LOGIN_FAILED` | credenciales invalidas | NULL | `record` |
| `LOGIN_FAILED` | autenticado pero sin rol en la app | guid del usuario | `record` |

### Regiones comerciales (`Category='regions'`, `Entity='ContinentProfitCenter'`)

| Action | Cuando | GuidUsers | EntityId | Metodo |
|---|---|---|---|---|
| `REGION_CEBE_LINK` | se vincula un CEBE a una region | guid del actor | codigo del CEBE | `safeRecord` |
| `REGION_CEBE_UNLINK` | se desvincula un CEBE | guid del actor | codigo del CEBE | `safeRecord` |
| `REGION_SYNC` | corre el sync maquina-a-maquina | NULL | — | `safeRecord` |

El `Detail` de las acciones de regiones incluye actor, region, CEBE, sociedad y source, p. ej.:
`admin@duwest.com | region=CA | cebe=1003 | sociedad=2100 | source=ui`. El del sync resume el
batch: `sap-sync | regiones=1 | altas=1 | bajas=0 | ignoradas=0 | source=sap`.

## Consultar la traza

```sql
SELECT TOP 50 Action, Category, EntityId, GuidUsers, Detail,
       DATEADD(SECOND, ServerTimestamp/1000, '1970-01-01') AS Cuando
FROM AuditLogs
WHERE AppId = 'MobilityBackOffice'
ORDER BY Id DESC;
```
