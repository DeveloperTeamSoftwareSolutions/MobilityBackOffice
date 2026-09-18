# Almacenes y Centros de Distribución — Spec

> Última actualización: 2026-09-18 · Versión: 2.35.0
> Estado: **planificado, sin código**. La sección existe hoy en **MobilityManager** y se traspasa acá
> por decisión del proyecto: BackOffice centraliza la configuración administrativa.
> Requiere Middleware **≥ 1.357.0** (es donde aparece la reserva por grupo de clientes).
> Plan del traspaso, con el detalle de lo que se mueve: `MobilityManager/docs/PLAN_TRASPASO_ALMACENES_A_BACKOFFICE.md`.

## Qué resuelve

Un almacén puede quedar **reservado**: sólo pueden despachar de él los clientes que tenga asignados.
Eso lo administra hoy MobilityManager y pasa a administrarse acá.

1. **Restringir un centro** entero, con motivo, para sacarlo de circulación.
2. **Reservar un almacén a clientes**, buscándolos por código o nombre.
3. **Reservar un almacén a grupos de clientes de SAP** — para un ingenio o una cooperativa con más de
   150 empresas, que cliente por cliente es inviable.
4. Ver y quitar lo reservado, y saber qué clientes trae cada grupo.

**Nada de esto vive en BackOffice.** El dueño de las tablas y de la regla es el Middleware: acá se
construye la pantalla y el módulo que la consume. **No hay SQL, ni migración, ni tablas nuevas.**

## Las reglas que hereda la sección

| # | Regla | Dónde se aplica |
|---|---|---|
| 1 | Un almacén queda reservado con la **primera** reserva, y vuelve a estar libre **sólo cuando no le queda ninguna**, ni de cliente ni de grupo | Middleware |
| 2 | Se guarda el **código del grupo**, nunca la lista de clientes: si SAP suma una empresa al grupo, entra sola | Middleware |
| 3 | El **grupo 37** ("Clientes Terceros", 17.260 clientes) no se puede reservar: es el contenedor genérico, no un holding | Middleware (base y API) + la pantalla lo muestra deshabilitado con el motivo |
| 4 | El código de grupo se compara **exacto**: `NE` y `ÑE` son grupos distintos y los dos existen | Middleware |
| 5 | La regla de qué almacenes puede usar un cliente la resuelve una sola función del Middleware, que también usan la carga de pedidos, el envío a SAP y el stock de Autorizaciones | Middleware |

## Decisiones del traspaso (2026-09-18)

| # | Decisión | Consecuencia acá |
|---|---|---|
| 1 | **Roles: `Administrador`**, sin rol nuevo ni SQL | El controller declara **`@Roles(Administrador, Usuario)`**, como Regiones: `Usuario` ve la sección por la regla de exclusión del front, así que si no está en el guard la pantalla se le muestra y la API le responde 403. En `sections.tsx` va `roles: ['Administrador']` |
| 2 | **El alcance por sociedad se conserva**: funciona igual que en MobilityManager | Entra un módulo `scope/` nuevo (ver Arquitectura). ⚠️ `JERARQUIA_Y_VISIBILIDAD.md` dice hoy que acá no hay `ScopeService` en juego: con Almacenes sí lo hay, y ese documento se corrige |
| 3 | **La pantalla de MobilityManager se da de baja después** de verificar ésta | Las dos conviven un tiempo. No es un problema de datos: el dueño es el Middleware y las dos escriben por el mismo endpoint; en la auditoría se distinguen por `x-source-app` |

⚠️ **Antes de la baja en MobilityManager**: quien hoy reserva almacenes necesita cuenta de BackOffice
con `Administrador` o `Usuario`, o se queda sin herramienta.

## Pantallas

Ruta `/almacenes`. Tres vistas encadenadas: **Centros → Almacenes del centro → Reservas del almacén**.

### Centros

Lista paginada con búsqueda y orden del servidor. Por centro: sociedad, código, nombre, cuántos
almacenes tiene y cuántos están restringidos. Acción: **restringir / liberar el centro**, con motivo
opcional. Es una restricción global: saca el centro de circulación para todos.

### Almacenes del centro

Lista con búsqueda y el filtro *"ver sólo restringidos"*. Por almacén: código, nombre, dirección y
**"N clientes · M grupos"**. Entrar al almacén abre sus reservas.

### Reservas del almacén

Dos tipos de reserva conviviendo en una sola lista:

| | **Cliente** | **Grupo de clientes** |
|---|---|---|
| Cómo se elige | Buscador por código o nombre | Buscador por código o nombre del grupo, mostrando **cuántos clientes** tiene en esa sociedad |
| Cómo se ve | Una fila por cliente | Una fila por grupo, **desplegable** a la lista paginada de sus clientes |
| Restricción | — | El **grupo 37** aparece **deshabilitado, con el motivo a la vista**; no se oculta, para que nadie crea que falta |

Quitar la última reserva —de cualquiera de los dos tipos— **pide confirmación**: el almacén queda
disponible para todos los clientes.

Los buscadores llevan debounce de 300 ms y se cierran al hacer click afuera, como `CebePicker` de
Regiones. **No hay typeahead compartido en BackOffice**: cada sección arma el suyo.

## Arquitectura

```
Pantalla  →  API de BackOffice  →  Middleware  →  SQL Server
             (rol + alcance)       (dueño de la regla y de los datos)
```

### Módulo `scope/` (nuevo)

El alcance **no se calcula acá**: se le pide al Middleware con `GET /mobility/user-scope`, que
devuelve `isAdmin` y las sociedades del usuario. Se porta de MobilityManager: `scope.client.ts` +
`scope.service.ts`.

- **La identidad ya coincide**: el JWT de BackOffice lleva `guidUsers = Users.Guid` (`auth.service.ts`),
  que es el mismo `guid` que usa MobilityManager.
- **La caché se porta con el servicio.** No es un adorno: existe por un incidente de producción del
  2026-08-12, siete llamadas idénticas a `user-scope` en el mismo segundo.
- **Lecturas** fuera de alcance devuelven vacío; **escrituras** fuera de alcance, 403.

### Endpoints de BackOffice — `/api/warehouses`

Espejo de los de MobilityManager, con el alcance inyectado y los roles de acá.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/centers` | Centros del alcance, paginado, con búsqueda y orden |
| GET | `/` | Almacenes de un centro, con `customerCount` y `groupCount` |
| GET | `/customers` | Clientes reservados a un almacén |
| GET | `/customer-search` | Buscador de clientes |
| POST | `/customers` | Reserva un cliente |
| DELETE | `/customers` | Quita un cliente |
| GET | `/groups` | Grupos reservados a un almacén |
| GET | `/group-search` | Buscador de grupos; el 37 viene con `assignable: false` |
| GET | `/groups/customers` | Clientes de un grupo, paginado |
| POST | `/groups` | Reserva un grupo. 400 si es el 37 o si el grupo no tiene clientes en esa sociedad |
| DELETE | `/groups` | Quita un grupo |
| PUT | `/availability` | Libera un almacén (borra sus reservas) |
| PUT | `/center-restriction` | Restringe o libera un centro |

**Las lecturas también van gateadas por el rol de la sección**, que es la diferencia con
MobilityManager (ver `API_ENDPOINTS.md`).

### Cliente del Middleware

`middlewareBase()` + `middlewareHeaders()` de `common/middleware-request.ts` — mandan
`x-source-app: MobilityBackOffice` y la api key. `timeout: 20000`, y los errores de red mapeados a
`ServiceUnavailableException` con mensaje en castellano.

**Piso de versión**: `MIN_MW_VERSION_CUSTOMER_GROUPS = '1.357.0'`, con el patrón de
`regions.client.ts`. Con un Middleware anterior, la reserva por grupo avisa que no está disponible en
ese entorno **y las reservas por cliente siguen funcionando**.

### Auditoría

`AuditService.record()` con `actorFrom(req)` y una **categoría nueva `Warehouses`** en
`audit.categories.ts`. Se audita cada alta y cada baja, de cliente y de grupo, y la restricción de un
centro. `guidApiLoginClients` es obligatorio: sin él, ITManager no muestra la fila.

## Archivos

| Capa | Archivos |
|---|---|
| API | `apps/api/src/warehouses/` — `module`, `controller`, `service`, `client`, `types`, `customer-groups.ts` + `*.spec.ts` · `apps/api/src/scope/` — `client`, `service` + spec · `app.module.ts` · `audit/audit.categories.ts` |
| Web | `apps/web/src/pages/AlmacenesPage.tsx` (sólo compone) · `apps/web/src/components/warehouses/` — panel, lista de centros, almacenes del centro, reservas, los dos buscadores, lista de clientes del grupo, `warehouses.api.ts`, `warehouses.types.ts`, `warehouses.css` + `*.test.tsx` · `config/sections.tsx` · `App.tsx` · `components/layout/icons.tsx` |
| Docs | este SPEC · `API_ENDPOINTS.md` · `ROLES_Y_PERMISOS.md` · `EXTERNAL_APIS.md` · `JERARQUIA_Y_VISIBILIDAD.md` · `SPEC_BACKOFFICE_REGIONES.md` (la línea que dice que acá no hay Warehouses) |

**Estilos:** tokens `--bo-`, clases con prefijo `bo-`, íconos SVG inline en `icons.tsx` y **sin
emojis**. La hoja de MobilityManager (646 líneas) no se copia: se reescribe.

## Tests

- **API** (Jest, `*.spec.ts` al lado del código): el 37 rechazado antes de llamar al Middleware · el
  mapeo de errores por `code`, incluido el 503 de "todavía no está disponible en este entorno" ·
  **alcance**: lectura fuera de alcance vacía y escritura fuera de alcance 403 · **el controller
  declara `Administrador` y `Usuario`**, que es lo que evita la pantalla visible y rota.
- **Web** (Vitest + Testing Library, consultas por rol): el buscador deshabilita el 37 y muestra su
  motivo · la fila de grupo trae su conteo y se despliega · quitar la última reserva pide confirmación.

## Deploy

**No hay SQL.** Se despliega BackOffice y listo, con el Middleware ya en 1.357.0 o superior. Si el
entorno tiene un Middleware anterior, la sección funciona salvo la reserva por grupo, que avisa.

La baja de la sección en MobilityManager es un deploy aparte y posterior.

## Pendiente

- Escribir el código: este SPEC es el paso 1 del plan.
- Confirmar quiénes administran almacenes y darles cuenta y rol en BackOffice **antes** de la baja en
  MobilityManager.
- Al terminar, corregir en `SPEC_BACKOFFICE_REGIONES.md` la línea que enumera a Warehouses entre los
  módulos que BackOffice no tiene.
