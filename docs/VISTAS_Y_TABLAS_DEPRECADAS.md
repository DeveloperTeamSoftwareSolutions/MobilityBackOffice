# Vistas y tablas deprecadas — que NO puede consumir BackOffice

> Ultima actualizacion: 2026-08-27 · Version: 2.13.1
>
> Fuente: `RESUMEN DE VISTAS OK Y PARA DEPRECAR.xlsx` y
> `tables to deprecate from SAPServices.xlsx`, relevamiento del equipo sobre
> **Mobility-PROD** y **SAPServices**.

---

## 1. Como leer los relevamientos

Las filas deprecadas estan marcadas con una **x**. El archivo usa `x` minuscula y `X`
mayuscula: **las dos significan deprecar**. La diferencia es de origen, no de semantica —
lo confirma el patron:

- De las **32** marcadas con `X`, **26** tienen una gemela `VIEW_V2_*` **sin marcar**.
  Son v1 que mueren al migrar a v2.
- Las **45** marcadas con `x` casi no tienen gemela v2 (solo 6): se deprecan sin
  reemplazo directo.
- Las 6 excepciones del bloque `X` son copias de trabajo (`_copy1`) o vistas que se
  deprecan enteras, v2 incluida (`VIEW_V2_CustomersFullMobility`,
  `VIEW_V2_ReceivablesDocumentDetailsMobility`).

> **Regla practica: si el nombre esta en el relevamiento con cualquier marca, no se usa.**
> Si tiene gemela `VIEW_V2_*` sin marcar, esa es la que se usa.

---

## 2. Que consume BackOffice, y su estado

BackOffice **no toca SQL**: todo pasa por endpoints del MobilityMiddleWare. Lo que hay
que auditar es, entonces, **que vista lee cada endpoint que consumimos**.

| Endpoint del middleware | Objeto que lee | Estado |
|---|---|---|
| `/mobility/regions*` | `dbo.Continents`, `dbo.ContinentProfitCenters` | ✅ **Vigentes** — son tablas de Mobility, no de SAPServices: no figuran en ningun relevamiento |
| `/v2/mobility/profit-centers` | `VIEW_V2_ProfitCentersMobility` | ✅ Vigente |
| `/v2/mobility/companies` | `VIEW_V2_CompaniesMobility` | ✅ Vigente |
| `/v2/mobility/authorizer-limits-profit-centers` | `VIEW_V2_AuthorizerLimitsProfitCentersMobility` | ✅ Vigente |
| `/mobility/commercial-team-hierarchy/country-manager` | `dbo.CommercialTeamHierarchy` + `Users` | ✅ Vigentes |
| `/mobility/document-timeline`, `/mobility/support/*` | `BusinessOrders`/`BusinessQuotes`, `Auditories`, pagos, credito | ✅ No figuran: son tablas de negocio de Mobility |

### Lo que se corrigio el 2026-08-27

Dos consumos apuntaban a vistas marcadas para deprecar:

| Antes | Ahora | Donde |
|---|---|---|
| `/mobility/authorizer-limits-profit-centers` (`VIEW_AuthorizerLimitsProfitCentersMobility`) | `/v2/...` | `src/authorizers/authorizers.client.ts` |
| `/mobility/profit-centers` (`VIEW_ProfitCentersMobility`) | `/v2/...` | `src/authorizers/authorizers.client.ts` **y** `src/regions/regions.client.ts` |

El de Regiones venia de antes de este relevamiento. El contrato de las v2 es identico
(mismo `mapRow`, mismas columnas), asi que la migracion fue el cambio de la constante del
path.

---

## 3. Las tres vistas de autorizadores estan deprecadas

Importa dejarlo escrito porque es contraintuitivo: **las tres** `authorizer-*` v1 estan
marcadas.

| Vista | Estado |
|---|---|
| `VIEW_AuthorizerLimitsMobility` | ❌ Deprecar |
| `VIEW_AuthorizerProfitCentersMobility` | ❌ Deprecar |
| `VIEW_AuthorizerLimitsProfitCentersMobility` | ❌ Deprecar |
| `VIEW_V2_AuthorizerLimitsMobility` | ✅ Vigente |
| `VIEW_V2_AuthorizerProfitCentersMobility` | ✅ Vigente |
| `VIEW_V2_AuthorizerLimitsProfitCentersMobility` | ✅ **Vigente — es la que usamos** |

**Las TABLAS de origen NO estan deprecadas.** `AuthorizerLimits` y
`AuthorizerProfitCenters` figuran en el relevamiento de SAPServices **sin marca**: lo que
muere es el wrapper v1, no el dato. La matriz de autorizadores sigue siendo la fuente de
verdad de quien puede firmar.

---

## 4. Tablas deprecadas de SAPServices (23)

Ninguna la consume BackOffice hoy, ni directa ni a traves de un endpoint. Se listan para
que una feature futura no las tome:

`AccountStatementDetails` · `AccountStatements` · `CollectionsByChannel` ·
`CollectionsByCustomer` · `CustomerDetails_QueryColsBackup` ·
`Customers_QueryColsBackup` · `DeliveryDestinations` · `InventoryStock` ·
`PriceListItems` · `ReceivablesAgingByCustomer` · `ReceivablesAgingBySalesman` ·
`ReceivablesByDayRange` · `ReceivablesCustomersByRange` · `ReceivablesCustomerSummary` ·
`ReceivablesDocumentDetails` · `SalesByChannel` · `SalesByCustomer` · `SalesBySalesman` ·
`SalesBySector` · `SalesBySupplier` · `SalesChannels` · `SalesCollectionsSummary` ·
`UserCustomers`

> Ojo con dos pares que se parecen y **no** son lo mismo: `DeliveryDestinations` esta
> deprecada pero `CustomerDeliveryDestinations` no; `SalesChannels` esta deprecada pero
> la vista `VIEW_V2_SalesChannelsMobility` sigue vigente.

---

## 5. Vistas deprecadas que tienen reemplazo v2

Las 26 en las que basta cambiar `VIEW_` por `VIEW_V2_` (o el path `/mobility/` por
`/v2/mobility/`). Se listan porque son las que mas facil se cuelan: el nombre v1 sigue
siendo el "natural" al buscar.

`VIEW_AuthorizerLimitsMobility` · `VIEW_AuthorizerLimitsProfitCentersMobility` ·
`VIEW_AuthorizerProfitCentersMobility` · `VIEW_CustomerClassesMobility` ·
`VIEW_CustomerSalesAreasMobility` · `VIEW_DistributionCentersMobility` ·
`VIEW_IndustriesMobility` · `VIEW_IndustrySectorsMobility` ·
`VIEW_OrderTrackingStatusMobility` · `VIEW_PaymentTermsMobility` ·
`VIEW_PriceHistoryMobility` · `VIEW_ProductCostsMobility` ·
`VIEW_ProductsByCustomerMobility` · `VIEW_ProductsBySameHierarchyMobility` ·
`VIEW_ProfitCentersByUserMobility` · `VIEW_ProfitCentersMobility` ·
`VIEW_ReceivablesAgingByCustomerSnapshotMobility` · `VIEW_SalesBudgetItemsMobility` ·
`VIEW_SalesChannelsMobility` · `VIEW_SalesOfficesMobility` · `VIEW_SalesSectorsMobility` ·
`VIEW_SalesZonesMobility` · `VIEW_StockByWarehouseMobility` · `VIEW_UserCentersMobility`

(Mas `VIEW_CustomerSalesAreasByUserMobility` y `VIEW_V2_ProductsMobility_copy1`, que no
tienen gemela directa.)

Las otras 45, marcadas con `x` y en general **sin** reemplazo v2, son las de clientes,
cobranzas, ventas por dimension y los `VIEW_DS_*`. BackOffice no consume ninguna: son el
dominio de MobilityManager.

---

## 6. Como verificar antes de sumar un endpoint

1. Buscar en el repo del Middleware que vista lee el endpoint:
   `grep -n "VIEW_NAME" src/db/repositories/<endpoint>.repository.js`
2. Buscar ese nombre en este documento y en los dos `.xlsx`.
3. Si aparece con marca, usar la `VIEW_V2_*` y el path `/v2/mobility/...`.
4. Si la v2 tampoco existe o tambien esta marcada, **preguntar antes de construir**.

Los `.xlsx` no estan versionados en el repo: viven en la carpeta del proyecto. Este
documento es el resumen aplicado a BackOffice — si el relevamiento se actualiza, hay que
volver a cruzarlo.
