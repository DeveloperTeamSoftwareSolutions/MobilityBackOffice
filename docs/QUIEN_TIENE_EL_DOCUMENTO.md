# Quién tiene el documento — cómo leerlo en la base

> Última actualización: 2026-08-27 · BackOffice v2.10.0 · Middleware v1.249.0
>
> Para verificar el estado real de una orden o cotización **sin depender de lo que
> muestren MobilityIA o MobilityManager**. Todo lo de acá es `SELECT`: no escribe nada.

---

## 1. La idea en una frase

**No existe una columna "control".** Quién tiene el documento se deduce de tres hechos
independientes que viven en tres lugares distintos:

| Hecho | Dónde vive | Qué significa |
|---|---|---|
| ¿Fue enviado? | `BusinessOrders.SentAt` | `NULL` = borrador, es del **vendedor** |
| ¿El gerente cerró su turno? | **existe fila viva** en `BusinessOrdersResolutions` | La "confirmación de envío" del gerente |
| ¿Qué falta procesar? | `ProcessedPrices` / `ProcessedCredit` / `ProcessedPaymentMethod` | `0` = ese segmento retiene el documento |

El `StatusCode` es la **conclusión**, no la causa: se recalcula a partir de esos hechos
después de cada cambio. Por eso, cuando algo no cierra, hay que mirar los hechos y no
el estado.

Para cotizaciones es igual cambiando `BusinessOrders` → `BusinessQuotes`,
`BusinessOrderItems` → `BusinessQuoteItems`, `BusinessOrdersResolutions` →
`BusinessQuotesResolutions` y `OrderNumber` → `QuoteNumber`.

---

## 2. La confirmación de envío del gerente

Es **la fila en `BusinessOrdersResolutions`**. No hay un flag booleano en la cabecera.

```sql
SELECT Resolution, TotalItems, ApprovedItems, RejectedItems, ResolvedByEmail, ResolvedAt
FROM dbo.BusinessOrdersResolutions
WHERE GuidBusinessOrders = @Guid
  AND (DeletedTimestamp IS NULL OR DeletedTimestamp = 0);   -- <- el filtro importa
```

- **Sin filas vivas** → el gerente **no** confirmó. El documento sigue siendo suyo.
- **Con fila viva** → confirmó el `ResolvedAt`, y el control pasó al vendedor.

El filtro de `DeletedTimestamp` no es opcional: cuando soporte usa *"Volver a Pendiente
de aprobación"*, la fila **no se borra, se marca como eliminada**. Sin el filtro vas a
ver un turno cerrado que en realidad fue reabierto.

> **Decidir no es confirmar.** El gerente puede aprobar, rechazar y contraofertar todas
> las líneas sin crear esta fila. Mientras no exista, puede seguir cambiando de opinión.

---

## 3. La excepción que confunde: documentos SOLO-CABECERA

Un documento **sin ninguna línea escalada** cuyo único pendiente era el plazo de pago
avanza a `Processed` **sin fila de resolución**.

No es un error ni algo que haga BackOffice: es una regla del middleware
(`decideStatusChange`, directiva 2026-08-17) que dice que con los tres segmentos
procesados el documento asciende sin esperar el cierre del turno. Se aplica **igual** si
la decisión la toma el gerente desde su app.

La lógica es que en ese documento no había "turno" que cerrar: la única tarea del
gerente era decidir el plazo, y decidido eso no le queda nada.

**Caso verificado — ORD-00005419**: 0 líneas escaladas, plazo de pago rechazado, las
tres banderas en 1, ninguna fila de resolución, `StatusCode = Processed`. Consistente.

**Contraste — ORD-00005420**: 1 línea escalada y aprobada, sin resolución →
`ProcessedPrices = 0` → la regla de retención lo sostiene en `ReadyForApprove`.
También consistente, y es el comportamiento que se espera.

---

## 4. Las tres banderas

Se recalculan solas después de cada cambio. `NULL` = documento sin enviar.
**El vendedor solo puede avanzar (mandar a SAP / convertir) con las tres en 1.**

| Bandera | Pasa a 1 cuando |
|---|---|
| `ProcessedPrices` | No hay líneas escaladas **o** el gerente decidió todo, **cerró su turno** y no queda contraoferta sin responder |
| `ProcessedCredit` | No hay motivo de crédito, o el motor lo aprobó |
| `ProcessedPaymentMethod` | No se pidió otro plazo, o la decisión quedó **final** (`approved` / `rejected`). `observed` = contraoferta pendiente → 0 |

Cualquiera en 0 **retiene** el documento en `ReadyForApprove`, aunque la proyección por
líneas diera `Processed`.

---

## 5. La consulta

Pegar en SSMS contra `Mobility_QATEST` o `Mobility-PROD`. Cambiar el número.

```sql
DECLARE @Numero NVARCHAR(32) = 'ORD-00005419';

SELECT
    bo.OrderNumber,
    bo.StatusCode,

    -- ¿QUIÉN LO TIENE? Deducido de los hechos, no de una columna.
    CASE
        WHEN bo.CancelledAt IS NOT NULL                 THEN 'NADIE (anulado)'
        WHEN bo.SentAt IS NULL                          THEN 'VENDEDOR (borrador)'
        WHEN bo.StatusCode IN ('SentToSAP','PendingDispatch','Dispatched','Invoiced')
                                                        THEN 'SAP'
        WHEN bo.StatusCode = 'Rejected'                 THEN 'NADIE (rechazado)'
        WHEN bo.StatusCode = 'ReadyForApprove'          THEN 'GERENTE'
        ELSE 'VENDEDOR'
    END                                                  AS QuienLoTiene,

    -- LA CONFIRMACIÓN DE ENVÍO DEL GERENTE
    CASE WHEN res.ResolvedAt IS NULL THEN 'NO confirmó' ELSE 'SÍ confirmó' END
                                                         AS ConfirmacionGerente,
    res.ResolvedByEmail                                  AS ConfirmadaPor,
    res.ResolvedAt                                       AS ConfirmadaEl,
    res.Resolution                                       AS ResultadoDelTurno,

    -- QUÉ RETIENE EL DOCUMENTO (0 = retiene, 1 = listo, NULL = sin enviar)
    bo.ProcessedPrices,
    bo.ProcessedCredit,
    bo.ProcessedPaymentMethod,

    -- EL PLAZO DE PAGO
    bo.OtherPaymentMethod                                AS PlazoPedido,
    bo.OtherPaymentMethodStatus                          AS PlazoEstado,
    bo.OtherPaymentMethodApproved                        AS PlazoConcedido,
    bo.OtherPaymentMethodDecidedByEmail                  AS PlazoDecididoPor,

    -- LÍNEAS
    (SELECT COUNT(*) FROM dbo.BusinessOrderItems i
      WHERE i.GuidBusinessOrders = bo.Guid
        AND (i.DeletedTimestamp IS NULL OR i.DeletedTimestamp = 0)
        AND i.AuthorizationRequired = 1)                 AS LineasEscaladas,
    (SELECT COUNT(*) FROM dbo.BusinessOrderItems i
      WHERE i.GuidBusinessOrders = bo.Guid
        AND (i.DeletedTimestamp IS NULL OR i.DeletedTimestamp = 0)
        AND i.AuthorizationRequired = 1
        AND (i.AuthorizationStatus IS NULL OR i.AuthorizationStatus = ''))
                                                         AS LineasSinDecidir,
    (SELECT COUNT(*) FROM dbo.BusinessOrderItems i
      WHERE i.GuidBusinessOrders = bo.Guid
        AND (i.DeletedTimestamp IS NULL OR i.DeletedTimestamp = 0)
        AND i.AuthorizationStatus = 'countered'
        AND i.SellerResponse IS NULL)                    AS ContraofertasSinResponder,

    bo.SentAt,
    bo.CancelledAt,
    bo.AuthLockedByEmail                                 AS RevisionTomadaPor,
    bo.SellerEmail
FROM dbo.BusinessOrders bo
OUTER APPLY (
    -- La resolución VIVA más reciente. El filtro de DeletedTimestamp es lo que
    -- distingue un turno cerrado de uno que soporte reabrió.
    SELECT TOP 1 r.ResolvedAt, r.ResolvedByEmail, r.Resolution
    FROM dbo.BusinessOrdersResolutions r
    WHERE r.GuidBusinessOrders = bo.Guid
      AND (r.DeletedTimestamp IS NULL OR r.DeletedTimestamp = 0)
    ORDER BY r.ServerTimestamp DESC, r.Id DESC
) res
WHERE bo.OrderNumber = @Numero
  AND (bo.DeletedTimestamp IS NULL OR bo.DeletedTimestamp = 0);
```

### El detalle de las líneas

```sql
SELECT i.LineNumber, i.ProductCode,
       i.AuthorizationRequired      AS Escalada,
       i.AuthorizationStatus        AS DecisionGerente,
       i.ProposedPrice              AS PrecioContraofertado,
       i.DecidedByEmail, i.DecidedAt,
       i.SellerResponse             AS RespuestaVendedor,
       i.SellerRespondedByEmail, i.SellerRespondedAt
FROM dbo.BusinessOrderItems i
JOIN dbo.BusinessOrders bo ON bo.Guid = i.GuidBusinessOrders
WHERE bo.OrderNumber = @Numero
  AND (i.DeletedTimestamp IS NULL OR i.DeletedTimestamp = 0)
ORDER BY i.LineNumber;
```

### El histórico de estados

Es lo que usa la consola para saber a qué estados se puede volver: solo ofrece los que
el documento **realmente tuvo**.

> ⚠️ **Ojo con el `COLLATE`, no es opcional.** `OrdersStatus.GuidOrders` es
> `Latin1_General_100_CI_AI_SC` y `BusinessOrders.Guid` es `..._CI_AS_SC`. Sin forzarlo,
> SQL Server corta con *"Cannot resolve the collation conflict"*. Se fuerza del lado de
> `bo.Guid` —una sola fila— para que el índice de `h.GuidOrders` se siga usando.

```sql
SELECT s.Code AS Estado, h.ChangedAt
FROM dbo.OrdersStatus h
LEFT JOIN dbo.Status s ON s.Guid = h.GuidStatus
JOIN dbo.BusinessOrders bo
  ON h.GuidOrders = bo.Guid COLLATE Latin1_General_100_CI_AI_SC
WHERE bo.OrderNumber = @Numero
  AND (h.DeletedTimestamp IS NULL OR h.DeletedTimestamp = 0)
ORDER BY h.Id;
```

En cotizaciones es igual con `QuotesStatus.GuidQuotes` y `BusinessQuotes.Guid`, que
tienen el mismo desajuste.

---

## 6. Cómo leer el resultado

| Lo que ves | Qué significa |
|---|---|
| `SentAt` NULL | Borrador. Del vendedor. Nadie más lo vio |
| `ReadyForApprove` + sin confirmación | Del **gerente**. Esperando que decida o que confirme |
| `ReadyForApprove` + confirmación + alguna bandera en 0 | El gerente cerró, pero un segmento retiene. Mirá cuál está en 0 |
| `Processed` + confirmación | Circuito normal: el gerente cerró y volvió al vendedor |
| `Processed` **sin** confirmación y `LineasEscaladas = 0` | El caso solo-cabecera de §3. **Correcto** |
| `Processed` **sin** confirmación y `LineasEscaladas > 0` | **Anómalo.** Mirá el histórico y avisá |
| `ContraofertasSinResponder > 0` | Esperando al **vendedor**, no al gerente |
| `RevisionTomadaPor` con valor | Un gerente tiene la revisión tomada. Vence sola a los 30 min de inactividad |

---

## 7. Lo que BackOffice puede y no puede hacer

Decisión del equipo, 2026-08-27. **Verificado en el código**: las únicas funciones que
insertan en las tablas de resolución son `resolveOrder` / `resolveQuote`, y se llaman
solo desde los routers del gerente (`businessOrderApprovals`, `businessQuoteApprovals`,
`priceApprovalsMobility`). El router de soporte no las toca.

| Acción | BackOffice |
|---|---|
| Aprobar / rechazar / contraofertar una línea | Sí |
| Aprobar / rechazar / contraofertar el plazo de pago | Sí |
| Responder una contraoferta por el vendedor | Sí |
| **Confirmar el envío (cerrar el turno del gerente)** | **No.** Solo el gerente desde su app |
| Reabrir un turno ya cerrado | Sí — es una vuelta atrás: marca la fila como eliminada |
| Anular / deshacer una anulación | Sí |
| Volver a un estado anterior | Sí, solo a estados en los que el documento estuvo |
| Escribir el `StatusCode` a mano | **No.** Ningún camino lo hace |

---

## 8. Documentos que ya son de SAP — bloqueados

Decisión del equipo, 2026-08-27. Un documento entregado a SAP **no se modifica desde
BackOffice de ninguna forma**: ni acciones, ni decisiones sobre líneas o plazos, ni
siquiera el recálculo del estado.

Reemplaza la regla anterior, que permitía anularlo avisando que "no se propaga". Una
anulación que SAP no ve deja a los dos sistemas diciendo cosas distintas, que es peor
que no poder anular.

### Se miran DOS señales, y hacen falta las dos

| Señal | Columna | Cuándo se escribe |
|---|---|---|
| Identificador de SAP | `SapOrderId` / `SapOrderNumber` (órdenes), `SapOfferId` / `SapQuoteNumber` (cotizaciones) | Cuando SAP responde que **creó** el documento |
| Estado en el tramo de SAP | `StatusCode` ∈ `SentToSAP`, `PendingDispatch`, `Dispatched`, `Invoiced` | Cuando el **vendedor entrega**, antes de que SAP conteste |

> **Por qué no alcanza el identificador solo.** Entre que el vendedor entrega y SAP
> responde —o si SAP falla, ver `SapLastError`— el documento está en manos de SAP y
> todavía sin identificador. **Medido en QATEST el 2026-08-27: 45 órdenes en el tramo
> de SAP y ninguna con identificador estampado.** Bloquear solo por el identificador no
> habría bloqueado nada.

### Verlo en la base

```sql
SELECT OrderNumber, StatusCode, SapOrderId, SapOrderNumber, SapOrderCreatedAt, SapLastError,
       CASE
           WHEN NULLIF(LTRIM(RTRIM(SapOrderId)),'') IS NOT NULL
             OR NULLIF(LTRIM(RTRIM(SapOrderNumber)),'') IS NOT NULL
                THEN 'BLOQUEADO (tiene identificador de SAP)'
           WHEN StatusCode IN ('SentToSAP','PendingDispatch','Dispatched','Invoiced')
                THEN 'BLOQUEADO (entregado, SAP todavia no contesto)'
           ELSE 'editable desde BackOffice'
       END AS BloqueoBackOffice
FROM dbo.BusinessOrders
WHERE OrderNumber = @Numero
  AND (DeletedTimestamp IS NULL OR DeletedTimestamp = 0);
```

### Qué se ve en la consola

El panel de acciones se reemplaza por un cartel que dice cuál de las dos señales lo
bloqueó, y las líneas dejan de ofrecer decisiones. Si alguien llama la API igual,
responde **409 `SAP_LOCKED`**.
