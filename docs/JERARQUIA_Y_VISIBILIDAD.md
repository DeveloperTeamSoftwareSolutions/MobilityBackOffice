# Jerarquia y visibilidad — Mobility BackOffice

> Ultima actualizacion: 2026-07-21
> Version: 1.0.0

Matriz de que ve cada rol, con que endpoint. Documento vivo: actualizar en cada iteracion que
agregue o cambie una seccion.

## Roles

Los define ITManager (app `MobilityBackOffice`). El login los resuelve por prioridad y firma el
rol dentro del token propio. Ver `docs/AUTENTICACION.md`.

| Rol | RoleKey en ITManager | Alcance |
|---|---|---|
| SuperAdmin | `MOBILITYBO_SUPERADMIN` | Todo el back-office. Pasa cualquier `@Roles` |
| Administrador | `MOBILITYBO_ADMIN` | Regiones comerciales |
| Marketing | `MOBILITYBO_MARKETING` | Templates de WhatsApp, carga del RAG (pendientes) |

## Matriz por seccion

| Seccion | SuperAdmin | Administrador | Marketing | Guard server-side |
|---|---|---|---|---|
| Inicio | si | si | si | `JwtGuard` |
| Regiones comerciales | si | si | **no** | `@Roles(Administrador)` + `RolesGuard` |
| Templates de WhatsApp | si | no | si | pendiente (fase Marketing) |
| Documentacion del RAG | si | no | si | pendiente (fase Marketing) |

El `RoleGuard` del frontend oculta lo que no corresponde, pero **no es la barrera**: la decision
la toma el guard del backend. Ver la nota de seguridad en `docs/AUTENTICACION.md`.

## Regiones comerciales — SIN eje jerarquico

**Importante, y distinto de otras secciones del ecosistema**: el modulo de Regiones **no filtra
por la jerarquia de usuarios** (subarbol SAP, cartera, pais). No hay `ScopeService` en juego.

- Todo Administrador ve **todas** las regiones y **todos** sus vinculos CEBE-sociedad.
- No hay recorte por quien es el usuario mas alla del rol.

La razon es que el mapa region-CEBE es **dato maestro global**, no datos operativos de una
cartera: define como se consolidan los reportes para toda la organizacion, asi que no tendria
sentido que cada administrador viera un subconjunto. Esto se decidio al portar el modulo desde
MobilityManager, donde tampoco tenia eje jerarquico (el plan original contemplaba integrarlo y
quedo sin hacer; aca se resuelve explicitamente que **no** lo lleva).

Si en el futuro se necesitara acotar por region a ciertos usuarios, seria un cambio de diseño
nuevo, no un ajuste: habria que introducir el eje que hoy deliberadamente no existe.

## Diferencia con MobilityManager

En MM las lecturas de Regiones estaban abiertas a cualquier autenticado porque las consumian
reportes externos via `/:code/resolve`. En BackOffice el unico consumidor es esta UI, y todo el
modulo exige rol Administrador (lecturas incluidas): dejar el mapa legible para Marketing
contradiria que la seccion no se le muestre. Si un reporte necesitara `/resolve`, la via es el
sync por API key o sumar el rol al decorador. Ver `docs/API_ENDPOINTS.md`.
