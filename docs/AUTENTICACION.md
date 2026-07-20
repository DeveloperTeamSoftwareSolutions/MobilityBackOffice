# Autenticacion y autorizacion — Mobility BackOffice

> Ultima actualizacion: 2026-07-20
> Version: 0.2.0

## Resumen

- **Credenciales**: las valida ITManager (ManageIT). BackOffice no las almacena ni las verifica.
- **Rol**: lo decide ITManager (rol asignado a la app). No se deriva del email ni del perfil SAP.
- **Token**: BackOffice **emite el suyo propio**, con el rol adentro. No reusa el de ManageIT.

## Flujo de login

1. `POST /api/auth/login` con `{ email, password }`.
2. `ItmanagerClient` llama a `POST {ITMANAGER_AUTH_URL}/auth/login` con `{ username, password, appId }`.
   - 401 de ITManager → `UnauthorizedException` (401).
   - Cualquier otro fallo → `ServiceUnavailableException` (503).
3. Del `accessMatrix` de la respuesta se toma **solo la entrada de `APP_ID`** y de ahi los
   `roleKeys` y los `permissions` (a estos se les quita el `PERM_PREFIX`).
4. `RoleResolver` mapea los roleKeys a un rol de negocio, por prioridad:

   | RoleKey en ITManager | Rol | Prioridad |
   |---|---|---|
   | `MOBILITYBO_SUPERADMIN` | `SuperAdmin` | 1 (mayor) |
   | `MOBILITYBO_ADMIN` | `Administrador` | 2 |
   | `MOBILITYBO_MARKETING` | `Marketing` | 3 |

   Si el usuario tiene varios, gana el de mayor privilegio. **Sin rol → 403.**
5. `TokenService` firma el JWT propio y se audita `LOGIN` en `AuditLogs`.

## Por que BackOffice emite su propio token

El JWT que emite ManageIT contiene exactamente:

```
{ sub, guid, guidApiLoginClients, email, username, isAdmin, iat, exp }
```

**No incluye los roleKeys.** Estos viajan solo en el *body* de la respuesta de login, dentro del
`accessMatrix`. Consecuencia: una app que reusa ese token y lo verifica localmente solo puede
autorizar por `isAdmin`.

Y `isAdmin` **no es especifico de la aplicacion**. En ManageIT
(`src/api/routes/auth.js:96`) vale `!!user.IsAdmin || isSuperAdmin`, donde `isSuperAdmin` es
tener cualquier RoleKey terminado en `_SUPERADMIN` de **cualquier aplicacion**. Un
`DASHI_SUPERADMIN` llega a BackOffice con `isAdmin: true` sin tener ningun rol acá.

Por eso BackOffice firma su propio token con el claim `role`, que es la autoridad de
autorizacion. Es el mismo camino que ya tomo **MobilityIA**, la unica app del ecosistema que
hoy sostiene autorizacion granular por rol del lado del servidor.

### Estado del resto del ecosistema

| App | Token | Autorizacion efectiva en runtime |
|---|---|---|
| **MobilityIA** | propio, con `roles[]`/`permissions[]` | por rol, server-side |
| **MobilityBackOffice** | propio, con `role` | por rol, server-side |
| MobilityManager | passthrough de ManageIT | solo `isAdmin` + scope jerarquico SQL; el `RoleGuard` del front lee `localStorage` y es cosmetico |
| DuwyDashy / DuwyDashy-endpoints | passthrough | ninguna (solo distingue usuario real de embed) |
| DuwyChat | passthrough | ninguna |
| ManageIT | propio (es el IdP) | `isAdmin` + re-consulta a la DB cacheada 60s |

## Token propio

```
{ sub, guid, guidApiLoginClients?, email, username, isAdmin, role, iat, exp }
```

Se conservan los nombres de ManageIT para que el codigo que lee identidad sea portable entre
apps; se agrega `role`.

- Algoritmo HS256, secret `BACKOFFICE_JWT_SECRET` (**propio**, distinto del de ManageIT: si se
  compartiera, un token de otra app validaria acá).
- Vigencia `JWT_EXPIRES_IN`, default `1h`.
- **El rol queda congelado hasta que el token expira.** Si a alguien se le cambia el rol en
  ITManager, el cambio aplica en su proximo login. Es el mismo compromiso que asumio MobilityIA
  (que usa 8h); acá se eligio 1h para acotar la ventana.

`isAdmin` se conserva en el token como dato informativo, pero **no autoriza nada por si solo**:
hay un test que fija esa conducta (`roles.guard.spec.ts`).

## Guards

| Guard | Que hace |
|---|---|
| `JwtGuard` | Verifica el token propio y popula `req.user`. Lee `Authorization: Bearer` o la cookie `token`. Sin token → 401; invalido o expirado → 401. |
| `RolesGuard` | Autoriza por el claim `role` contra los roles declarados con `@Roles(...)`. `SuperAdmin` pasa siempre. Rol ausente, desconocido o insuficiente → 403. |

Uso:

```ts
@Post(':guid/cebes')
@Roles(BackOfficeRole.Administrador)
@UseGuards(JwtGuard, RolesGuard)
async linkCebes() { ... }
```

Una ruta con `JwtGuard` pero sin `@Roles` queda accesible a cualquier usuario autenticado —
`RolesGuard` deja pasar cuando la ruta no declara roles.

## Asignar acceso a un usuario

En ITManager: asignarle la aplicacion **MobilityBackOffice** y uno de los roles
`MOBILITYBO_*`. Sin eso, el login responde 403. El registro de la app y sus roles lo crea
`apps/api/prisma/sql/001_RegisterMobilityBackOfficeApp.sql`.

## Auditoria

Todo intento de login queda en `AuditLogs` con `AppId='MobilityBackOffice'`,
`Entity='Auth'`, `Category='auth'`:

| Action | Cuando | GuidUsers |
|---|---|---|
| `LOGIN` | acceso exitoso | guid del usuario |
| `LOGIN_FAILED` | credenciales invalidas | `NULL` (no se identifico) |
| `LOGIN_FAILED` | autenticado pero sin rol en la app | guid del usuario |

`AuditLogs` no tiene columnas de email ni de resultado: la identidad va en `Detail` y el
resultado se distingue por `Action`.
