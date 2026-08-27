# Roles y Permisos — Mobility BackOffice

> Última actualización: 2026-08-27 · Versión: 2.12.0
>
> Qué puede hacer cada rol, cómo se decide, y cómo se registra en ITManager.

---

## 1. Lo primero que hay que entender

**El rol no se deriva del email ni del perfil de SAP.** Lo decide **ITManager**: a cada
usuario se le asigna la app `MobilityBackOffice` y uno o más `RoleKey`. BackOffice lee
esa asignación al iniciar sesión y la firma en su propio token.

**Sin rol asignado en esta app, el login responde 403.** No hay acceso por defecto.

Y la regla que más sorprende:

> **La app resuelve UN SOLO rol por usuario.** Si alguien tiene varios, gana el de mayor
> prioridad y **pierde lo que daban los otros**. Ver §5.

---

## 2. Los cinco roles

| RoleKey (ITManager) | Rol en la app | Prioridad | Qué ve |
|---|---|---|---|
| `MOBILITYBO_SUPERADMIN` | **SuperAdmin** | 1 (gana a todos) | Absolutamente todo, incluida la consola de soporte y cualquier sección futura |
| `MOBILITYBO_SUPPORT` | **Soporte** | 2 | **Solo** la consola de soporte |
| `MOBILITYBO_USER` | **Usuario** | 3 | Todo **menos** la consola de soporte y lo exclusivo de SuperAdmin |
| `MOBILITYBO_ADMIN` | **Administrador** | 4 | Regiones comerciales |
| `MOBILITYBO_MARKETING` | **Marketing** | 5 | Documentación del RAG, Templates de WhatsApp |

### Qué implica cada uno

**SuperAdmin** — acceso total. No hace falta listarlo en ninguna regla: el guard lo deja
pasar siempre, y por eso una sección nueva le queda accesible sin tocar nada. Es también
el único rol que combina el back-office con la consola de soporte.
`isAdmin` de ITManager (el administrador de IT) resuelve a SuperAdmin automáticamente.

**Soporte** — rol **técnico y exclusivo del DevelopersTeam**. Da acceso a la consola que
audita y corrige órdenes y cotizaciones del flujo Mobility: puede aprobar, rechazar y
contraofertar líneas y plazos de pago, volver un documento a un estado anterior y
anularlo. **No** da acceso a Regiones ni a Marketing.
Es el único rol que toca documentos de negocio, y por eso está separado del resto.
Ver `docs/SPEC_CONSOLA_SOPORTE.md`.

**Usuario** — el rol del día a día. **Todo el back-office menos la consola de soporte y
menos lo que sea exclusivo de SuperAdmin.**
Hoy eso significa Regiones comerciales + Documentación del RAG + Templates de WhatsApp, y
**cualquier sección que se agregue en el futuro** salvo que sea de soporte o que se
declare como exclusiva de SuperAdmin (`roles: ['SuperAdmin']`).
No es "SuperAdmin sin la consola": SuperAdmin además entra a la consola y a la matriz
de autorizadores.

**Administrador** — solo Regiones comerciales: vincular CEBEs y sociedades a las regiones.
Queda como rol acotado para quien solo tenga que mantener ese dato maestro.

**Marketing** — solo las herramientas de marketing: el cargador de documentación del RAG
y (cuando exista) los templates de WhatsApp.

---

## 3. Qué ve cada rol, sección por sección

| Sección | SuperAdmin | Soporte | Usuario | Administrador | Marketing |
|---|:--:|:--:|:--:|:--:|:--:|
| Inicio | ✓ | ✓ | ✓ | ✓ | ✓ |
| Regiones comerciales | ✓ | — | ✓ | ✓ | — |
| Documentación del RAG | ✓ | — | ✓ | — | ✓ |
| Templates de WhatsApp *(próximamente)* | ✓ | — | ✓ | — | ✓ |
| **Consola de soporte** | ✓ | ✓ | **—** | — | — |
| **Matriz de autorizadores** *(próximamente)* | ✓ | — | **—** | **—** | **—** |
| *Cualquier sección futura no-soporte* | ✓ | — | ✓ | — | — |

"Inicio" es fijo y siempre visible; muestra solo las tarjetas de las secciones que el rol
puede abrir.

### Y en el backend

| Endpoint | Roles que pasan |
|---|---|
| `/api/auth/*` | Cualquiera autenticado (el login es lo que asigna el rol) |
| `/api/health` | Público |
| `/api/regions/*` | Administrador, Usuario, SuperAdmin |
| `/rag/*` (proxy) | Marketing, Usuario, SuperAdmin |
| `/api/support/*` | **Soporte, SuperAdmin** |
| `/api/regions/sync` | Ninguno — se autentica por API key (máquina a máquina) |

> **La UI oculta; el backend prohíbe.** Esconder una sección es comodidad, no seguridad:
> quien llame la API directamente choca contra `RolesGuard`. Las dos capas tienen que
> decir lo mismo, y por eso las reglas viven en un solo lugar de cada lado
> (`roleAccess.ts` en el front, `@Roles` + `RolesGuard` en el back).

---

## 4. Cómo se decide el rol, paso a paso

1. El usuario se autentica contra ITManager.
2. ITManager devuelve el **accessMatrix**: los `RoleKey` que tiene para esta app.
3. `RoleResolver` traduce cada `RoleKey` al rol de la app y **se queda con el de mayor
   prioridad**.
4. Ese rol se firma en el token propio de BackOffice.
5. `RolesGuard` autoriza cada request contra ese claim.

El guard **no acepta `isAdmin` como sustituto** dentro de las rutas: ese flag es global de
ManageIT y lo traería en `true` un superadmin de otro sistema que no tiene nada asignado
acá. La autoridad es el claim `role`, resuelto contra el accessMatrix de esta app.

---

## 5. ⚠️ Un solo rol: qué pasa con las combinaciones

Como gana uno solo, **toda combinación pierde algo**:

| Si le asignás | Resuelve a | Consecuencia |
|---|---|---|
| `ADMIN` + `MARKETING` | Administrador | **Pierde Marketing.** Conviene asignar `USER`, que abarca los dos |
| `USER` + `ADMIN` | Usuario | Sin pérdida: Usuario ya incluye Regiones |
| `USER` + `MARKETING` | Usuario | Sin pérdida: Usuario ya incluye Marketing |
| **`USER` + `SUPPORT`** | **Soporte** | **Pierde todo el resto del back-office** |
| `ADMIN` + `SUPPORT` | Soporte | **Pierde Regiones** |
| cualquiera + `SUPERADMIN` | SuperAdmin | Sin pérdida: ve todo |

> **Regla práctica: quien necesite la consola de soporte Y el resto del back-office va con
> `MOBILITYBO_SUPERADMIN`.** Es la única combinación que funciona.

Por qué `Usuario` va arriba de Administrador y Marketing: porque los **contiene** a los
dos. Si ganara uno de ellos, el usuario perdería la otra mitad del back-office.

Por qué `Soporte` va arriba de `Usuario`: porque se asigna **deliberadamente**. Si alguien
lo tiene, es porque se espera que opere la consola. La contrapartida está en la tabla de
arriba y es conocida (riesgo R2 del spec de la consola).

---

## 6. Permisos

Prefijo `MOBILITYBO_`. La app los recibe **sin** el prefijo (`REGIONS_VIEW`, etc.).

| PermissionKey | En la app | Descripción | Estado |
|---|---|---|---|
| `MOBILITYBO_REGIONS_VIEW` | `REGIONS_VIEW` | Ver regiones, vínculos y diagnósticos | en uso (por rol) |
| `MOBILITYBO_REGIONS_LINK` | `REGIONS_LINK` | Vincular y desvincular CEBEs | en uso (por rol) |
| `MOBILITYBO_RAG_ACCESS` | `RAG_ACCESS` | Acceder al cargador del RAG | en uso (por rol) |
| `MOBILITYBO_TEMPLATES_VIEW` | `TEMPLATES_VIEW` | Ver plantillas de WhatsApp | pendiente (feature) |
| `MOBILITYBO_TEMPLATES_MANAGE` | `TEMPLATES_MANAGE` | Crear/editar/eliminar plantillas | pendiente (feature) |
| `MOBILITYBO_SUPPORT_VIEW` | `SUPPORT_VIEW` | Buscar documentos y ver su línea de tiempo | en uso (por rol) |
| `MOBILITYBO_SUPPORT_OVERRIDE` | `SUPPORT_OVERRIDE` | Corregir documentos del flujo | en uso (por rol) |
| `MOBILITYBO_USER_ACCESS` | `USER_ACCESS` | Uso general del back-office | en uso (por rol) |

### Mapeo Rol → Permiso

| Rol | Permisos |
|---|---|
| SuperAdmin | todos |
| Soporte | SUPPORT_VIEW, SUPPORT_OVERRIDE |
| Usuario | USER_ACCESS, REGIONS_VIEW, REGIONS_LINK, RAG_ACCESS, TEMPLATES_VIEW, TEMPLATES_MANAGE — **ningún permiso de soporte** |
| Administrador | REGIONS_VIEW, REGIONS_LINK |
| Marketing | RAG_ACCESS, TEMPLATES_VIEW, TEMPLATES_MANAGE |

> **Los permisos hoy no autorizan nada.** La app autoriza **por rol**: `RolesGuard` mira
> el claim `role`, y el proxy del RAG mira la misma lista. Los permisos se extraen del
> accessMatrix al iniciar sesión y quedan en la sesión, pero **ningún guard los verifica**.
>
> Existen para que el registro en ITManager quede completo y para poder separar "ver" de
> "gestionar" dentro de una misma sección el día que haga falta, **sin volver a tocar
> ITManager**. Definirlos ahora no cambia el comportamiento.

---

## 7. Cómo aplicarlo

### Registrar los roles (una vez por entorno)

Correr contra la base del entorno, con SSMS o `sqlcmd -I`:

| Script | Qué agrega |
|---|---|
| `001_RegisterMobilityBackOfficeApp.sql` | La Application + SuperAdmin, Administrador, Marketing y sus permisos |
| `006_AddSupportRole.sql` | Rol Soporte + SUPPORT_VIEW + SUPPORT_OVERRIDE |
| `007_AddUserRole.sql` | Rol Usuario + USER_ACCESS + herencia de los permisos de Administrador y Marketing |

Los tres son **idempotentes y aditivos**: crean lo que falte, no duplican ni borran. El
006 y el 007 exigen que el 001 haya corrido antes — sin la Application, el rol no tiene
dónde colgarse y el accessMatrix no lo devolvería.

El 007 hereda los permisos de Administrador y Marketing copiándolos, y **excluye
explícitamente los que empiezan con `MOBILITYBO_SUPPORT`**: heredarlos por accidente sería
el peor error posible acá.

Estado por entorno en `docs/DEPLOY_SQL_PENDIENTE.md`.

### Asignar un rol a una persona

En ITManager: asignarle la app **MobilityBackOffice** y **un** `MOBILITYBO_*`. Los
permisos vienen con el rol por el mapeo. Sin rol asignado, el login responde 403.
Ver `docs/AUTENTICACION.md`.

---

## 8. Dónde vive cada cosa en el código

| Qué | Dónde |
|---|---|
| Los cinco roles | `apps/api/src/auth/backoffice-role.enum.ts` |
| RoleKey → rol, y la prioridad | `apps/api/src/auth/role-resolver.service.ts` |
| La autorización del backend | `apps/api/src/auth/roles.guard.ts` + `@Roles(...)` en cada controller |
| El proxy del RAG | `apps/api/src/rag/rag.proxy.ts` (`ALLOWED_ROLES`) |
| La visibilidad del frontend | `apps/web/src/auth/roleAccess.ts` |
| Qué secciones existen y quién las ve | `apps/web/src/config/sections.tsx` |
| Espejo del enum en el front | `apps/web/src/types.ts` |

### Al agregar una sección nueva

1. Sumarla a `NAV_SECTIONS` con los roles que la ven.
2. Agregar su `<RoleGuard allow={[...]}>` en `App.tsx`.
3. Poner `@Roles(...)` en su controller.

**`Usuario` no hay que listarlo**: la regla en `roleAccess.ts` le da acceso a todo lo que
no pida `Soporte`. Lo que sí hay que recordar es lo contrario — marcar la sección como de
Soporte si corresponde —, que es justo lo que no se olvida, porque es el motivo por el que
se creó la sección.

**Para una sección exclusiva de SuperAdmin**, poner `roles: ['SuperAdmin']`. Listarlo
explícitamente es redundante para el propio SuperAdmin (ya pasa siempre), pero es lo que
`roleAccess.ts` mira para dejar afuera a `Usuario`: sin eso, la exclusión por defecto se
la dejaría visible.
