# Roles y Permisos — Mobility BackOffice (ITManager)

> Ultima actualizacion: 2026-07-22
> Version: 1.2.0

Define lo que se registra en ITManager para la app `MobilityBackOffice`: roles,
permisos y el mapeo entre ellos. Todo lo crea, idempotente, el script
`apps/api/prisma/sql/001_RegisterMobilityBackOfficeApp.sql`.

## Como funciona la autorizacion hoy

- **La app autoriza por ROL**, no por permiso. `RolesGuard` (backend) chequea el claim
  `role` del token propio; el proxy del RAG chequea rol Marketing/SuperAdmin.
- Los **permisos** se extraen del accessMatrix en el login y quedan en la sesion
  (`permissions`, sin el prefijo `MOBILITYBO_`). Hoy **ningun guard los verifica**:
  estan disponibles para chequeos mas finos cuando se necesiten (p. ej. distinguir
  "ver" de "gestionar" dentro de una misma seccion).
- Por eso definirlos ahora no cambia el comportamiento: deja el registro en ITManager
  completo y consistente, y habilita granularidad futura sin volver a tocar ITManager.

## Roles

| RoleKey (ITManager) | Rol en la app | Prioridad | Que ve |
|---|---|---|---|
| `MOBILITYBO_SUPERADMIN` | SuperAdmin | 1 (mayor) | Todo |
| `MOBILITYBO_ADMIN` | Administrador | 2 | Regiones comerciales |
| `MOBILITYBO_MARKETING` | Marketing | 3 | Documentacion del RAG, Templates de WhatsApp |

Si un usuario tiene varios, gana el de mayor prioridad. El login mapea el RoleKey al
rol y lo firma en el token. `isAdmin` de ITManager (admin de IT) resuelve a SuperAdmin.

## Permisos

Prefijo `MOBILITYBO_`. La app los recibe **sin** el prefijo (`REGIONS_VIEW`, etc.).

| PermissionKey | En la app | Descripcion | Estado |
|---|---|---|---|
| `MOBILITYBO_REGIONS_VIEW` | `REGIONS_VIEW` | Ver regiones, vinculos y diagnosticos | en uso (por rol) |
| `MOBILITYBO_REGIONS_LINK` | `REGIONS_LINK` | Vincular y desvincular CEBEs | en uso (por rol) |
| `MOBILITYBO_RAG_ACCESS` | `RAG_ACCESS` | Acceder al cargador del RAG | en uso (por rol) |
| `MOBILITYBO_TEMPLATES_VIEW` | `TEMPLATES_VIEW` | Ver plantillas de WhatsApp | pendiente (feature) |
| `MOBILITYBO_TEMPLATES_MANAGE` | `TEMPLATES_MANAGE` | Crear/editar/eliminar plantillas | pendiente (feature) |

## Mapeo Rol -> Permiso

| Rol | Permisos |
|---|---|
| SuperAdmin | REGIONS_VIEW, REGIONS_LINK, RAG_ACCESS, TEMPLATES_VIEW, TEMPLATES_MANAGE (todos) |
| Administrador | REGIONS_VIEW, REGIONS_LINK |
| Marketing | RAG_ACCESS, TEMPLATES_VIEW, TEMPLATES_MANAGE |

## Como aplicarlo en ITManager

Correr `001_RegisterMobilityBackOfficeApp.sql` contra la base del entorno (SSMS o
sqlcmd con `-I`). Es idempotente: crea lo que falte, no duplica ni borra. Estado por
entorno en `docs/DEPLOY_SQL_PENDIENTE.md`.

Luego, a cada usuario: asignarle la app **MobilityBackOffice** y un rol
`MOBILITYBO_*` en ITManager (los permisos vienen con el rol via el mapeo). Sin rol
asignado, el login responde 403. Ver `docs/AUTENTICACION.md`.

## Estado verificado en QATEST — 2026-07-22

- 3 roles, 5 permisos, 10 mapeos rol-permiso. Script re-ejecutado: sin duplicados.
