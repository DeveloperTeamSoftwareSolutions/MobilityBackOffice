# Deuda de autorizacion en el ecosistema ITManager — PENDIENTE

> Relevado: 2026-07-20, durante la fase 2 de Mobility BackOffice
> Estado: **documentado, sin corregir** en las apps afectadas
> Alcance: este documento NO describe a BackOffice (ya corregido). Describe el resto
> del ecosistema y deja el trabajo pendiente anotado.

---

## El problema de fondo

El JWT que emite ManageIT contiene exactamente:

```
{ sub, guid, guidApiLoginClients, email, username, isAdmin, iat, exp }
```

**No incluye los roleKeys.** Los roles y permisos viajan unicamente en el *body* de la respuesta
de `POST /auth/login`, dentro del `accessMatrix` (`ManageIT/src/api/routes/auth.js:188-222`).

Consecuencia directa: cualquier app que reuse ese token y lo verifique localmente **pierde el rol
en cada request posterior al login**. Lo unico que le queda para autorizar es `isAdmin`.

### Y `isAdmin` no es especifico de la aplicacion

`ManageIT/src/api/routes/auth.js:96-97`:

```js
const effectiveAdmin = !!user.IsAdmin || isSuperAdmin;
// isSuperAdmin = tiene algun RoleKey terminado en _SUPERADMIN, de CUALQUIER app
```

Un usuario con `DASHI_SUPERADMIN` (DuwyDashy) llega a MobilityManager, a DuwyChat o a cualquier
otra app del ecosistema con `isAdmin: true`, **sin tener ningun rol asignado en esa app**.
`ManageIT/src/api/middleware/auth.js:31-35` incluso lo *promueve* en runtime consultando la base.

**Esto es una fuga de privilegios entre sistemas**: el superadmin de un sistema obtiene
privilegios de administrador en todos los demas.

---

## Estado por aplicacion

| App | Token | Autorizacion efectiva | Severidad |
|---|---|---|---|
| **MobilityIA** | propio, con `roles[]`/`permissions[]` | por rol, server-side | correcto |
| **MobilityBackOffice** | propio, con `role` | por rol, server-side | corregido 2026-07-20 |
| **MobilityManager** | passthrough | solo `isAdmin`; el `RoleGuard` del front es cosmetico | **alta** |
| **DuwyDashy** | passthrough | ninguna: cualquier usuario logueado real tiene acceso total | **alta** |
| **DuwyDashy-endpoints** | passthrough | idem DuwyDashy (es un fork byte-identico del auth) | **alta** |
| **DuwyChat** | passthrough | solo verifica presencia del appId en el accessMatrix | media |
| **ManageIT** | propio (es el IdP) | `isAdmin` + re-consulta a la DB cacheada 60s | aceptable |

### MobilityManager — severidad alta

- `apps/api/src/auth/admin.guard.ts:19-24` es el unico guard de autorizacion de la API, y solo
  mira `isAdmin`. Cualquier superadmin de otra app lo pasa.
- `apps/web/src/auth/RoleGuard.tsx:18-22` decide por el rol guardado en `localStorage`
  (`mm_session`). **Es una barrera cosmetica, no de seguridad**: se elude editando el
  localStorage, y el backend no revalida nada.
- El backend **no puede distinguir un Gerente de un Director**. Lo que hoy contiene el acceso es
  el scope jerarquico en SQL (`scope.service.ts`), que limita *que filas ve* cada quien, no *que
  acciones puede ejecutar*.
- Impacto concreto: el modulo de Regiones (branch `feature/regiones-cebe`) protege sus escrituras
  con `AdminGuard`. Un `MOBILITYMGR_SUPERADMIN` legitimo sin `IsAdmin` no puede escribir, y un
  superadmin de otro sistema si.

### DuwyDashy y DuwyDashy-endpoints — severidad alta

`src/middleware/requireAdmin.js:18-32` no chequea rol ni permiso: el unico filtro es distinguir
un usuario real de un embed (`trusted-email:`). Esta documentado como decision explicita
("el equipo interno opera sin diferenciacion de roles", spec hub-consolidation D5, 2026-07-03),
asi que **puede ser aceptable por politica** — pero conviene revalidarlo, porque el panel admin
queda abierto a todo el que tenga login.

Ademas, el token sintetico del modo iframe (`token: \`trusted-email:${email}\``,
`src/api/routes/auth.js:59`) **no esta firmado**: se valida por prefijo de string
(`requireAuth.js:103-111`). Quien pueda emitir ese header se hace pasar por cualquier email.

### DuwyChat — severidad media

Solo verifica que el appId figure en el accessMatrix. En modo trusted asigna rol fijo `'User'`
con `permissions: []`, que nadie consume despues. `docs/ROLES_AND_PERMISSIONS.md` existe pero no
esta implementado.

---

## Los dos patrones de correccion probados en casa

**A — Token propio con el rol embebido** (MobilityIA, MobilityBackOffice)

Tras validar credenciales contra ITManager, la app firma su propio JWT incluyendo el rol resuelto,
con secret propio. Los guards autorizan por ese claim.

- A favor: sin estado de servidor, sin llamadas extra por request, autorizacion granular real.
- En contra: el rol queda congelado hasta que expira el token (MobilityIA 8h, BackOffice 1h).

**B — Re-consultar y cachear** (ManageIT para si mismo)

Releer el rol de la base o del accessMatrix en cada request, con cache en memoria de vida corta.

- A favor: el rol es fresco; un cambio de permisos aplica casi de inmediato.
- En contra: estado en memoria, y acopla la latencia al proveedor de identidad.

Recomendacion: **A** para apps con roles estables, **B** si se necesita revocacion inmediata.

---

## Trabajo pendiente

Ninguna de estas tareas fue ejecutada. Cada una toca un repositorio distinto y necesita su propia
branch, su propia validacion y — en el caso de ManageIT — acuerdo con quien lo mantiene.

| # | App | Tarea | Prioridad |
|---|---|---|---|
| 1 | MobilityManager | Emitir token propio con el rol (patron A) y reemplazar `AdminGuard` por un guard de rol. Corrige de paso que `MOBILITYMGR_SUPERADMIN` no pueda escribir en Regiones | alta |
| 2 | MobilityManager | Dejar asentado en el codigo que `RoleGuard` del front es UX, no seguridad, y que toda ruta sensible necesita guard server-side | alta |
| 3 | DuwyDashy + endpoints | Revalidar la politica "sin diferenciacion de roles". Si sigue vigente, documentarlo en el propio `requireAdmin.js`; si no, aplicar patron A | alta |
| 4 | DuwyDashy + endpoints | Firmar el token del modo iframe en vez de validarlo por prefijo de string | alta |
| 5 | ManageIT | Evaluar incluir los roleKeys de la app solicitada en el JWT. **Lo arreglaria en el origen para todo el ecosistema** y volveria innecesarios los tokens propios | media, alto impacto |
| 6 | ManageIT | Revisar si `isAdmin` deberia calcularse por `appId` en vez de global. Es un cambio con riesgo de regresion: hoy varias apps dependen de ese comportamiento | media |
| 7 | DuwyChat | Implementar lo que describe su `docs/ROLES_AND_PERMISSIONS.md`, o borrar el documento | baja |
| 8 | MobilityManager | **Bug**: acotar el timer de expiracion de sesion en `apps/web/src/auth/AuthProvider.tsx:122` | media |

### Detalle de la tarea 8

`MobilityManager/apps/web/src/auth/AuthProvider.tsx:122`:

```ts
timer = window.setTimeout(logout, Math.max(0, expMs - Date.now()));
```

`setTimeout` guarda el delay en **32 bits con signo**: cualquier valor mayor a `2147483647`
(unos 24.8 dias) se trunca y el timer dispara **de inmediato**. Con un token de expiracion
lejana, el usuario queda deslogueado apenas entra.

Hoy no se manifiesta porque el token de ManageIT vence en 1 hora, pero es una bomba de tiempo:
basta con que alguien suba el `expiresIn` para que la app se vuelva inusable, y el sintoma
(«me saca al login apenas entro») no apunta para nada a la causa.

BackOffice lo corrigio armando el timer solo si el restante entra en el rango, y dejando el
re-chequeo al volver el foco para lo demas. Detectado por un test de integracion, no por
revision de codigo.

La tarea **5 es la de mayor retorno**: resuelve la causa raiz en el proveedor de identidad. Las
demas son mitigaciones por app. Conviene evaluarla antes de replicar el patron A en cada sistema.

---

## Referencia

El detalle del diseño de autenticacion de BackOffice, incluida la comparacion completa, esta en
`docs/AUTENTICACION.md`.
