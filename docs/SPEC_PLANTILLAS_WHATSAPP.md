# Plantillas de WhatsApp — especificacion

> Ultima actualizacion: 2026-08-31 · Version: 2.17.0
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

Los endpoints nuevos de WABA **reusan `templateService`**, que es donde vive el dialogo
con META. No hay una segunda integracion que mantener sincronizada:

```
GET    /api/templates/:id    detalle + politica de edicion
POST   /api/templates        crear y enviar a aprobacion
PUT    /api/templates/:id    editar y reenviar
DELETE /api/templates/:id    borrar (META y local)
POST   /api/templates/sync   traer de META lo que cambio alla
```

### Tres cosas que la pantalla deja explicitas

**Crear no es guardar.** La plantilla se envia a META y queda "En revision". El estado
lo decide META, tarda, y puede rechazarla. Por eso `status` nunca se acepta como
entrada y el boton dice "Enviar a revision de META", no "Guardar".

**El nombre y el idioma no se cambian.** META los toma como identidad de la plantilla.
En edicion van bloqueados y el `PUT` ni siquiera los lee.

**AUTHENTICATION es otra cosa.** Ahi META **escribe el texto** y lo traduce: no hay
mensaje, ni encabezado, ni botones que configurar. Solo la advertencia de seguridad, la
validez del codigo (1 a 90 minutos) y el boton de copiar. El formulario cambia entero al
elegir esa categoria, y no muestra vista previa porque el texto todavia no existe.

### La validacion corre en dos lugares, y no es duplicacion

| Donde | Para que |
|---|---|
| `plantillas.validate.ts` (front) | Avisar **mientras se escribe**. Un rechazo de META cuesta horas o dias |
| `templateValidator.js` (WABA) | La autoridad. Es el **mismo** que usan el asistente y el formulario del panel |

El front no decide nada: si su chequeo pasa pero WABA rechaza, el error de WABA se
muestra tal cual. Lo que evita es el viaje de ida y vuelta por algo que ya se sabe que
esta mal — una variable salteada, un texto de mas, cuatro botones de respuesta rapida.

La regla que mas se rompe: **las variables tienen que ir `{{1}}, {{2}}, {{3}}` sin
saltos**. META numera los ejemplos por posicion y un hueco es rechazo.

### Los errores del servidor se muestran, no se tapan

El client traduce los 4xx de WABA a errores de Nest conservando el mensaje: son cosas
que quien escribe la plantilla puede corregir. Un `409` es el caso mas claro — "esta en
revision, no se puede editar ahora" no es una falla del servidor.

---
## 7. Archivos

**Backend** (`apps/api/src/templates/`)

| Archivo | Que hace |
|---|---|
| `templates.client.ts` | WABA `/api/templates` con `x-api-key`; traduce sus 4xx conservando el mensaje |
| `templates.util.ts` | Parseo defensivo, variables con fallback, resumen |
| `templates.service.ts` | Filtra, ordena, pagina; separa el payload de AUTHENTICATION |
| `templates.controller.ts` | `@Roles(Marketing)`, whitelist de sort y estado, CRUD |

**Frontend** (`apps/web/src/components/plantillas/`)

| Archivo | Que hace |
|---|---|
| `plantillas.format.ts` | La traduccion a castellano de estados, categorias e idiomas |
| `plantillas.validate.ts` | Las reglas de META, para avisar mientras se escribe |
| `TemplatePreview.tsx` | **Como le llega el mensaje al cliente**, con las variables resaltadas |
| `TemplateForm.tsx` | Alta y edicion. Cambia entero segun la categoria |
| `PlantillasPanel.tsx` | Compone: contadores, buscador, tabla, formulario y acciones |

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

---

## 9. Checklist de verificacion

- [ ] Sin `WABA_API_URL`/`WABA_API_KEY`, la seccion avisa que falta configurar (no queda en blanco).
- [ ] Con las variables puestas, se listan las plantillas de la cuenta.
- [ ] El contador por estado filtra al hacer clic, y no cambia al navegar.
- [ ] Aparece el aviso de que la fuente publica solo aprobadas.
- [ ] La vista previa arma el mensaje con las variables **resaltadas**.
- [ ] Una plantilla con `ButtonsJson` roto se lista igual, sin botones y sin romper la pagina.
- [ ] Una plantilla sin `VariablesJson` igual muestra sus variables (salen del `BodyText`).
- [ ] Un usuario con rol `Marketing` entra; uno con `Soporte` no.
- [ ] Se ven las plantillas en revision y las rechazadas, no solo las aprobadas.
- [ ] El formulario avisa si las variables van salteadas (`{{1}}` y `{{3}}`).
- [ ] Al elegir AUTHENTICATION desaparecen mensaje, encabezado y botones.
- [ ] En edicion, nombre e idioma estan bloqueados.
- [ ] Una plantilla en revision no se puede editar, y la pantalla lo dice antes de escribir.
- [ ] Eliminar pide confirmacion: en META no se deshace.

---

## 10. Lo que NO se hizo

- **Duplicar el asistente de WABA.** Su wizard tiene validacion en vivo, borradores y
  carga de ejemplos. Aca hay un formulario directo: para casos complejos, el panel.
- **Multi-cuenta.** La key resuelve una sola cuenta WABA.
- **Pasar por el middleware.** Ver §2.
- **Tocar el repo de WABA.** No se modifico una sola linea.
