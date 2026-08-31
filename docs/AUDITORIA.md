# Auditoria — Mobility BackOffice

> Ultima actualizacion: 2026-08-31
> Version: 2.24.0

Toda accion relevante deja traza en `AuditLogs`, la tabla **central compartida** con ITManager
y MobilityManager. BackOffice escribe sus filas con `AppId='MobilityBackOffice'`.

> **Cambio v2.0.0 (transporte)**: la escritura ya **no** va por Prisma/SQL directo. `AuditService`
> escribe por HTTP contra el MobilityMiddleWare (`POST /audit-logs`, `AuditClient`), dueño de la
> tabla. Los timestamps los pone el Middleware (reloj del servidor de base), no BackOffice.

> **Cambio v2.23.0 (visibilidad e identidad)**: las filas ahora llevan `GuidApiLoginClients` y
> `ActorEmail`, y las categorias siguen el formato de ITManager. Ver §"Por que no se veian".

## Por que las filas no se veian en ITManager

La pantalla de auditoria de ITManager (`GET /api/admin/audit`) hace
`GetByClient(req.user.guidApiLoginClients)`, o sea **filtra por cliente**. BackOffice dejaba
ese campo en `null`, asi que sus filas existian en la tabla pero no entraban en el filtro.

Medido sobre `Mobility_QATEST` el 2026-08-31, antes del cambio: de 148 filas de BackOffice,
**94 sin cliente**. Las 54 restantes no las escribia BackOffice sino **ITManager**, que
registra su propia fila de login con el `appId` que le mandamos. MobilityManager tenia el
mismo hueco (1209 de 2869).

El dato sale del login de ITManager (`client.guid`), viaja en el JWT propio de BackOffice
(`guidApiLoginClients`) y llega a cada auditoria via `actorFrom(req)`.

## El servicio

`AuditService` (`apps/api/src/audit/audit.service.ts`, modulo global) es el unico punto que
conoce el mapeo a la tabla. Dos metodos:

| Metodo | Cuando usarlo | Si el insert falla |
|---|---|---|
| `record(entry)` | La auditoria es parte del contrato (ej. login) | Propaga el error |
| `safeRecord(entry)` | La accion de negocio ya ocurrio y no debe revertirse por un fallo del audit | Loguea y sigue |

## Forma de la fila

| Columna | Contenido |
|---|---|
| `AppId` | `MobilityBackOffice` |
| `GuidApiLoginClients` | **Cliente del usuario.** Sin el, ITManager no muestra la fila |
| `GuidUsers` | guid del actor, o NULL si no se identifico. El middleware valida que sea un GUID |
| `ActorEmail` | email del actor, **en su columna**: permite filtrar por persona sin `LIKE` |
| `Action` | verbo especifico del evento (ver catalogo) |
| `Entity` | entidad afectada |
| `EntityId` | identificador legible de la entidad, si aplica |
| `Category` | dominio, del enum `AuditCategory` |
| `Detail` | lo que no entra en ninguna columna |

`AuditLogs` no tiene columna de resultado: se distingue por `Action` (`LOGIN` vs
`LOGIN_FAILED`). El email **ya no se repite** dentro de `Detail`: tiene la suya.

## Categorias (`AuditCategory`)

Capitalizadas como las de ITManager. El desplegable de categorias de su pantalla se arma
con `SELECT DISTINCT Category`, asi que una categoria propia aparece sola — pero si
escribieramos `auth` y ellos `Auth`, el desplegable mostraria dos entradas que se leen igual.

| Valor | Dominio |
|---|---|
| `Auth` | Accesos. **La comparte con ITManager**: los logins quedan todos juntos |
| `Regions` | Regiones comerciales por CEBE |
| `Support` | Consola de soporte |
| `Templates` | Plantillas de WhatsApp |

## Catalogo de acciones

### Autenticacion (`Auth`, `Entity='Auth'`)

| Action | Cuando | GuidUsers | Metodo |
|---|---|---|---|
| `LOGIN` | acceso exitoso | guid del usuario | `record` |
| `LOGIN_FAILED` | credenciales invalidas | NULL | `record` |
| `LOGIN_FAILED` | autenticado pero sin rol en la app | guid del usuario | `record` |

> El login exitoso queda **dos veces**: la fila de ITManager (`Entity='Users'`) y la nuestra
> (`Entity='Auth'`). No es redundante del todo — el `LOGIN_FAILED` por falta de rol en
> BackOffice ITManager no lo conoce.

### Regiones (`Regions`, `Entity='ContinentProfitCenter'`)

| Action | Cuando | EntityId |
|---|---|---|
| `REGION_CEBE_LINK` | se vincula un CEBE a una region | codigo del CEBE |
| `REGION_CEBE_UNLINK` | se desvincula un CEBE | codigo del CEBE |
| `REGION_SYNC` | corre el sync maquina-a-maquina | — |

### Soporte (`Support`, `Entity='BusinessQuotes'` / `'BusinessOrders'`)

`SUPPORT_ACTION`, `SUPPORT_RECOMPUTE` y las decisiones sobre items y plazos de pago. El
`Detail` incluye el documento, el **estado antes -> despues** y el motivo escrito por la
persona.

### Plantillas de WhatsApp (`Templates`, `Entity='WhatsAppTemplate'`)

Todas con `safeRecord`: la accion ya ocurrio en META y un fallo del audit no puede
revertirla. `EntityId` es el **nombre** de la plantilla, no el id de WABA: el id no
significa nada para quien lee la auditoria desde ITManager.

| Action | Cuando | Detail |
|---|---|---|
| `TEMPLATE_DRAFT_CREATE` | se crea un borrador (la **primera** vez que se guarda) | que todavia no salio, y el id del borrador |
| `TEMPLATE_CREATE` | se crea y envia a META | categoria e idioma |
| `TEMPLATE_UPDATE` | se edita una que ya existe alla | que vuelve a revision |
| `TEMPLATE_SUBMIT` | se envia un borrador | de que borrador salio |
| `TEMPLATE_DELETE` | se elimina | aviso de que en META no se deshace |
| `TEMPLATE_SYNC` | se sincroniza con META | — |

**Crear** un borrador si se audita; **guardarlo de nuevo, no**. La primera vez dice algo
—quien empezo esto— y ademas cierra el ciclo: borrar un borrador ya se auditaba, asi que
sin esto la traza podia decir "fulano borro la plantilla X" sin ningun registro de que X
hubiera sido creada. Los guardados siguientes no aportan: el asistente guarda solo cada
vez que se alterna de modo, y una plantilla generaria veinte filas mientras se arma.

Al **borrar** se consulta el nombre antes de la baja: despues ya no existe, y sin nombre la
traza diria que se borro algo pero no que. Si esa consulta falla, se borra igual y se
registra el id — perder la traza es malo, no poder borrar por eso es peor.

## Lo que NO se audita

Las lecturas no: nadie audita que alguien miro una lista. De las escrituras quedan estas
afuera, y solo una es una decision pendiente:

| Que | Por que |
|---|---|
| Guardar de nuevo un borrador que ya existe | La **creacion** si se audita (`TEMPLATE_DRAFT_CREATE`). Los guardados siguientes no: el asistente guarda solo al alternar de modo, y una plantilla generaria veinte filas mientras se arma |
| `POST /templates/upload-sample` | **Pendiente de decidir.** A diferencia del borrador, esto **si** sale: queda un archivo en los servidores de META. Es el unico caso con efecto afuera que quedo sin traza |
| `POST /auth/logout` | Solo limpia una cookie del navegador; no hay sesion del lado del servidor que cerrar |
| `POST /templates/validate` | Es un ensayo: arma el payload y no escribe nada, ni aca ni en META |

## Lo que WABA audita por su lado

WABA tiene su propia tabla `AuditLog` y registra las plantillas, pero BackOffice entra con
una API key: sus filas quedan con `AuthType='apikey'` y `GuidUsers` en NULL, o sea **sin
quien**. El "quien" vive en la auditoria central. Pasarle tambien la identidad a WABA (por
un header, hacia `MetadataJson`) es un cambio chico y quedo pendiente.

## Consultar la traza

```sql
SELECT TOP 50 Action, Category, RTRIM(EntityId) AS EntityId, ActorEmail, Detail,
       DATEADD(SECOND, ServerTimestamp/1000, '1970-01-01') AS Cuando
FROM AuditLogs
WHERE AppId = 'MobilityBackOffice'
ORDER BY Id DESC;
```

Filas que no se verian desde ITManager (deberia dar 0 para lo nuevo):

```sql
SELECT COUNT(*) FROM AuditLogs
WHERE AppId = 'MobilityBackOffice' AND GuidApiLoginClients IS NULL;
```
