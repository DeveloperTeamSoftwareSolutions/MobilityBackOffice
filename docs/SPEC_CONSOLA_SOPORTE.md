# Spec (SDD) — Consola de Soporte

> Fecha: 2026-08-25
> Estado: fase 1 en implementacion; fases 2 y 3 pendientes de aprobacion
> Version objetivo: 2.1.0 (fase 1) · 2.2.0 (fase 2) · 2.3.0 (fase 3)
> Branch: `feature/consola-soporte`

---

## 1. Problema

Cuando una orden o cotizacion del flujo Mobility queda trabada en un estado erroneo —o
"desaparece" de la pantalla del vendedor porque su estado no coincide con los hechos que lo
respaldan— hoy la unica salida es **entrar a mano a SQL Server y editar los registros**.

Eso tiene tres costos: es lento, no deja traza de quien lo hizo ni por que, y exige acceso
directo a la base productiva a gente que no deberia tenerlo.

Falta la herramienta que lo reemplace: una **consola de soporte** dentro de BackOffice que
permita auditar la trazabilidad completa de un documento y corregir su estado en caliente,
con acceso restringido al DevelopersTeam.

## 2. Alcance

**Dentro**: ordenes y cotizaciones del **flujo Mobility** (`BusinessOrders` / `BusinessQuotes`).

**Fuera**: las ordenes de SAP (`/api/mobility/sap-orders`, `/api/sap/orders`). Se evaluaran
en una fase posterior si el soporte las necesita.

## 3. Decisiones tomadas

| # | Decision | Razon |
|---|---|---|
| D1 | El bypass va en un **router nuevo y separado** del Middleware, no modificando `PATCH /orders/:guid/status` | El endpoint existente lo usan vendedores y gerentes desde MobilityManager. Tocarlo cambiaria el flujo de negocio para todos |
| D2 | **No se modifica la tabla `TRANSITIONS`** de `orderStatusTransition.js` | Relajarla afloja las reglas para TODO el ecosistema, no solo para soporte. El bypass debe ser un camino explicito, no una regla mas permisiva |
| D3 | BackOffice **no escribe a SQL**: todo pasa por el Middleware | Regla dura del proyecto (`CLAUDE.md`). Ademas, escribir directo reproduce el problema que este modulo viene a eliminar |
| D4 | Transiciones **de cualquier estado a cualquier estado**, incluidos los terminales (`Invoiced`, `Cancelled`, `AuthorizationRejected`) | Decision del solicitante (2026-08-25). Mitigacion: confirmacion doble + motivo obligatorio. Ver riesgo R4 |
| D5 | El rol de soporte es **exclusivo** (`MOBILITYBO_SUPPORT`), y **SuperAdmin tambien entra** | Decision del solicitante (2026-08-25). Mantiene la regla transversal de que SuperAdmin ve todo |
| D6 | Prioridad del rol: **SuperAdmin > Soporte > Administrador > Marketing** | Soporte es un rol tecnico deliberado del DevelopersTeam; si a alguien se lo asignan, debe ganarle a los roles funcionales. Ver riesgo R2 |
| D7 | Se ofrecen **dos operaciones distintas**: reparacion limpia (corregir los hechos + recalcular) y override duro (estampar el estado) | El estado es un valor DERIVADO, no almacenado. Ver §4 |
| D8 | El router de soporte del Middleware exige **`requireApiKey`** | Es el unico camino del ecosistema que salta el scope de vendedor y la maquina de estados. Sin key seria alterable por cualquiera |

## 4. El hecho tecnico que gobierna el diseno

**El estado de un documento no se guarda: se calcula.**

`documentStatus.repository.recomputeStatus` deriva el `StatusCode` de la cabecera a partir de
los hechos: las banderas de los items (`AuthorizationRequired`, `AuthorizationStatus`,
`SellerResponse`), el veredicto del motor de credito y la validacion del pago. Su propio
comentario lo dice: *"se RECALCULAN de los hechos tras cada mutacion, no se setean por los
escritores"*.

Consecuencia directa para esta consola: **si soporte estampa un estado sin tocar los hechos que
lo respaldan, el proximo recompute lo revierte**, en silencio y sin error. Cualquier accion
normal sobre el documento dispara ese recalculo.

Por eso la consola expone dos caminos, y la UI empuja hacia el primero:

**Reparacion limpia** (recomendada) — soporte corrige los hechos (destraba un item, marca el
pago, libera el credito) y dispara el recalculo. El estado resultante es consistente y estable
porque los hechos lo respaldan.

**Override duro** — soporte estampa un estado que los hechos no respaldan. Resuelve el caso
urgente pero es fragil: el proximo recompute puede revertirlo. La UI lo advierte
explicitamente; ocultarlo seria peor, porque soporte creeria haber arreglado algo que no quedo
arreglado.

Se descarto una tercera via —"pinnear" el documento para que el recompute lo respete— por ser
un cambio de fondo en el motor de estados con impacto en todo el ecosistema. Si el uso
demuestra que hace falta, se evalua aparte.

## 5. Objetos de datos involucrados

| Documento | Cabecera | Items | FK | Resoluciones |
|---|---|---|---|---|
| Orden | `BusinessOrders` | `BusinessOrderItems` | `GuidBusinessOrders` | `BusinessOrdersResolutions` |
| Cotizacion | `BusinessQuotes` | `BusinessQuoteItems` | `GuidBusinessQuotes` | `BusinessQuotesResolutions` |

**Banderas de cabecera**: `StatusCode`, `ProcessedPrices`, `ProcessedCredit`,
`ProcessedPaymentMethod`, `OtherPaymentMethod`, `OtherPaymentMethodStatus`, `CreditAuthReason`,
`CancelledAt`, `SentAt`.

**Banderas de item**: `AuthorizationRequired`, `AuthorizationStatus`, `SellerResponse`.

BackOffice **no toca ninguna de estas tablas directamente**: las lee y escribe por el
Middleware.

---

## 6. Fase 1 — Rol + linea de tiempo (solo lectura)

**Cambios en MobilityMiddleWare: NINGUNO.** El endpoint necesario ya existe y ya esta montado
sin API key.

### 6.1 Rol en ITManager

Script `apps/api/prisma/sql/006_AddSupportRole.sql`, idempotente y aditivo, siguiendo el patron
del `001`:

- Rol `MOBILITYBO_SUPPORT` (RoleName `Soporte`)
- Permisos `MOBILITYBO_SUPPORT_VIEW` y `MOBILITYBO_SUPPORT_OVERRIDE`
- Mapeo: `SUPPORT` → ambos; `SUPERADMIN` → ambos

### 6.2 Backend

| Archivo | Cambio |
|---|---|
| `auth/backoffice-role.enum.ts` | agregar `Soporte` |
| `auth/role-resolver.service.ts` | mapear `MOBILITYBO_SUPPORT`, prioridad segun D6 |
| `support/support.types.ts` | tipos del modulo |
| `support/support.client.ts` | cliente HTTP al Middleware |
| `support/support.service.ts` | logica + auditoria |
| `support/support.controller.ts` | rutas, `@Roles(Soporte)` |
| `support/support.module.ts` | modulo |
| `app.module.ts` | registrar `SupportModule` |

**Endpoints:**

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/support/documents` | Buscar documentos. Query: `type` (`order`\|`quote`), `search`, `page`, `limit` (max 200) |
| GET | `/api/support/documents/:type/:number` | Cabecera + items del documento |
| GET | `/api/support/documents/:type/:number/timeline` | Bitacora unificada. Query: `includeViews`, `includeMessages` |

El ultimo es un passthrough a `GET /api/mobility/document-timeline` del Middleware, que
devuelve la historia completa: alta, ediciones, envio, decisiones por item, contraofertas,
decision de cabecera, corridas del motor de credito, pagos y su validacion, liberacion o
denegacion de credito, cierre del turno del gerente, envio a SAP y anulacion con motivo.

### 6.3 Frontend

`pages/SoportePage.tsx` + `components/soporte/` (`soporte.api.ts`, `soporte.types.ts`,
`DocumentSearch.tsx`, `DocumentTimeline.tsx`, `soporte.css`), entrada en `config/sections.tsx`
con `roles: ['Soporte']`, ruta en `App.tsx` con `RoleGuard`, icono SVG nuevo en
`layout/icons.tsx`. Sin emojis, tokens `--bo-`, clases `bo-`.

---

## 7. Fase 2 — Override de estados (pendiente de aprobacion)

### 7.1 Cambios en MobilityMiddleWare

**Archivo nuevo** `src/api/routes/supportOverrides.js`, montado como:

```js
app.use('/api/mobility/support', requireApiKey, supportOverridesRouter);
```

**Repositorio nuevo** `src/db/repositories/supportOverrides.repository.js`, con `setStatusOverride`:

- omite `sellerScope.assertScope` (soporte no es el vendedor)
- omite `canTransition` de `orderStatusTransition.js` (D4)
- valida que `toCode` sea un codigo existente, no un string arbitrario
- exige motivo no vacio
- escribe en las mismas tablas de historia que alimentan la timeline, con el actor real

**Endpoints:**

```
PATCH /api/mobility/support/orders/:guid/status
PATCH /api/mobility/support/quotes/:guid/status
Body: { toCode, reasonCode, reasonNotes, actor: { email } }
```

### 7.2 BackOffice

`PATCH /api/support/documents/:type/:guid/status`, con `@Roles(Soporte)`, motivo obligatorio y
traza `SUPPORT_STATUS_OVERRIDE` en `AuditLogs`.

### 7.3 UI

Modal que muestra estado actual → destino y exige motivo. **Si el origen o el destino es
terminal, segundo paso de confirmacion** con la advertencia de desincronizacion con SAP. Aviso
permanente de que un estado forzado sin respaldo en los hechos puede recalcularse.

---

## 8. Fase 3 — Banderas de control (pendiente de aprobacion)

### 8.1 Cambios en MobilityMiddleWare

Sobre el mismo router de soporte:

```
PATCH /api/mobility/support/:type/:guid/flags            -- banderas de cabecera
PATCH /api/mobility/support/:type/:guid/items/:itemGuid  -- banderas de item
POST  /api/mobility/support/:type/:guid/recompute        -- dispara recomputeStatus
```

El `recompute` explicito es lo que habilita la **reparacion limpia** de §4.

### 8.2 BackOffice

Espejo de los tres, con `@Roles(Soporte)`, motivo obligatorio y traza `SUPPORT_FLAG_OVERRIDE`.

---

## 9. Riesgos

| # | Riesgo | Mitigacion |
|---|---|---|
| R1 | **`SellerResponse` falta en `BusinessQuoteItems` en PROD** (item 2 del `DEPLOY_SQL_PENDIENTE.md` del Middleware). Sin esa columna el recalculo de cotizaciones falla con "Invalid column name" | Aplicar la columna **antes** de desplegar la fase 3 para cotizaciones |
| R2 | La app resuelve **un solo rol por usuario**. Alguien con `MOBILITYBO_ADMIN` + `MOBILITYBO_SUPPORT` pierde el acceso a Regiones (gana Soporte por D6) | Quien necesite ambos accesos va con SuperAdmin. Documentado en `ROLES_Y_PERMISOS.md` |
| R3 | `MIDDLEWARE_API_KEY` pasa de opcional a **obligatoria** al llegar la fase 2 | Configurarla en ambos lados y actualizar `ENV_VARIABLES.md` en esa fase |
| R4 | Reabrir una orden `Invoiced` o `Cancelled` **no se propaga a SAP**: quedan desincronizados | Habilitado por D4, con doble confirmacion y motivo obligatorio. El riesgo es aceptado, no eliminado |
| R5 | Un override duro puede revertirse solo en el proximo recompute (§4) | La UI lo advierte; la reparacion limpia es el camino por defecto |

## 10. Auditoria

| Action | Category | Entity | Fase |
|---|---|---|---|
| `SUPPORT_STATUS_OVERRIDE` | `support` | `BusinessOrders` / `BusinessQuotes` | 2 |
| `SUPPORT_FLAG_OVERRIDE` | `support` | `BusinessOrders` / `BusinessQuotes` | 3 |

La fase 1 es solo lectura y no audita (la lectura de la timeline ya queda en los `ApiLogs` del
Middleware por el header `x-source-app`).
