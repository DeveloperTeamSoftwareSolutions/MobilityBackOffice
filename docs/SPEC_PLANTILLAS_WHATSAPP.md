# Plantillas de WhatsApp — especificacion

> Ultima actualizacion: 2026-08-31 · Version: 2.23.0
>
> Seccion "Templates de WhatsApp" (rol Marketing). Consulta, crea y edita las plantillas
> del panel WABA sin abrirlo y sin un segundo login.

---

## 1. Que resuelve

Que el equipo de marketing **arme y administre** las plantillas de WhatsApp —saludos,
mensajes de fechas especiales, avisos— sin entrar al panel por afuera y sin un segundo
login.

### No confundir con "Panel de WhatsApp"

Hubo una seccion aparte, embebida por iframe, que mostraba el panel WABA completo
(conversaciones de Duwy Chat). **Se descarto** (PR #4, cerrado sin mergear): el objetivo
era una sola pantalla, y el iframe arrastraba el login propio de WABA.

---

## 2. El enfoque: el patron de MobilityManager

MobilityManager ya consume WABA y **no embebe nada**:

```
[MM web] -> [MM API /api/waba/*] -> [Middleware /api/waba/*] -> base WhatsAppWABA
```

Arma UI propia y consume **datos**. Por eso no necesita login: nunca habla con el panel.
No hay ningun cruce de identidades con WABA — el scope se resuelve por telefono via
`WhatsAppConnections`. Ver `MobilityManager/docs/WABA.md`.

BackOffice adopta ese criterio para plantillas.

### La diferencia: va directo a WABA, no por el middleware

| | MobilityManager | BackOffice (esta seccion) |
|---|---|---|
| Fuente | Middleware `/api/waba/*` | **WABA `/api/templates`** |
| Auth hacia la fuente | `x-api-key` opcional | `x-api-key` **obligatoria** |
| UI | propia | propia |

**Por que directo:** el middleware **no expone plantillas** (solo conversaciones,
mensajes y media). Ir por ahi exigiria un endpoint nuevo en un tercer repo para leer algo
que WABA ya publica. Si mas adelante se quiere alinear del todo con MM, el cambio es
mover `TEMPLATES_PATH` al middleware.

Es una fuente nueva para BackOffice, que hasta ahora solo hablaba con el middleware e
ITManager. Queda anotado en `docs/EXTERNAL_APIS.md`.

---

## 3. Como se autentica

`GET /api/templates` de WABA se monta con `requireAuth` **sin** `requireRole`, y
`requireAuth` acepta el header `x-api-key`. Por eso funciona sin sesion.

**La cuenta WABA es implicita en la key**: WABA la resuelve con
`wabaAccountModel.findByApiKey()`. No se manda ningun identificador de cuenta, y **una key
= una cuenta**. Si hicieran falta varias, hace falta una key por cuenta.

Se manda tambien `x-source-app: MobilityBackOffice` para que los `InternalApiLogs` de
WABA sepan quien llamo.

---

## 4. Lo que hay que interpretar del dato

### Los JSON dentro de columnas de texto

WABA guarda botones y variables como JSON **dentro de una columna de texto**
(`ButtonsJson`, `VariablesJson`). Ese texto puede venir vacio, nulo o mal formado — las
plantillas viejas, sincronizadas de META antes de que WABA guardara esas columnas, no las
traen.

Un `JSON.parse` suelto tumbaria la pantalla entera por **una sola fila con un dato
viejo**. `templates.util.ts` parsea de forma defensiva y devuelve el default (array
vacio) ante cualquier problema.

### Las variables tienen fallback

Si `VariablesJson` falta o esta roto, las variables se **deducen del propio `BodyText`**
buscando los `{{...}}`. Importa porque una plantilla con variables **no se puede enviar
sin completarlas**, y sin el fallback la pantalla daria a entender que si.

### El estado lo decide META, no la empresa

Una plantilla no se "guarda": se **envia a META para aprobacion**. Por eso cada estado
lleva una aclaracion (`statusHint`): "En revisión" no es algo que se pueda destrabar desde
BackOffice.

Un estado que META agregue y no este en la lista se muestra como "Sin estado" en vez de
hacerlo pasar por uno conocido.

---

## 5. Se ven todos los estados

El `GET /api/templates` de WABA tenia **dos limitaciones** para una pantalla de
gestion, y las dos se resolvieron agregando endpoints en WABA (rama
`feature/task-templates-api-rest`):

1. Devolvia **solo las aprobadas** (`findAllApproved`). Las PENDING y las rechazadas
   —las que hay que atender— no llegaban.
2. **No habia escritura** por API: crear y editar solo existian como rutas HTML con
   `requireRole`, que la `x-api-key` no satisface.

### El GET tiene dos modos, y el viejo NO cambio

| Llamada | Devuelve |
|---|---|
| `/api/templates` sin params | Array plano de **aprobadas** — el contrato de siempre |
| `/api/templates?status=all` | `{ data, pagination }` con **todos** los estados |

La compatibilidad no es un detalle: `public/js/sendMessage.js` del propio panel usa el
primer modo para el selector de plantillas al enviar un mensaje, y ahi ofrecer una
rechazada no tendria sentido. Cambiar esa forma habria **roto el envio de mensajes de
WABA**.

BackOffice pide `status=all`. `onlyApproved` sigue en el DTO por si la fuente vuelve a
filtrar: entonces la UI avisa sola.

---

## 6. Crear y editar

Los endpoints de WABA **reusan `templateService`**, que es donde vive el dialogo con
META. No hay una segunda integracion que mantener sincronizada:

```
GET    /api/templates/:id                 detalle + politica de edicion
POST   /api/templates                     crear y enviar a aprobacion
PUT    /api/templates/:id                 editar y reenviar
DELETE /api/templates/:id                 borrar (META y local; un borrador, solo local)
POST   /api/templates/sync                traer de META lo que cambio alla
POST   /api/templates/validate            el JSON que se le mandaria a META (no escribe nada)
POST   /api/templates/upload-sample       el archivo de ejemplo del encabezado multimedia
POST   /api/templates/drafts              guardar el avance sin mandar nada a META
GET    /api/templates/drafts/:id          recuperar un borrador
POST   /api/templates/drafts/:id/submit   recien aca el borrador se manda a META
```

> Orden de rutas: las literales (`status`, `sync`, `validate`, `upload-sample`,
> `drafts`) van **antes** de `:id`, si no entran como identificador.

### Dos modos, un solo estado

Igual que WABA, hay **asistente** y **modo avanzado**, y se alterna entre los dos sin
perder lo cargado.

| | Asistente | Modo avanzado |
|---|---|---|
| Pregunta | el **objetivo** ("avisar algo a un cliente") | la **categoria** de META (`UTILITY`) |
| Nombre tecnico | se propone desde el titulo | se escribe |
| Forma | 6 pasos, cada uno con lo que falta explicado | todo junto |
| Para | armar desde cero | corregir algo puntual, o editar |

**El estado vive en `TemplateEditor`**, no en cada modo: alternar cambia que se dibuja,
no los datos. WABA hace lo mismo por otra via —guarda un borrador y redirige, porque son
dos paginas del servidor—; aca es una sola pantalla y el cambio es inmediato.

Aun asi el borrador **tambien** se guarda al alternar, como en WABA: el estado en memoria
se pierde si se cierra la pestaña. Si ese guardado falla, se cambia de modo igual y queda
el aviso — perder el modo por un error de red seria peor que quedarse sin borrador,
porque los datos siguen en pantalla.

**Editar tambien arranca en el asistente**, igual que crear: es la forma en la que la
pantalla explica cada paso, y no hay motivo para negarsela a quien corrige una plantilla.
Lo que cambia es que el **nombre y el idioma quedan bloqueados** —META los toma como
identidad— y que el titulo amigable se reconstruye del nombre tecnico
(`promo_navidad_2026` -> `Promo navidad 2026`), porque no se guarda en META y sin el el
asistente se trabaria pidiendo algo que ya esta decidido.

### Que se puede editar, y cuando

Las reglas son de META. Las evalua WABA (`services/templateEditPolicy.js`) y viajan con
el detalle; BackOffice las traduce y las muestra, **no las vuelve a decidir**.

| Estado | Se puede editar | Cupo |
|---|---|---|
| `DRAFT` | si, sin llamar a META (no vive alla) | sin limite |
| `APPROVED` | si | 10 cada 30 dias, 1 por dia |
| `REJECTED` | si — corregir y reenviar | sin limite |
| `PAUSED` / `DISABLED` | si | sin limite |
| `PENDING` | **no**: hay una revision en curso | — |

Editar una aprobada **la devuelve a revision**, y mientras tanto podria no poder
enviarse. Se avisa antes de escribir, no al guardar.

> Los numeros del cupo **no estan en la documentacion de META**: WABA los toma de
> terceros que integran la misma API y coinciden entre si. Por eso se muestran como aviso
> y **nunca bloquean** — la ultima palabra la tiene META. Ademas el conteo es propio: si
> alguien edita desde el Business Manager de Meta, el numero queda desactualizado, y la
> pantalla lo dice.

**Dos traducciones que hay que hacer y no son opcionales**, las dos en `mapEditPolicy`
(`templates.util.ts`):

1. **WABA manda `allowed`, no `canEdit`.** Leer la propiedad equivocada daba `undefined`,
   y `undefined === false` es falso: la pantalla dejaba editar una plantilla en revision y
   el rechazo aparecia recien al guardar, con el formulario ya completo.
2. **`reason` y `warnings` son claves i18n** (`templates.edit.blockedInReview`), no
   frases: el panel de WABA las resuelve con su diccionario. Los textos se copian de
   `locales/es.json` para que las dos aplicaciones digan lo mismo.

Sin politica se asume que **no** se puede editar: es lo unico honesto cuando no se sabe.

La pantalla lo aplica en tres lugares, de menos a mas caro de descubrir: el boton
**Editar** de la fila viene apagado si el estado no admite edicion; abrir el detalle
confirma contra la politica y no abre el formulario si META lo bloquea; y el formulario
—en los dos modos— muestra el cupo, la espera y el aviso de que vuelve a revision.


### Moverse entre los pasos

Cada paso de la barra es un boton: se llega a uno cuando **todos los anteriores estan
completos**. La regla sale del formulario, no de por donde paso el usuario, y por eso
resuelve los dos casos sin tratarlos distinto:

- **Creando**, el formulario arranca vacio: hay que ir en orden. Pero una vez completado
  el paso 3, se puede volver a el desde el final con un clic, en vez de apretar
  "Anterior" tres veces.
- **Editando**, la plantilla ya trae todo cargado, asi que todos los pasos estan
  disponibles desde el arranque. Obligar a recorrerla en orden no tendria sentido.

Un paso al que todavia no se puede llegar va apagado y **dice que falta** en el tooltip:
apagado sin motivo deja a la persona adivinando.

### La categoria, a la vista

El asistente pregunta por el objetivo ("promocionar algo"), pero META, el costo por
envio y el resto del equipo hablan de **MARKETING**. Cada opcion muestra la categoria a
la que corresponde: sin eso, la traduccion queda en la cabeza de cada uno. El modo
avanzado ya elige la categoria por su nombre.

### Borradores

Una plantilla se arma en varias sesiones —hay que conseguir el texto aprobado, el arte
del encabezado—. Sin borradores lo unico posible era enviarla o perderla.

- `POST /drafts` sin `draftId` crea; **con** `draftId` actualiza ese mismo. El id se
  guarda en una `ref`, no en estado: dos guardados seguidos leyendo un valor viejo
  dejarian un borrador duplicado por cada uno.
- Un borrador nunca llego a META. Se borra solo local, y su `status` es `DRAFT`.
- Solo en alta: **lo que ya existe en META no es un borrador**, asi que en edicion el
  boton no aparece.

### Editar un borrador no es editar una plantilla de META

Son dos operaciones distintas en WABA, y confundirlas **falla en silencio**. Un `PUT`
sobre un borrador entra por `updateTemplate`, que ve `requiresMeta: false`, guarda
local y lo deja en `DRAFT`: la pantalla decia "enviada a revision" y a META no habia
llegado nada.

Por eso hay **tres** caminos al guardar, no dos:

| Que se esta editando | Guardar el avance | Enviar a META |
|---|---|---|
| Alta (nada todavia) | `POST /drafts` | `POST /templates` |
| Un borrador (`DRAFT`) | `POST /drafts` con su `draftId` | `POST /drafts/:id/submit` |
| Una plantilla de META | — no es un borrador | `PUT /templates/:id` |

Al abrir un borrador, `draftId` arranca con **el id de esa plantilla**. Sin eso, cada
cambio de modo creaba un borrador nuevo y dejaba el original sin tocar — se veia como
"los cambios no se guardan", cuando en realidad se guardaban en otro lado.

Y el boton dice **"Enviar a revision"**, no "reenviar": un borrador nunca estuvo en
revision.

### Reabrir un borrador lo devuelve donde quedo

Un borrador se abre con `GET /api/templates/drafts/:id`, **no** con el detalle de la
plantilla. El detalle no alcanza, y lo que le falta no se nota hasta que hace falta:

| | Detalle (`/templates/:id`) | Borrador (`/drafts/:id`) |
|---|---|---|
| Titulo amigable | — no viaja a META | si |
| Archivo del encabezado | vuelve en `headerContent`, que el formulario ignora | `headerHandle` |
| Variables | `["1", "2"]` | nombre y **ejemplo** de cada una |

Los ejemplos son lo mas caro de perder: **META los exige**, y son lo unico que hay que
escribir a mano. Reabrir por el detalle convertia "seguir manana" en "empezar de
nuevo", y ademas era silencioso — la plantilla se veia completa.

Si el borrador no se puede traer, el formulario **se abre igual** con lo que haya y lo
avisa: quedarse sin poder abrirlo seria peor que abrirlo incompleto.

Una trampa del dato: WABA completa `otpType`, `expirationEnabled`,
`codeExpirationMinutes` y `addSecurityRecommendation` con valores por defecto en
**todos** los borradores, sea cual sea la categoria. `mapDraft` los aplica solo si la
plantilla es de autenticacion; copiarlos sin mirar le prende la advertencia de
seguridad y un vencimiento de 10 minutos a un borrador de marketing que nunca los tuvo.

### El archivo de ejemplo del encabezado

META **exige ver el medio** para revisar una plantilla con encabezado de imagen, video o
documento. Es la confusion mas probable de la pantalla, asi que esta dicha explicitamente:
*no es el archivo que se envia a los clientes* — ese lo elige quien manda cada mensaje.

El archivo va a WABA, que es quien tiene la credencial de META; BackOffice no habla con
META. WABA usa la **Resumable Upload API** (contra el App ID, no contra el
`phone_number_id`) y devuelve un `handle`. Lo que se guarda es el handle: el archivo no
vuelve a viajar, ni siquiera al reenviar la plantilla.

La subida ocurre **al elegir el archivo**, no al enviar la plantilla. Asi que el archivo
ya esta en META antes de guardar el borrador, y el handle viaja con el: quien deja una
plantilla a medias y vuelve al otro dia **no tiene que subirlo de nuevo**. Lo que no se
guarda es el **nombre** del archivo —solo servia para mostrarlo mientras se subia—, asi
que al reabrir dice "Archivo ya subido a META" en vez del nombre original.

> Cuanto le dura el handle a META no esta documentado del lado de WABA. Si caduca, el
> envio falla y hay que volver a subirlo; la pantalla lo dice cuando muestra un archivo
> que viene de un borrador.

Los tipos se cortan en los dos lados (JPG/PNG, MP4/3GP, PDF) y el tamaño en 25 MB, para
no subir algo que va a rebotar del otro lado.

### Un error no se ve como un aviso

Tres niveles, con color y marca distintos. Antes `warn` y `notice` compartian el mismo
ambar, asi que "el boton 1 necesita un numero de telefono" y "al enviarla queda en
revision de META" se leian igual: uno hay que corregirlo, el otro solo hay que saberlo.

| Clase | Que dice | Color |
|---|---|---|
| `.bo-pl__warn` | algo esta mal y frena | rojo, marca `!` |
| `.bo-pl__notice--warn` | conviene saberlo antes (cupo bajo, espera) | ambar, marca `!` |
| `.bo-pl__notice` | informacion | azul, marca `i` |

La marca ademas deja claro el nivel cuando el color no alcanza (daltonismo, impresion).

El aviso de "queda en revision de META" salio del paso de revision y va **pegado a la
botonera**, que es la que dispara eso mismo: arriba y lejos del boton no se leia como
"esto pasa si aprieto aca".

### El JSON, plegado

Se puede ver el payload exacto que recibe META, y el de los botones por separado. Sirve
para dos cosas: entender un rechazo —el mensaje de META habla de
`components[1].parameters`, no de "el boton de abajo"— y pegarle el payload a quien
integra.

**No se arma en el front.** Lo genera WABA con el mismo codigo del envio real
(`buildMetaComponents`), asi lo que se muestra es exactamente lo que viaja. Una segunda
version en el front podria desincronizarse en silencio y mostrar algo que no es. Va
cerrado por defecto y se vuelve a pedir si el formulario cambio mientras estaba abierto:
un JSON viejo seria peor que ninguno.

### Tres cosas que la pantalla deja explicitas

**Crear no es guardar.** La plantilla se envia a META y queda "En revision". El estado
lo decide META, tarda, y puede rechazarla. Por eso `status` nunca se acepta como
entrada y el boton dice "Enviar a revision de META", no "Guardar".

**El nombre y el idioma no se cambian.** META los toma como identidad de la plantilla.
En edicion van bloqueados en los dos modos y el `PUT` ni siquiera los lee.

**AUTHENTICATION es otra cosa.** Ahi META **escribe el texto** y lo traduce: no hay
mensaje, ni encabezado, ni botones que configurar. Solo la advertencia de seguridad, la
validez del codigo (1 a 90 minutos) y el boton de copiar. El asistente reemplaza los
pasos de contenido por el del codigo, y no muestra vista previa porque el texto todavia
no existe.

### La validacion corre en dos lugares, y no es duplicacion

| Donde | Para que |
|---|---|
| `plantillas.validate.ts` (front) | Avisar **mientras se escribe**. Un rechazo de META cuesta horas o dias |
| `templateValidator.js` (WABA) | La autoridad. Es el **mismo** que usan el asistente y el formulario del panel |

El front no decide nada: si su chequeo pasa pero WABA rechaza, el error de WABA se
muestra tal cual. Lo que evita es el viaje de ida y vuelta por algo que ya se sabe que
esta mal — una variable salteada, un texto de mas, cuatro botones de respuesta rapida.

La regla que mas se rompe: **las variables tienen que ir `{{1}}, {{2}}, {{3}}` sin
saltos**, y el encabezado numera aparte del cuerpo. META numera los ejemplos por posicion
y un hueco es rechazo.

### Los errores del servidor se muestran, no se tapan

El client traduce los 4xx de WABA a errores de Nest conservando el mensaje: son cosas que
quien escribe la plantilla puede corregir. Un `409` es el caso mas claro — "esta en
revision, no se puede editar ahora" no es una falla del servidor.

En un **5xx tambien se conserva el motivo** cuando WABA lo mando en su sobre JSON. No es
un stack trace: WABA lo arma con `friendlyError`, que ya extrajo el mensaje de META y le
**enmascaro el access token** —META lo devuelve completo cuando es invalido—. Tirarlo
convertia un problema configurable ("Malformed access token") en un 503 mudo, imposible
de diagnosticar desde la pantalla.

---

## 7. Archivos

**Backend** (`apps/api/src/templates/`)

| Archivo | Que hace |
|---|---|
| `templates.client.ts` | WABA `/api/templates` con `x-api-key`; conserva sus mensajes de error |
| `templates.util.ts` | Parseo defensivo, variables con fallback, resumen, `mapEditPolicy` |
| `templates.service.ts` | Filtra, ordena, pagina; `aPayloadWaba` es el **unico** armador |
| `templates.controller.ts` | `@Roles(Marketing)`, whitelist de sort y estado, CRUD, borradores, subida |

**Frontend** (`apps/web/src/components/plantillas/`)

| Archivo | Que hace |
|---|---|
| `plantillas.api.ts` | Llamadas al API y `aPayload`: el **unico** armador del lado del front |
| `plantillas.format.ts` | La traduccion a castellano de estados, categorias e idiomas |
| `plantillas.validate.ts` | Las reglas de META, para avisar mientras se escribe |
| `wizard.helpers.ts` | Nombre tecnico, variables, pasos y **el motivo** por el que no se avanza |
| `TemplatePreview.tsx` | **Como le llega el mensaje al cliente**: burbuja, formato, botones, ejemplos |
| `TemplateWizard.tsx` | El asistente de 6 pasos |
| `TemplateForm.tsx` | El modo avanzado, y la edicion |
| `TemplateEditor.tsx` | Sostiene el estado compartido y el borrador; decide el modo |
| `HeaderMediaUpload.tsx` | El archivo de ejemplo del encabezado multimedia |
| `JsonBox.tsx` | El JSON plegado |
| `EditPolicyNotice.tsx` | Que permite META ahora: bloqueo, cupo y espera |
| `PlantillasPanel.tsx` | Compone: filtro, buscador, tabla, editor y acciones |

**En el repo de WABA** (`WhatsAppApiCloud-META-WABA`)

| Archivo | Que cambio |
|---|---|
| `routes/apiRoutes.js` | Los endpoints REST nuevos, reusando `templateService` |
| `services/whatsappService.js` | `friendlyError` se mudo aca, junto al enmascarado de secretos |
| `controllers/templateController.js` | Usa ese `friendlyError` en vez de su copia |

`GET /api/templates` **sin query params** sigue devolviendo el array plano de aprobadas:
es lo que consume el selector de plantillas al enviar un mensaje
(`public/js/sendMessage.js`). Cambiar esa forma rompia el envio.

---

### Queda registrado quien lo hizo

Crear, editar, enviar, borrar y sincronizar dejan traza en `AuditLogs` con el email de
quien lo hizo, bajo la categoria `Templates`. **Guardar un borrador no**: no sale de la
aplicacion y llenaria la traza de ruido.

Del lado de WABA las acciones figuran como `apikey` sin usuario —entramos con una clave
de integracion—, asi que el "quien" vive en la auditoria central. Ver `docs/AUDITORIA.md`.

---

## 8. Variables de entorno

| Variable | Sin ella |
|---|---|
| `WABA_API_URL` | La seccion queda deshabilitada (avisa en pantalla) |
| `WABA_API_KEY` | Idem |

Van en **`apps/api/.env`**, no en el de la raiz: el API arranca con
`npm --workspace apps/api` y lee el de ahi. Ver `docs/ENV_VARIABLES.md`.

`GET /api/templates/status` existe para que el front distinga **"no hay plantillas"** de
**"esto no esta configurado"**, que en pantalla se ven igual.

Del lado de WABA, subir el ejemplo del encabezado necesita **App ID y un access token
valido** en la cuenta. Sin eso, la subida falla con el motivo de META a la vista
(enmascarado); el resto de la seccion funciona igual.

---

## 9. Checklist de verificacion

**Lectura**

- [ ] Sin `WABA_API_URL`/`WABA_API_KEY`, la seccion avisa que falta configurar (no queda en blanco).
- [ ] Con las variables puestas, se listan las plantillas de la cuenta.
- [ ] El filtro por estado no se pierde al navegar entre paginas.
- [ ] **Cada estado tiene su color**: en revision y borrador no se confunden.
- [ ] La columna de variables dice "2 variables", no "2 variables a completar".
- [ ] Aparece el aviso cuando la fuente publica solo aprobadas.
- [ ] Se ven las plantillas en revision y las rechazadas, no solo las aprobadas.
- [ ] Una plantilla con `ButtonsJson` roto se lista igual, sin botones y sin romper la pagina.
- [ ] Una plantilla sin `VariablesJson` igual muestra sus variables (salen del `BodyText`).
- [ ] Un usuario con rol `Marketing` entra; uno con `Soporte` no.

**Vista previa**

- [ ] La burbuja se ve sobre el fondo del chat, con hora y doble tilde.
- [ ] Las variables van resaltadas.
- [ ] Con un ejemplo cargado se ve **el ejemplo** ("Hola María"), no `{{1}}`, y sigue resaltado.
- [ ] El ejemplo del encabezado no se usa en el cuerpo: META los numera aparte.
- [ ] `*negrita*`, `_cursiva_` y `~tachado~` se ven aplicados, sin los simbolos.
- [ ] Los botones se dibujan **fuera** de la burbuja, apilados.

**Crear**

- [ ] Crear y editar **arrancan los dos en el asistente**.
- [ ] Al editar, nombre e idioma estan bloqueados en los dos modos.
- [ ] Al editar, el asistente arranca con el contenido que ya tiene la plantilla.
- [ ] Editar no crea borradores: alternar de modo no guarda nada.
- [ ] Se alterna entre modos **sin perder** lo cargado.
- [ ] Al alternar se guarda un borrador; si falla, igual se cambia de modo y avisa.
- [ ] El segundo guardado **actualiza** el mismo borrador, no crea otro.
- [ ] Editando un **borrador** si aparece "Guardar borrador", y guarda sobre ese mismo id.
- [ ] Editando una plantilla de META no aparece "Guardar borrador".
- [ ] Cambiar de modo sobre un borrador **no crea uno nuevo**.
- [ ] Enviar un borrador lo manda a META y lo saca de `DRAFT` (no se queda en borrador).
- [ ] En un borrador el boton dice "Enviar a revision"; en una de META, "Guardar y reenviar".
- [ ] Un error se ve rojo y un aviso azul: no se confunden.
- [ ] El aviso de "queda en revision" esta pegado a la botonera, no arriba del paso.
- [ ] El asistente dice **que falta** para avanzar, no deja un boton apagado sin explicacion.
- [ ] Creando, no se puede saltar a un paso sin completar los anteriores.
- [ ] Editando, se puede ir a cualquier paso desde el arranque.
- [ ] Desde el ultimo paso se vuelve al 3 con un clic, sin pasar por los del medio.
- [ ] Cada objetivo muestra su categoria de META (Marketing, Utilidad, Autenticacion).
- [ ] El aviso del borrador aparece **al lado** de su boton.
- [ ] El formulario avisa si las variables van salteadas (`{{1}}` y `{{3}}`).
- [ ] Al elegir AUTHENTICATION desaparecen mensaje, encabezado y botones.
- [ ] Una plantilla **en revision** tiene el boton Editar apagado, con el motivo en el tooltip.
- [ ] Si igual se intenta abrir, la pantalla avisa y **no** abre el formulario.
- [ ] Al editar una aprobada se ve el cupo (10 al mes) y el aviso de que vuelve a revision.
- [ ] La espera entre ediciones se dice en horas, no como fecha ISO.
- [ ] Una rechazada se puede editar las veces que haga falta, sin cupo.
- [ ] Eliminar pide confirmacion: en META no se deshace.

**JSON y archivos**

- [ ] El JSON arranca cerrado y solo se pide al abrirlo.
- [ ] Al cambiar el formulario con el JSON abierto, se vuelve a pedir.
- [ ] Con encabezado de imagen/video/documento aparece el campo de archivo.
- [ ] Un archivo del tipo equivocado se rechaza con el motivo.
- [ ] Si la subida falla, **no queda** el handle anterior junto al archivo nuevo.
- [ ] Reabrir un borrador trae el titulo, el archivo y **los ejemplos** de las variables.
- [ ] Reabrir una plantilla que no es borrador no pide el endpoint de borradores.
- [ ] Si el borrador no se puede traer, se abre igual y avisa (el aviso se ve con el editor abierto).
- [ ] Un borrador de marketing no vuelve con la advertencia de seguridad prendida.
- [ ] Un fallo de META llega con su motivo (token, tamaño), no como un 503 mudo.

---

## 10. Lo que NO se hizo

- **Listar los borradores para retomarlos.** Se guardan y se actualizan, pero volver a
  uno abierto en otra sesion todavia se hace desde el panel de WABA.
- **Multi-cuenta.** La key resuelve una sola cuenta WABA.
- **Pasar por el middleware.** Ver §2.
