# Cuatro hallazgos para el equipo del MobilityMiddleWare

> 2026-08-27 · Detectados construyendo la matriz de autorizadores en MobilityBackOffice
> (v2.14.0). **Ninguno bloquea esa entrega** — la seccion ya esta funcionando.
>
> Texto listo para pegar en un mensaje o un issue.

---

## 1. Los endpoints `authorizer-*` no tienen ninguna proteccion

`/api/mobility/authorizer-limits`, `/authorizer-profit-centers` y
`/authorizer-limits-profit-centers` (y sus `v2`) estan montados **sin `requireApiKey`**, a
diferencia de `/api/mobility/support`:

```js
// src/app.js
app.use('/api/mobility/support', requireApiKey, supportRouter);   // <- protegido
app.use('/api/mobility/authorizer-limits', authorizerLimitsMobilityRouter);  // <- no
```

Cualquiera que llegue al `:6002` lista **los correos de todos los gerentes con su banda de
firma**. Es el mapa completo de quien puede autorizar cuanto descuento.

Se suma a que `requireApiKey` es hoy un **no-op** mientras `MIDDLEWARE_API_KEY` no este
seteada, que ya era un pendiente conocido. El punto nuevo es que estos endpoints ni
siquiera lo declaran: encender la key no los cubre.

**Sugerencia:** montarlos con `requireApiKey` junto con el resto.

---

## 2. Al autorizador "toda la sociedad" no le llega el mail de `ReadyForApprove`

Hay **dos lecturas distintas del mismo dato** dentro del repo.

Los repositorios de autorizaciones tratan el `ProfitCenter` NULL como comodin, que es lo
correcto:

```sql
-- businessOrderAuthorizations.repository.js:729 (y businessQuoteAuthorizations)
-- "La matriz keyea por UserEmail. ProfitCenter NULL en la matriz = cubre toda la sociedad."
AND (ProfitCenter = @Pc OR ProfitCenter IS NULL)
```

Pero el notificador lo compara por igualdad exacta, tratando el NULL como cadena vacia:

```js
// approvalNotifierService.js:37-43
const wantPc = (profitCenter == null ? '' : String(profitCenter).trim()).toLowerCase();
const rowPc  = (r.profitCenter == null ? '' : String(r.profitCenter).trim()).toLowerCase();
// ...compara rowPc === wantPc
```

**Efecto:** un autorizador con `ProfitCenter` NULL **puede firmar** cualquier documento de
la sociedad, pero **no recibe el aviso** cuando uno entra a `ReadyForApprove` (salvo que el
documento tampoco traiga CEBE). Al 2026-08-27 son 2 filas de 991 en QATEST, asi que es
poco visible pero afecta justo a los de mayor alcance.

**Sugerencia:** que `resolveAuthorizerEmails` acepte la fila cuando `r.profitCenter == null`,
igual que hacen los repositorios de autorizaciones.

---

## 3. La banda interpretada no sale por HTTP

`effectiveBand()` (`src/utils/approverLimits.js`) es pura, sin dependencias y ~30 lineas,
pero solo se usa puertas adentro al decidir sobre un documento. El endpoint devuelve
`MinimumPercentage`/`MaximumPercentage` **crudos**, y crudos mienten:

| Valor | Se leeria | Significa |
|---|---|---|
| `200 / 200` | "de 200% a 200%" | Sin limite |
| `0 / 0` | "de 0% a 0%" | Sin configurar: **no puede firmar nada** |
| `200 / 50` | rango invertido | Sin piso, techo 50% |

Cualquier consumidor que quiera mostrar la matriz tiene que **reimplementar la regla**.
BackOffice hoy la tiene copiada, y no nos gusta: **esa regla ya cambio una vez, el 18 de
agosto**, y la lectura anterior era la contraria en los casos ambiguos (antes dejaban
pasar, ahora bloquean). Una copia sobrevive al proximo cambio mostrando lo viejo **sin
fallar**, que es la peor forma de estar equivocado.

**Sugerencia:** agregar `band: { min, max, blocked, reason }` a cada fila de
`authorizer-limits-profit-centers`, junto a los crudos. Es reusar la funcion que ya
existe. En cuanto este, borramos la copia.

---

## 4. Los Country Managers se identifican por el NOMBRE del nodo

`getCountryManagersByCompany` filtra asi:

```sql
WHERE cth.Name LIKE 'COUNTRY MANAGER%'
```

Es una convencion de **texto libre**, no un flag ni un tipo. Existe
`CommercialTeamMembers.Role`, pero no se usa para filtrar.

**Efecto:** si alguien renombra el nodo ("Country Mgr", "CountryManager", un prefijo), el
endpoint deja de devolver a todos **sin un solo error**: responde `200` con lista vacia,
indistinguible de "esta sociedad no tiene ninguno". Lo mismo con el `INNER JOIN` a `Users`:
un CM sin esa fila, o con `SapCompanyCode` vacio, desaparece igual de callado.

Importa porque autorizar "otra forma de pago" **no pasa por la matriz**: lo resuelve el
Country Manager. Una pantalla que los omita en silencio afirma algo falso sobre quien
autoriza.

BackOffice lo mitigo consultando `/commercial-team-hierarchy/tree` cuando la lista viene
vacia, para distinguir "no hay nodo" de "hay nodo sin miembros de esta sociedad" — pero es
una heuristica que **replica el mismo `LIKE`**, asi que hereda el problema.

> El matcheo por `Users.SapCompanyCode` en vez de `cth.Country` **esta bien** y el
> comentario del codigo explica por que (Guatemala tiene GT y BAN con las sociedades 2100 y
> 2200). Eso no se toca.

**Sugerencia:** un flag en `CommercialTeamHierarchies`, o usar `CommercialTeamMembers.Role`,
para que sea un contrato de dato y no de convencion de nombre.

---

## Prioridad sugerida

| # | Hallazgo | Por que |
|---|---|---|
| 1 | Endpoints sin proteccion | Es exposicion de datos, y el fix es una linea por ruta |
| 2 | El comodin no recibe el mail | Bug silencioso en el flujo de autorizacion, no solo de lectura |
| 4 | CM por nombre de nodo | Falla en silencio y afecta a un permiso que no tiene otra fuente |
| 3 | Banda por HTTP | Deuda de diseno; hoy la sufre solo BackOffice |

Detalle completo, con el contexto de la pantalla que los encontro, en
`docs/SPEC_MATRIZ_AUTORIZADORES.md` §10 del repo de MobilityBackOffice.
