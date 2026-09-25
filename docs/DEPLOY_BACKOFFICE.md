# Deploy de MobilityBackOffice — 2.37.0

> Escrito el 2026-09-18 · Rama principal: **`main`**.
> Esta versión trae la sección **Almacenes y Centros de Distribución**, traspasada desde
> MobilityManager. Diseño y verificación: [`SPEC_BACKOFFICE_ALMACENES.md`](SPEC_BACKOFFICE_ALMACENES.md).

---

## 1. Qué hay hoy y qué se despliega

| | |
|---|---|
| Corriendo ahora | **2.35.0** en `http://100.100.46.73:3010` (verificado 2026-09-18 por `/api/health`) |
| Se despliega | **2.37.0** desde `main` |
| Qué suma | La sección Almacenes (API + pantalla), el alcance por sociedad, la categoría de auditoría `Warehouses` y la configuración de ESLint que faltaba |
| Base de datos | **Ninguna migración propia.** BackOffice no toca SQL: toda su data pasa por el MiddleWare |

---

## 2. Prerrequisitos — mirarlos antes de desplegar

### 2.1 El MiddleWare que consume este BackOffice

La reserva por **grupo de clientes** necesita **MiddleWare ≥ 1.357.0** y la tabla
`dbo.WarehouseCustomerGroups` en la base de ese MiddleWare.

| Entorno | Estado al 2026-09-18 |
|---|---|
| `Mobility_QATEST` | Tabla ✅ (17-09). El MW de `100.100.46.73:61000` responde **1.356.0**: hay que subirlo |
| SandBox-QA (`100.100.46.73:62700`) | Tabla ✅ (17-09) · MW **1.357.0** ✅ |
| PROD (`100.89.65.72:61000`) | Tabla ⬜ · MW **1.356.0** ⬜ — ver la cola de deploy de MobilityManager, ítem 32 |

🟢 **Si el MiddleWare es anterior, la sección igual funciona**: las reservas por cliente andan y la
parte de grupos avisa *"la reserva por grupo todavía no está disponible en este entorno"*. No rompe
nada; simplemente esa mitad queda apagada hasta que se suba el MW.

Cómo saber qué MiddleWare consume una instancia: su variable `MIDDLEWARE_URL`, y después
`GET {MW}/health`.

### 2.2 Roles en ITManager

La sección abre con **`Administrador`** y **`Usuario`** (y `SuperAdmin`, que pasa siempre).

| Script | Qué crea | QATEST | PROD |
|---|---|---|---|
| `001_RegisterMobilityBackOfficeApp.sql` | La app y el rol `Administrador` | ✅ | ⬜ |
| `007_AddUserRole.sql` | **El rol `Usuario`** | ⬜ **pendiente** | ⬜ |

#### Dónde se corre el `007_AddUserRole.sql`

Está en este repo: `apps/api/prisma/sql/007_AddUserRole.sql`.

| | |
|---|---|
| Instancia | `100.66.245.49:1433` |
| Base | **`Mobility_QATEST`** para local y SandBox · **`Mobility-PROD`** para producción |
| Qué toca | Las tablas de **ITManager**, que viven en esa misma base: `Applications`, `Roles`, `Permissions`, `RolePermissions` |
| Requisito previo | El `001`, que registra la app. El script corta con `RAISERROR` si no la encuentra |
| Idempotente | Sí: sólo `INSERT` si falta. No modifica ni borra filas ajenas |
| Rollback | Borrar el rol `MOBILITYBO_USER` y su mapeo. Nadie más los usa |

⚠️ **El script no lleva `USE`**: corre contra la base de la conexión. Abrir siempre con
`SELECT @@SERVERNAME, DB_NAME();` antes de ejecutarlo — es la única forma de no confundir
`Mobility_QATEST` con `Mobility-PROD`.

Para saber si ya está aplicado, sin ejecutarlo:

```sql
SELECT r.RoleKey, r.Name
FROM   Roles r
JOIN   Applications a ON a.Guid = r.GuidApplications
WHERE  a.AppId = 'MobilityBackOffice'
ORDER BY r.RoleKey;
-- Tiene que aparecer MOBILITYBO_USER. Si no está, falta correr el 007.
```

⚠️ **Sin el 007 no existe el rol `Usuario`**, así que a la sección sólo entran `Administrador` y
`SuperAdmin`. No es un error de la sección: es que el rol todavía no está creado en ITManager.
El estado por entorno vive en [`DEPLOY_SQL_PENDIENTE.md`](DEPLOY_SQL_PENDIENTE.md) — **verificarlo
contra ITManager antes de dar por buena esta tabla**: ese documento se escribe a mano.

### 2.3 Quién va a usar la sección

Los que hoy administran almacenes lo hacen **desde MobilityManager**, y esa pantalla **sigue viva a
propósito** (ver el plan del traspaso). Para que alguien la use acá necesita **cuenta de BackOffice
con rol `Administrador` o `Usuario`**.

---

## 3. Los pasos

```bash
git fetch origin && git checkout main && git pull        # 2.37.0
npm ci                                                    # ⚠️ no "npm install": respeta el lock
npm run build                                             # compila api y web
```

`npm run build` deja el backend en `apps/api/dist` y el front en `apps/web/dist`. **La API sirve el
front**: levanta `apps/web/dist` en `/` y sigue atendiendo `/api`. No hay que publicar el front aparte.

Después, reiniciar el proceso como se venga haciendo en ese servidor (el que hoy escucha en el 3010).

### Variables de entorno

Ninguna nueva en esta versión. Las que el arranque exige:

| Variable | Obligatoria | Nota |
|---|---|---|
| `ITMANAGER_AUTH_URL` | **Sí** | Sin ella el proceso no arranca |
| `BACKOFFICE_JWT_SECRET` | **Sí** | Mínimo 16 caracteres. Es propio, distinto del de ManageIT |
| `MIDDLEWARE_URL` | Recomendada | **Incluye `/api`**. Default `http://localhost:6002/api` |
| `MIDDLEWARE_API_KEY` | No | Sólo si ese MiddleWare la exige |
| `PORT`, `CORS_ORIGIN`, `NODE_ENV` | No | Defaults `3010`, `http://localhost:5183`, `development` |

---

## 4. Verificación

Sin credenciales, desde el navegador o con `curl`:

```
GET  http://<host>:3010/api/health
     -> {"success":true,"name":"MobilityBackOffice","version":"2.37.0","status":"ok"}

GET  http://<host>:3010/api/warehouses/centers
     -> 401 sin token   (la ruta existe y está protegida)
```

Y entrando con un usuario `Administrador`:

1. **Almacenes** aparece en el menú.
2. Un centro abre su lista de almacenes, con "N clientes · M grupos".
3. **Reservar → Grupo de clientes**: el buscador trae los grupos con su cantidad de clientes, y el
   **grupo 37 aparece deshabilitado con su motivo**.
4. Quitar la última reserva **pide confirmación** y el almacén vuelve a quedar disponible.
5. Cada alta y cada baja quedan en **AuditLogs**, visibles en ITManager con `AppId = MobilityBackOffice`
   y categoría `Warehouses`.

Si el MiddleWare del entorno es anterior a 1.357.0, el punto 3 muestra el aviso de "no disponible en
este entorno" y el resto funciona igual.

> Contra QATEST esto ya se verificó el 2026-09-18: **37 comprobaciones, todas OK**, incluido el
> alcance por sociedad (lectura vacía y escritura 403 fuera de alcance). El detalle está en el SPEC.

---

## 5. Vuelta atrás

**No hay nada que revertir en la base**: esta versión no aplica migraciones.

Volver al build anterior (2.35.0) y reiniciar alcanza. Lo que la sección haya escrito —reservas de
almacenes— **no se pierde ni molesta**: vive en la base del MiddleWare y lo sigue administrando
MobilityManager, que todavía tiene su pantalla.

---

## 6. Riesgos

| Riesgo | Qué pasa | Cómo se acota |
|---|---|---|
| El MiddleWare del entorno es < 1.357.0 | La reserva **por grupo** avisa que no está disponible | Las reservas por cliente siguen funcionando. Subir el MW cuando se pueda |
| Falta `WarehouseCustomerGroups` en esa base | Los endpoints de grupos responden 503 con un código claro | Ídem: el resto de la sección anda. Es el ítem 32 de la cola de MobilityManager |
| El rol `Usuario` no existe todavía (script 007) | Sólo entran `Administrador` y `SuperAdmin` | Correr el 007, o asignar `Administrador` |
| Dos pantallas para lo mismo (acá y en MobilityManager) | Ninguno de datos: el dueño es el MiddleWare y las dos escriben por el mismo endpoint | En la auditoría se distinguen por `AppId`. ⚠️ **Todo arreglo hay que hacerlo en los dos lados** hasta que se dé de baja la de MobilityManager |


---

## 7. Verlo todo en local, antes de desplegar

Sirve para recorrer lo nuevo contra datos reales de QATEST sin tocar ningún entorno desplegado.

```bash
git fetch origin && git checkout main && git pull
npm ci
npm run dev         # API en :3010 + front en :5183, en una sola terminal
```

`npm run dev` levanta las dos apps con `concurrently` y prefija cada línea con `[api]` o
`[web]`. Si una de las dos no arranca, corta la otra. Para verlas en terminales separadas
siguen existiendo `npm run dev:api` y `npm run dev:web`.

El front de desarrollo (`:5183`) es el que conviene abrir: recarga solo al cambiar código. El
`:3010` sirve el build, que recién existe después de `npm run build`.

### Lo que hay para mirar

| Sección | Rol que la abre | Novedad |
|---|---|---|
| **Centros y almacenes** | `Administrador` | **Nueva** (2.37.0): lo que se traspasó desde MobilityManager, con la reserva por grupo de clientes |
| **Órdenes rechazadas por SAP** | `RevisionSap` | **Nueva** (2.35.0): bandeja de pendientes y resueltas, y corrección por ítem |
| Regiones comerciales | `Administrador` | Ya estaba |
| Consola de soporte | `Soporte` | Ya estaba |
| Matriz de autorizadores | `SuperAdmin` | Ya estaba |
| Templates de WhatsApp · Documentación del RAG | `Marketing` | Ya estaban |

⚠️ **Con una cuenta sola no se ve todo.** La app resuelve **un único rol por usuario**:
`SuperAdmin` ve todas las secciones; `Usuario` ve todas **menos** las de `Soporte`, `SuperAdmin` y
`RevisionSap`. Para recorrer lo nuevo de punta a punta conviene entrar con **`SuperAdmin`**.

### Recorrida de Almacenes

1. **Centros**: buscar un centro y entrar. Se ve la lista de sus almacenes con "N clientes · M grupos".
2. **Reservar → Cliente**: buscar por código o nombre. El almacén queda reservado.
3. **Reservar → Grupo de clientes**: buscar `37` (aparece **deshabilitado, con el motivo**) y después
   un grupo real, por ejemplo `T3` (Ingenio El Angel, 715 clientes en la sociedad 2500).
4. **Desplegar la fila del grupo**: la lista de sus clientes, paginada.
5. **Quitar la última reserva**: pide confirmación y avisa que el almacén queda disponible para todos.
6. **Restringir un centro** con motivo, y liberarlo.

Todo eso escribe en la base de QATEST y queda auditado. Para dejarlo como estaba, quitar lo que se
haya reservado y liberar el centro desde la misma pantalla.

> Si el MiddleWare que consume tu local es anterior a 1.357.0, el paso 3 muestra el aviso de "no
> disponible en este entorno" y el resto de la sección funciona igual. Se cambia con `MIDDLEWARE_URL`.