# Variables de Entorno — Mobility BackOffice

> Ultima actualizacion: 2026-07-20
> Version: 1.0.0

Fuente de verdad del backend: `apps/api/src/config/env.validation.ts` (Joi) y
`apps/api/src/config/configuration.ts`. Si falta una variable **requerida**, el arranque falla.

## Backend — requeridas

| Variable | Descripcion | Ejemplo | Donde se usa |
|---|---|---|---|
| `DATABASE_URL` | Cadena SQL Server. Base **compartida** con MobilityManager; solo cliente Prisma | `sqlserver://host:1433;database=Mobility_QATEST;...` | `apps/api/src/prisma/prisma.service.ts` |
| `ITMANAGER_AUTH_URL` | Base URL de la API de ITManager (ManageIT) | `http://100.66.245.49:61100/api` | `apps/api/src/auth/itmanager.client.ts` |
| `BACKOFFICE_JWT_SECRET` | Secret HS256 **propio** para firmar el token de BackOffice. Minimo 16 caracteres. **No reutilizar el de ManageIT**: si se comparte, un token de otra app validaria aca | `***` | `apps/api/src/auth/token.service.ts` |

> **Cambio respecto de la version 0.1.0**: `JWT_SECRET` (compartido con ManageIT) fue reemplazada
> por `BACKOFFICE_JWT_SECRET` (propio). Motivo: BackOffice pasa a emitir su propio JWT con el rol
> adentro, porque el token de ManageIT no incluye los roleKeys. Ver `docs/AUTENTICACION.md`.

## Backend — opcionales

| Variable | Descripcion | Default | Donde se usa |
|---|---|---|---|
| `PORT` | Puerto del servidor | `3010` | `apps/api/src/main.ts` |
| `NODE_ENV` | Entorno (`development` \| `test` \| `production`) | `development` | `apps/api/src/main.ts` |
| `CORS_ORIGIN` | Origen permitido para CORS | `http://localhost:5183` | `apps/api/src/main.ts` |
| `APP_ID` | Identificador de la app en ITManager | `MobilityBackOffice` | `apps/api/src/config/configuration.ts` |
| `PERM_PREFIX` | Prefijo de permisos/roles en ITManager | `MOBILITYBO_` | `apps/api/src/config/configuration.ts` |
| `JWT_EXPIRES_IN` | Vigencia del token propio. El rol queda congelado hasta que expira | `1h` | `apps/api/src/auth/token.service.ts` |
| `REGIONS_SYNC_API_KEY` | Key del sync maquina-a-maquina (`x-api-key`). **Vacia o ausente = endpoint deshabilitado (403)**, no 500 | vacio | `apps/api/src/regions/api-key.guard.ts` (fase 4) |

## Frontend

| Variable | Descripcion | Default | Donde se usa |
|---|---|---|---|
| `VITE_API_URL` | Base URL de la API. **Debe quedar vacia** | vacio | `apps/web/src/api/httpClient.ts` (fase 3) |

**Por que vacia**: el front usa rutas relativas (`/api`) contra el mismo origen. En desarrollo
Vite proxyea `/api` al backend en `:3010`; en produccion el backend sirve el build. Setear esta
variable hornea una URL absoluta en el build y rompe el login desde cualquier otra maquina
(`ERR_CONNECTION_REFUSED`).

## Diferencias con MobilityManager

BackOffice **no hereda** las variables de MobilityManager para DuwyDashy, DuwyChat,
MobilityMiddleWare, geolocalizacion ni Azure OpenAI. Se incorporaran cuando lleguen las fases
de Marketing (templates WhatsApp) y RAG.
