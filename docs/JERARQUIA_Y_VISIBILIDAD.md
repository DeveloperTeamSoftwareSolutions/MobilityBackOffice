# Jerarquia y visibilidad — Mobility BackOffice

> Ultima actualizacion: 2026-09-18
> Version: 2.36.0

Que ve cada usuario y por que. Documento vivo: actualizar en cada iteracion que agregue o cambie
una seccion.

## Hay DOS ejes, y casi todas las secciones usan uno solo

| Eje | Que recorta | De donde sale |
|---|---|---|
| **Rol** | Que **secciones** abre el usuario | ITManager, firmado en el token propio de BackOffice (`@Roles` + `RolesGuard`) |
| **Alcance por sociedad** | Que **filas** ve dentro de una seccion | `GET /mobility/user-scope` del Middleware, via `ScopeService` |

**En casi todas las secciones, tener el rol es ver la seccion entera.** La unica que lleva tambien
el segundo eje es **Centros y Almacenes**.

Eso no es una inconsistencia que haya que emparejar: es una diferencia en la naturaleza del dato.

| Seccion | ¿Lleva alcance por sociedad? | Por que |
|---|:--:|---|
| **Centros y Almacenes** | **Si** | Configuracion **operativa** de una sociedad: quien reserva almacenes lo hace sobre los suyos |
| Regiones comerciales | No | Dato **maestro global** (ver abajo) |
| Consola de soporte | No | Es el rol de trazabilidad total del DevelopersTeam: recortarlo seria contrario a su razon de ser |
| Ordenes rechazadas por SAP | No | Bandeja unica de BackOffice; el Middleware ya la sirve sin el scope de vendedor |
| Matriz de autorizadores | No | Solo lectura y exclusiva de SuperAdmin; se pide por sociedad **elegida**, no por sociedad **permitida** |
| Plantillas de WhatsApp · RAG | No | La cuenta WABA es implicita en la key; el RAG tiene su propio tenant, manual |

Quien es **admin en la jerarquia** (`Users.IsAdmin`) no se recorta por sociedad. Es un eje distinto
del rol de BackOffice: hay que tener los dos.

## Roles

Los define ITManager (app `MobilityBackOffice`). El login resuelve **uno solo** por prioridad y lo
firma en el token propio. La lista completa, la prioridad y que pierde cada combinacion estan en
**`docs/ROLES_Y_PERMISOS.md`**, que es la autoridad; aca solo interesa como se cruzan con el
alcance.

El `RoleGuard` del frontend oculta lo que no corresponde, pero **no es la barrera**: la decision la
toma el guard del backend. Ver la nota de seguridad en `docs/AUTENTICACION.md`.

> ⚠️ **`Usuario` va listado en el `@Roles` de toda seccion que no pida un rol deliberado.** El front
> decide por exclusion, asi que una seccion nueva le queda visible sola. Si el controller declarara
> solo `Administrador`, la seccion le apareceria en el menu y la API le responderia 403: pantalla
> visible y rota, sin que falle ningun test ni la compilacion. Regiones y Almacenes lo declaran asi.

## Centros y Almacenes — CON alcance por sociedad

La unica seccion de BackOffice que recorta filas por quien es el usuario. El alcance **no se calcula
aca**: se le pide al Middleware, que es el dueño de la jerarquia.

Las dos mitades de la regla no son simetricas, y es deliberado:

| | Fuera del alcance |
|---|---|
| **Lecturas** — centros, almacenes, reservas, buscador de grupos | **Vacio.** Mirar no es una accion prohibida: no hay nada suyo ahi. Un 403 seria ruido |
| **Escrituras** — reservar, quitar, restringir | **403**, antes de llamar al Middleware y antes de auditar |

Dos cosas que hay que saber al tocar esto:

- **`companyCodes` vacio significa dos cosas opuestas** segun `isAdmin`: con `isAdmin: true` es "no
  filtrar" (ve todas); con `isAdmin: false` es "no ve ninguna". Por eso los dos campos viajan juntos
  y el consumidor tiene que mirar los dos.
- **La cache del `ScopeService` no es un adorno.** Guarda la **promesa**, no el resultado, porque el
  2026-08-12 se vieron en produccion **siete `user-scope` identicos en el mismo segundo**, todos
  muriendo por timeout: una pantalla dispara varias requests a la vez y cada una resolvia el alcance
  por su cuenta. Con una cache de resultados las siete fallan el lookup en el mismo instante y salen
  igual. Portarla sin eso repite el incidente; hay un test que lo fija.

El buscador de clientes es la excepcion prevista: **no** se recorta por sociedad, porque el maestro
de clientes es global y el alcance corta donde importa, que es al reservar.

Detalle de la seccion en `docs/SPEC_BACKOFFICE_ALMACENES.md`.

## Regiones comerciales — SIN eje jerarquico

El modulo de Regiones **no filtra por la jerarquia de usuarios** (subarbol SAP, cartera, pais). No
hay `ScopeService` en juego **en esta seccion**.

- Todo Administrador ve **todas** las regiones y **todos** sus vinculos CEBE-sociedad.
- No hay recorte por quien es el usuario mas alla del rol.

La razon es que el mapa region-CEBE es **dato maestro global**, no datos operativos de una cartera:
define como se consolidan los reportes para toda la organizacion, asi que no tendria sentido que
cada administrador viera un subconjunto. Esto se decidio al portar el modulo desde MobilityManager,
donde tampoco tenia eje jerarquico.

> Hasta 2026-09-18 este documento decia que **en BackOffice** no habia `ScopeService` en juego. Era
> cierto mientras Regiones era la unica seccion con datos por sociedad; con el traspaso de Almacenes
> dejo de serlo, y la frase se acoto a Regiones. Que Almacenes lleve alcance **no es un precedente
> para sumarselo a Regiones**: el argumento de arriba sigue en pie, y acotarlo seria un cambio de
> diseño nuevo, no un ajuste.

## Diferencia con MobilityManager

En MM las lecturas de Regiones estaban abiertas a cualquier autenticado porque las consumian
reportes externos via `/:code/resolve`. En BackOffice el unico consumidor es esta UI, y todo el
modulo exige rol (lecturas incluidas): dejar el mapa legible para Marketing contradiria que la
seccion no se le muestre. Si un reporte necesitara `/resolve`, la via es el sync por API key o sumar
el rol al decorador.

**Almacenes hereda esa misma decision**: en MM sus lecturas quedaban abiertas, aca van gateadas por
el rol de la seccion. Lo que **no** cambia en el traspaso es el alcance por sociedad, que funciona
igual que alla y contra el mismo endpoint del Middleware. Ver `docs/API_ENDPOINTS.md`.
