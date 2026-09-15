# Variables de Entorno — Mobility BackOffice

> Ultima actualizacion: 2026-08-31
> Version: 2.19.0

Fuente de verdad del backend: `apps/api/src/config/env.validation.ts` (Joi) y
`apps/api/src/config/configuration.ts`. Si falta una variable **requerida**, el arranque falla.

## Backend — requeridas

| Variable | Descripcion | Ejemplo | Donde se usa |
|---|---|---|---|
| `ITMANAGER_AUTH_URL` | Base URL de la API de ITManager (ManageIT) | `http://100.66.245.49:61100/api` | `apps/api/src/auth/itmanager.client.ts` |
| `BACKOFFICE_JWT_SECRET` | Secret HS256 **propio** para firmar el token de BackOffice. Minimo 16 caracteres. **No reutilizar el de ManageIT**: si se comparte, un token de otra app validaria aca | `***` | `apps/api/src/auth/token.service.ts` |

> **Cambio v2.0.0**: BackOffice dejo de conectarse a SQL Server. `DATABASE_URL` y Prisma
> **se eliminaron**: toda la data va por el MobilityMiddleWare (ver `MIDDLEWARE_URL`).

> **Cambio respecto de la version 0.1.0**: `JWT_SECRET` (compartido con ManageIT) fue reemplazada
> por `BACKOFFICE_JWT_SECRET` (propio). Motivo: BackOffice pasa a emitir su propio JWT con el rol
> adentro, porque el token de ManageIT no incluye los roleKeys. Ver `docs/AUTENTICACION.md`.

## Backend — opcionales

| Variable | Descripcion | Default | Donde se usa |
|---|---|---|---|
| `MIDDLEWARE_URL` | Base URL del MobilityMiddleWare (incluye `/api`). Fuente de TODA la data. En prod: el mismo Middleware que MobilityManager | `http://localhost:6002/api` | `apps/api/src/common/middleware-request.ts` |
| `MIDDLEWARE_API_KEY` | Key para el header `x-api-key` del Middleware. Si el Middleware no la exige, es no-op (opcional) | vacio | `apps/api/src/common/middleware-request.ts` |
| `PORT` | Puerto del servidor | `3010` | `apps/api/src/main.ts` |
| `NODE_ENV` | Entorno (`development` \| `test` \| `production`) | `development` | `apps/api/src/main.ts` |
| `CORS_ORIGIN` | Origen permitido para CORS | `http://localhost:5183` | `apps/api/src/main.ts` |
| `APP_ID` | Identificador de la app en ITManager | `MobilityBackOffice` | `apps/api/src/config/configuration.ts` |
| `PERM_PREFIX` | Prefijo de permisos/roles en ITManager | `MOBILITYBO_` | `apps/api/src/config/configuration.ts` |
| `JWT_EXPIRES_IN` | Vigencia del token propio. El rol queda congelado hasta que expira | `1h` | `apps/api/src/auth/token.service.ts` |
| `REGIONS_SYNC_API_KEY` | Key del sync maquina-a-maquina (`x-api-key`). **Vacia o ausente = endpoint deshabilitado (403)**, no 500 | vacio | `apps/api/src/regions/api-key.guard.ts` (fase 4) |
| `RAG_URL` | Base URL de DuwyEngineRAG. Sin ella, el proxy `/rag` no se monta y la seccion "Documentacion del RAG" no carga | — | `apps/api/src/main.ts`, `apps/api/src/rag/rag.proxy.ts` |
| `WABA_API_URL` | Base del panel WABA (ej. `http://localhost:3020`). Sin ella la seccion de plantillas queda deshabilitada | — | `src/templates/templates.client.ts` |
| `WABA_API_KEY` | API key de la cuenta WABA (`WabaAccounts.ApiKey`). **La cuenta es implicita en la key** | — | idem |

## Frontend

| Variable | Descripcion | Default | Donde se usa |
|---|---|---|---|
| `VITE_API_URL` | Base URL de la API. **Debe quedar vacia** | vacio | `apps/web/src/api/httpClient.ts` (fase 3) |

**Por que vacia**: el front usa rutas relativas (`/api`) contra el mismo origen. En desarrollo
Vite proxyea `/api` al backend en `:3010`; en produccion el backend sirve el build. Setear esta
variable hornea una URL absoluta en el build y rompe el login desde cualquier otra maquina
(`ERR_CONNECTION_REFUSED`).

## Nota de deploy — `.env` / `.env.example`

Al pasar de v1.2.0 a v2.0.0 hay que **actualizar el `.env`** de cada entorno:

- **Quitar** `DATABASE_URL` (ya no se usa; su presencia es inofensiva pero es ruido).
- **Agregar** `MIDDLEWARE_URL`. En dev el default (`http://localhost:6002/api`) ya sirve, asi
  que no es obligatorio setearla; en prod apuntarla al Middleware de produccion.
- `MIDDLEWARE_API_KEY` solo si el Middleware exige key.

## Diferencias con MobilityManager

BackOffice **no hereda** las variables de MobilityManager para DuwyDashy, DuwyChat,
geolocalizacion ni Azure OpenAI. Se incorporaran cuando lleguen las fases de Marketing
(templates WhatsApp). El acceso a datos (`MIDDLEWARE_URL`) **si** es compartido: ambas apps
consumen el mismo Middleware.
