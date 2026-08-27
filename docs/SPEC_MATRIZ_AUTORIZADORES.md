# Matriz de autorizadores — especificacion

> Ultima actualizacion: 2026-08-27 · Version: 2.13.0
>
> Quien puede autorizar en cada sociedad y con que limites. Seccion de **consulta**:
> reemplaza tener que entrar a la base para responder esa pregunta.

---

## 1. El problema que resuelve

Hoy, para saber quien esta en la matriz de autorizadores, hay que consultar la base de
datos a mano. Eso deja la respuesta en manos de quien tiene acceso a SQL, y en la
practica significa que **nadie revisa la matriz hasta que algo falla**: un gerente no
puede aprobar, llama a soporte, y recien ahi alguien mira el dato.

La seccion no solo lista: **marca las filas que no sirven**. Ver §5.

---

## 2. De donde sale el dato

`[SAPServices].[dbo].[AuthorizerLimits]` + `[AuthorizerProfitCenters]`, replicadas de
SAP, consultadas por el Middleware a traves de
`VIEW_AuthorizerLimitsProfitCentersMobility`.

**Es de solo lectura y no se negocia.** Las tablas las sincroniza SAP: una fila cargada a
mano la pisa la proxima sincronizacion. Si hay que cambiar la matriz, es un pedido a SAP,
no un desarrollo. Los tres endpoints del Middleware exponen unicamente `GET`.

### Cual de los tres endpoints

El Middleware expone tres, y el nombre de la tarea apunta al primero:

| Endpoint | Que devuelve | Filas (QATEST, 2026-08-27) |
|---|---|---|
| `/mobility/authorizer-limits` | Bandas por (sociedad, correo). Sin CEBEs | 82 |
| `/mobility/authorizer-profit-centers` | CEBEs por persona, con vigencia. Sin banda | 221 |
| **`/mobility/authorizer-limits-profit-centers`** | **El join — la matriz** | **991** |

Se usa el **tercero**. Es el que el Middleware consulta cuando decide si alguien puede
autorizar (`approverLimits.js`, `businessOrderAuthorizations.repository.js`), asi que es
el unico que garantiza que la pantalla diga lo mismo que el motor. Reconstruir la matriz
cruzando los otros dos a mano es trabajo repetido y una fuente de deriva.

Los tres tienen gemelo `v2` (`VIEW_V2_*`). **Se apunta a v1 a proposito**: es el que ya
corre en produccion. Cuando las vistas V2 esten aplicadas en QATEST y PROD, alcanza con
cambiar `MATRIX_PATH` en `apps/api/src/authorizers/authorizers.client.ts`.

---

## 3. La restriccion que define la pantalla

**`companyCode` es obligatorio.** Sin el, el endpoint responde `400`. No hay forma de
pedir la matriz completa de un saque.

Por eso la pantalla arranca con un **selector de sociedad** y no con una tabla. La
alternativa —13 llamadas, una por sociedad— se descarto: nadie mira 991 filas juntas, y
la sociedad es justamente el eje por el que se razona el alcance de un autorizador.

El maestro de sociedades se reusa de Regiones (`RegionsClient.searchCompanies`, contra
`/v2/mobility/companies`). `RegionsModule` exporta `RegionsClient` para eso: no tiene
sentido tener dos clientes del mismo catalogo.

---

## 4. El grano: por que se agrupa

La vista devuelve **1 fila por (sociedad, correo, CEBE)**. Un gerente con 12 CEBEs llega
como 12 filas.

La pregunta de la tarea es *"quien esta en la matriz"*, asi que el grano de la UI es la
**persona**. `AuthorizersService` agrupa por correo (en minusculas: SAP no garantiza el
case, y la vista joinea por `UserEmail`).

Consecuencia: **la paginacion se hace despues de agrupar**, sobre la sociedad completa.
Paginar en el Middleware partiria a un mismo gerente entre la pagina 1 y la 2. Se trae
todo con `export=1` — son ~120 filas en la sociedad mas grande — y se agrupa, filtra,
ordena y pagina en BackOffice. Es el mismo criterio que el patron *flatten + batch* del
estandar del equipo: cuando el grano de la fuente no coincide con el de la UI, ensambla
el consumidor.

El endpoint combinado **no tiene `search`** (los otros dos si). Por eso la busqueda
tambien se resuelve del lado de BackOffice, sobre el conjunto ya traido.

---

## 5. La trampa: los numeros crudos mienten

**Es el punto que mas facil se pasa por alto.** `MinimumPercentage` y
`MaximumPercentage` vienen crudos, sin interpretar. Pintados literal, la pantalla afirma
cosas falsas:

| Crudo | Se leeria | **Significa** |
|---|---|---|
| `200 / 200` | "de 200% a 200%" | **Sin limite** — cualquier valor >= 100 es un centinela |
| `0 / 0` | "de 0% a 0%" | **Sin configurar**: esa persona no puede firmar nada, solo rechazar |
| `200 / 50` | rango invertido | **Sin piso, techo 50%** — el centinela se aplica por extremo ANTES de juzgar la inversion |
| `40 / 20` | "de 40% a 20%" | **Rango invalido**: el dato esta roto y bloquea |

La regla es del Middleware: `src/utils/approverLimits.js`, funcion `effectiveBand()`.
Aprobar y contraofertar **son firmar** y respetan la banda; **rechazar se permite
siempre** (negar no es firmar).

### Deuda conocida: la regla esta duplicada

`apps/api/src/authorizers/authorizers.band.ts` es una **replica** de `effectiveBand()`.
Se hizo asi porque el endpoint no publica la banda interpretada y habia que entregar la
pantalla.

> **Lo correcto es pedirle al Middleware que devuelva `band: { min, max, blocked, reason }`
> junto a los crudos, y borrar la replica.** El motivo no es purismo: **esta regla ya
> cambio una vez, el 18 de agosto de 2026**, y la lectura anterior era la contraria en los
> casos ambiguos (antes dejaban pasar, ahora bloquean). Una copia sobrevive al cambio
> siguiente mostrando lo viejo **sin fallar**, que es la peor forma de estar equivocado.

Mitigacion mientras la deuda viva: `authorizers.band.spec.ts` fija los casos limite con
los mismos valores que documenta el Middleware, y deja escrito contra que version se
replico. **No detecta un cambio del Middleware** — solo deja el rastro.

---

## 6. El CEBE nulo es un comodin, no una ausencia

`ProfitCenter: null` **no** significa "sin CEBE asignado". Significa **cubre toda la
sociedad**. El Middleware lo resuelve como:

```sql
AND (ProfitCenter = @Pc OR ProfitCenter IS NULL)
```

Es decir: el NULL **amplia** el match. Esa fila es la de **mayor** alcance.

Pintarla como vacia o con un guion invierte el significado, y es el error mas facil de
cometer con esta vista. En el DTO viaja como `coversWholeCompany: true` y en pantalla se
lee **"Toda la sociedad"**.

Quien cubre toda la sociedad **no** cuenta en `withoutActiveProfitCenters`: no depende de
ninguna asignacion, y marcarlo como roto seria senalar justo al de mayor alcance.

---

## 7. Los Country Managers: el otro permiso

**Autorizar "otra forma de pago" no pasa por la matriz.** Lo resuelve el Country Manager
de la sociedad. Hay personas que autorizan documentos todos los dias y **no tienen una
sola fila en `AuthorizerLimits`** (al 2026-08-27, dos en la sociedad 2100).

Una pantalla titulada "quien autoriza" que las omita **miente por omision** y genera
exactamente el ticket que intenta evitar. Por eso van **en la misma pantalla, en una
seccion aparte**, con un rotulo que explica que es otro permiso: no tienen banda ni
CEBEs, y su fuente es
`/mobility/commercial-team-hierarchy/country-manager?companyCode=`.

**Un fallo de esa consulta NO se muestra como "no hay ninguno".** El DTO trae
`available: false` y la UI avisa que la lista esta *incompleta*. Decir "nadie autoriza
otra forma de pago" cuando en realidad fallo la consulta es la misma clase de afirmacion
falsa que la seccion quiere eliminar.

---

## 8. Otras cosas del dato

| Que | Por que importa |
|---|---|
| `validUntil` viene `9999-12-31`, no `null` | Mostrar esa fecha literal confunde. Se renderiza **"Sin vencimiento"** |
| `approvalLevel` viene vacio en todas las filas relevadas | **No se usa como columna** y se saco de la whitelist de sort. Sigue en el DTO por si SAP empieza a cargarlo |
| Los CEBEs se asignan por persona, sin sociedad | El LEFT JOIN une solo por correo. Por eso 82 limites x 221 asignaciones dan 991 filas, y por eso **no se puede** dar un CEBE en una sociedad y no en otra |
| La matriz trae codigos, no nombres | El nombre del CEBE se cruza con `/mobility/profit-centers` (~66 filas, una llamada). Si esa llamada falla, la pantalla sigue con los codigos pelados: es un catalogo de apoyo, no la matriz |
| No hay nombre de persona | Los endpoints de la matriz traen correo y `userId`. Se muestra el correo. (El de Country Managers si trae `memberName`) |
| `activeOnly` no filtra al comodin | El filtro corre sobre `ValidFrom`/`ValidUntil`, que vienen NULL en la fila del comodin, asi que pasa igual. No es un bug: es el grano de la vista |

---

## 9. Roles

**Exclusiva de `SuperAdmin`.** Expone los correos de todos los gerentes con su poder de
firma: es informacion de control interno y no hace falta para ninguna otra tarea del
back-office.

`Usuario` **no entra**. Su regla esta escrita por exclusion (*ve todo lo que no pida
`Soporte`*) para que una seccion nueva le quede visible sin que nadie se acuerde de
sumarlo; por eso hubo que excluir tambien lo que pide `SuperAdmin` explicitamente. Ver
`docs/ROLES_Y_PERMISOS.md` §2 y `apps/web/src/auth/roleAccess.ts`.

---

## 10. Hallazgos para el equipo del Middleware

**No son de BackOffice** y no bloquean esta seccion.

1. **Los endpoints `authorizer-*` no llevan `requireApiKey`.** A diferencia de
   `/api/mobility/support`, estan montados sin ninguna proteccion: cualquiera que llegue
   al `:6002` lista los correos de todos los gerentes con su banda de firma. (Y
   `requireApiKey` es ademas no-op mientras `MIDDLEWARE_API_KEY` no este seteada —
   pendiente ya conocido.)

2. **`approvalNotifierService.js` no avisa al comodin.** `resolveAuthorizerEmails`
   (lineas 34-43) matchea el CEBE por igualdad exacta tratando el NULL como `''`, asi que
   a un autorizador "toda la sociedad" **no le llega el mail** de `ReadyForApprove`,
   aunque el motor de decision si lo habilite a firmar. Los repositorios de
   autorizaciones usan `OR ProfitCenter IS NULL`; el notificador no. Son dos lecturas
   distintas del mismo dato dentro del mismo repo.

3. **La banda interpretada deberia salir por HTTP.** Ver §5.

---

## 11. Archivos

**Backend** (`apps/api/src/authorizers/`)

| Archivo | Que hace |
|---|---|
| `authorizers.client.ts` | Middleware: matriz, maestro de CEBEs, Country Managers |
| `authorizers.band.ts` | Replica de `effectiveBand()` — ver la deuda de §5 |
| `authorizers.service.ts` | Agrupa por persona, resume, filtra, ordena y pagina |
| `authorizers.controller.ts` | `@Roles(SuperAdmin)`, whitelist de sort y filtro |
| `authorizers.module.ts` | Importa `RegionsModule` por el maestro de sociedades |

**Frontend** (`apps/web/src/components/autorizadores/`)

| Archivo | Que hace |
|---|---|
| `autorizadores.format.ts` | La traduccion a castellano de banda, vigencia y alcance |
| `CompanySelect.tsx` | Typeahead de sociedad (§3) |
| `MatrixSummaryBar.tsx` | El semaforo; cada contador es tambien un filtro |
| `AuthorizersTable.tsx` | Una fila por persona; los crudos quedan en el detalle |
| `CountryManagersPanel.tsx` | El otro permiso (§7) |
| `AuthorizersPanel.tsx` | Compone y maneja el estado |

---

## 12. Checklist de verificacion

- [ ] Cambiar de sociedad recarga la matriz y el total coincide con `pagination.total`.
- [ ] Una fila con `profitCenter: null` se muestra como **"Toda la sociedad"**, no vacia.
- [ ] Una `200/200` se muestra como **"Sin limite"**; una `0/0` como **"Sin configurar"**.
- [ ] Una `200/50` se muestra como **"Hasta 50%"**, no como rango invalido.
- [ ] `validUntil: 9999-12-31` se muestra como **"Sin vencimiento"**.
- [ ] Los Country Managers de la sociedad aparecen, aunque no esten en la matriz.
- [ ] Un fallo de esa consulta dice **"incompleta"**, no "no hay ninguno".
- [ ] Una sociedad sin autorizadores muestra un vacio explicado, no una tabla en blanco.
- [ ] El header `x-source-app: MobilityBackOffice` viaja en todas las llamadas (`ApiLogs`).
- [ ] Un usuario con rol `Usuario` **no** ve la seccion ni entra por URL directa.

### Sin abrir la app

```bash
# la matriz de una sociedad — es el endpoint de la pantalla
curl "http://localhost:6002/api/mobility/authorizer-limits-profit-centers?companyCode=2100&limit=5"

# la restriccion: sin companyCode responde 400
curl "http://localhost:6002/api/mobility/authorizer-limits-profit-centers"

# el selector de sociedades
curl "http://localhost:6002/api/v2/mobility/companies?limit=20"

# el otro permiso, el que no sale de la matriz
curl "http://localhost:6002/api/mobility/commercial-team-hierarchy/country-manager?companyCode=2100"
```

---

## 13. Lo que NO se hizo

- **Alta ni edicion.** Ver §2: la matriz se replica de SAP.
- **Vista de todas las sociedades juntas.** Ver §3.
- **Nombre de la persona.** Se muestra el correo; cruzar contra `Users` quedaria como
  otra fuente mas, con los correos sin match quedando igual sin nombre.
- **Migracion a v2.** Ver §2.
- **Los tres hallazgos de §10** — son del Middleware.
