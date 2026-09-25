# Consistencia de datos — especificacion

> Ultima actualizacion: 2026-09-25 · Version: 2.44.0
>
> Jerarquia comercial, carteras, usuarios y SAP que no cierran entre si, y su correccion.
> Seccion **exclusiva de SuperAdmin**.

---

## 1. El problema que resuelve

La jerarquia comercial (`CommercialTeamMembers`), los duenos de cartera
(`PortfolioOwnerHistory`), los usuarios de Mobility y SAP se cargan por caminos distintos y
nadie los cruza. Cuando no cierran, el sintoma aparece lejos de la causa:

- Un vendedor con cartera activa que no cuelga de ningun nodo **no lo ve nadie de su cadena**
  (`fn_UsersVisibleByUser` / `fn_PortfoliosVisibleByUser`) y la app comercial le muestra la
  cartera vacia. Es lo que paso con Ana Gonzalez (2100218).
- La misma persona figura en la jerarquia con el SapUserId de **otra sociedad** (Andres Gonzalez
  Giraldo: 2100185 en su usuario y su cartera, 2000033 en la jerarquia).

El relevamiento de PROD del 2026-09-25
(`MobilityMiddleWare/docs/JERARQUIA_COMERCIAL_ALTAS_PENDIENTES_PROD_2026-09-25`) encontro 81
personas con cartera y sin jerarquia, 94 con rol comercial sin cartera ni jerarquia, 10 miembros
sin SapUserId, etc. Se hizo a mano, cruzando ocho endpoints. Esta seccion lo hace en vivo y
permite **corregir** lo que es dato comercial, dejando traza de quien y por que.

---

## 2. Que se corrige aca y que no

| Resolucion | Que es | En la pantalla |
|---|---|---|
| **Se corrige aca** (`BACKOFFICE`) | Jerarquia comercial y dueno de cartera | Formularios de correccion |
| **Resolver en ITManager** (`ITMANAGER`) | Roles de Mobility y datos de `Users` (SapUserId del usuario, email) | Solo la marca, sin botones |
| **Revisar** (`REVISAR`) | Puede ser correcto o no; no hay una correccion unica | Segun el caso |

**Por que roles y usuarios no:** los administra ITManager. Si BackOffice tambien los escribiera
tendrian dos duenos que se pisan, y la auditoria de ITManager no veria el cambio.

**Clientes contra SAP** (cliente que SAP asigna al vendedor y la cartera no tiene, cliente que
no esta en el maestro, etc.) se muestran **solo lectura**: se resuelven en SAP o en el sync de
clientes, no editando un dato aca.

**No es inconsistencia:** un cliente en mas de un portfolio. Es valido por regla de negocio.

---

## 3. De donde sale el dato

Todo lo calcula **MobilityMiddleWare**. BackOffice no recalcula nada: si la regla viviera en
dos lugares, la pantalla y el motor terminarian diciendo cosas distintas.

| Pestaña | Middleware | Minimo |
|---|---|---|
| Jerarquia comercial · Carteras · Usuarios vs SAP | `/mobility/backoffice-consistency/*` | **MW 1.378.0** (PR #729) |
| Clientes vs SAP | `/v2/mobility/portfolio-gaps` | PR #727 del MW + su SQL (`DEPLOY_PROD_2026-09-25_CarteraPorSociedad.sql`) |

Con un middleware sin `portfolio-gaps`, la pestaña de clientes dice **"Todavia no esta
disponible en este ambiente"** (`available: false`) en vez de mostrar una lista vacia que se
leeria como "no hay problemas".

El cruce se cachea 60 s en el middleware. "Actualizar" lo recalcula (`refresh=1`) y toda
correccion lo invalida.

---

## 4. Los grupos

| Pestaña | Grupo | Regla | Correccion |
|---|---|---|---|
| Jerarquia | Con cartera activa y sin alta en la jerarquia | Asignacion activa en `PortfolioOwnerHistory` y ninguna fila en `CommercialTeamMembers` con ese SapUserId | Alta en un nodo |
| Jerarquia | En la jerarquia con otro SapUserId o sin id | Hay un miembro que es la misma persona (mismo `GuidUsers`, o mismo nombre) con otro id | Corregir el SapUserId del miembro — **no** es un alta |
| Jerarquia | Rol comercial, sin cartera y sin jerarquia | Rol `VENDEDOR`/`PROMOTOR`/`GERENTE_CARTERA` de Mobility | Alta en un nodo, o quitar el rol en ITManager |
| Jerarquia | Rol comercial sin SapUserId | | ITManager |
| Jerarquia | Miembro sin SapUserId | Invisible para todo cruce | Completar el id (se sugiere el del usuario) o dar de baja |
| Jerarquia | Vendedor sin cartera activa | | Baja del miembro |
| Jerarquia | SapUserId repetido | La misma persona en mas de un nodo | Revisar; baja de la fila que sobra |
| Carteras | Cartera sin dueno comercial activo | Severidad alta si tiene clientes | Asignar dueno |
| Carteras | Dueno distinto del historial | La ficha de la cartera y la asignacion vigente no coinciden | Revisar |
| Usuarios vs SAP | Comercial sin cuenta SAP activa | Su SapUserId esta de Baja o no existe en SAP | Baja del miembro y reasignar su cartera |
| Usuarios vs SAP | Usuario con rol comercial sin cuenta SAP activa | | ITManager |
| Usuarios vs SAP | Email distinto al de SAP | | ITManager |

La regla exacta de cada grupo esta en `MobilityMiddleWare/docs/API_BACKOFFICE_CONSISTENCY.md`.

---

## 5. Las correcciones

| Accion | Que escribe el middleware |
|---|---|
| Alta en la jerarquia | Fila nueva en `CommercialTeamMembers` (nodo, SapUserId, nombre, rol) |
| Corregir SapUserId | Solo el `SapUserId` del miembro. Viaja el valor **que se vio en pantalla**: si alguien lo cambio en el medio, 409 en vez de pisarlo |
| Baja del miembro | Soft delete (`DeletedTimestamp`) |
| Asignar dueno | Asignacion activa `COMERCIAL` en `PortfolioOwnerHistory` + alinea el dueno en `Portfolios`. 409 si ya tiene uno |

Reglas comunes:

- **Motivo obligatorio** (5 a 500 caracteres). Queda en las dos auditorias.
- **Quien actua sale del token**. El cliente nunca manda un email de actor.
- **Dos auditorias**:
  - el middleware escribe `Auditories` **en la misma transaccion** que el cambio (antes,
    despues, app, rol, motivo): si esa fila no se puede escribir, el cambio no queda;
  - BackOffice escribe `AuditLogs` (categoria `Consistency`), la auditoria central que se
    consulta desde ITManager. Es best-effort: el cambio ya ocurrio.
- **Decir si quedo o no.** Toda respuesta de error del middleware significa que no se aplico
  (la transaccion se deshace). Solo cuando no hubo respuesta (red, tiempo) no se sabe, y la
  pantalla pide actualizar antes de reintentar en vez de invitar a repetir un alta.

---

## 6. Por que solo SuperAdmin

Corrige datos compartidos con MobilityManager y con la app de Mobility, sin el recorte por
sociedad del resto de las secciones. `Usuario` no la ve (regla general de las secciones
declaradas `roles: ['SuperAdmin']`, ver `docs/ROLES_Y_PERMISOS.md`).

---

## 7. Deploy

1. **MobilityMiddleWare 1.378.0** (PR #729). No lleva SQL. Requiere `MIDDLEWARE_API_KEY`
   seteada en el middleware: sin ella `requireApiKey` no bloquea nada.
2. **BackOffice 2.44.0**.
3. La pestaña **Clientes vs SAP** se enciende sola cuando el ambiente tenga el PR #727 del
   middleware y su SQL aplicado.
