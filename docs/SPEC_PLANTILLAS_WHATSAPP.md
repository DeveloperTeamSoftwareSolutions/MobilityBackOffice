# Plantillas de WhatsApp — especificacion

> Ultima actualizacion: 2026-08-31 · Version: 2.16.0
>
> Seccion "Templates de WhatsApp" (rol Marketing). Consume las plantillas del panel WABA.
> **Hoy es solo lectura** — ver §6.

---

## 1. Que resuelve

Que el equipo de marketing vea las plantillas aprobadas por META —las que se usan para
escribirle a un cliente— sin entrar al panel de WhatsApp por afuera, y **sin un segundo
login**.

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

## 5. La fuente hoy solo publica las APROBADAS

`GET /api/templates` usa `templateModel.findAllApproved()`:

```sql
SELECT ... FROM MessageTemplates WHERE Status = 'APPROVED'
```

Las **PENDING** y **REJECTED** no llegan — que son justo las que habria que atender.

El DTO trae `onlyApproved: true` cuando todo lo recibido esta aprobado, y la pantalla lo
avisa. Es una **inferencia**, no un dato: la fuente no dice si filtro. Cuando WABA
publique todos los estados, `onlyApproved` pasa a `false` solo y el aviso desaparece **sin
tocar codigo**.

> El modelo de WABA ya tiene `findAll()` (sin filtro). Solo hace falta exponerlo.

---

## 6. Lo que falta: crear y editar

**El objetivo de la seccion incluye crear y editar plantillas** (saludos, mensajes de
fechas especiales). Hoy no se puede.

La API REST de WABA **solo publica el `GET`**. Todo el alta y la edicion viven en rutas
**HTML** con `requireRole('admin','editor')` — que **falla con `x-api-key`**, porque
`requireRole` lee `req.session.user.Role` y la key no crea sesion:

```
GET  /templates/            POST /templates/wizard/validate
GET  /templates/wizard      POST /templates/wizard/upload-sample
POST /templates/wizard      POST /templates/drafts
GET  /templates/new         POST /templates/drafts/:id/submit
POST /templates/new         POST /templates/sync
GET  /templates/:id         POST /templates/:id/edit
GET  /templates/:id/edit    POST /templates/:id/delete
```

### Lo que hay que pedirle al equipo de WABA

Exponer como REST lo que su controller ya hace, bajo `requireAuth` y devolviendo JSON con
su `responseHelper`:

| | | Reusa |
|---|---|---|
| `GET` | `/api/templates?status=all` | `templateModel.findAll` (hoy usa `findAllApproved`) |
| `POST` | `/api/templates` | `templateController.create` |
| `PUT` | `/api/templates/:id` | `templateController.update` |
| `DELETE` | `/api/templates/:id` | `templateController.remove` |
| `POST` | `/api/templates/sync` | `templateController.sync` |

**NO conviene que BackOffice hable con META directamente.** Crear una plantilla no es
escribir una fila: se manda a META para aprobacion. `whatsappService.js` ya tiene el
`AccessToken` por cuenta, el manejo de errores de META y el log en `MetaApiLogs`, y hay un
wizard entero alrededor (validate, upload-sample, drafts, submit). Duplicarlo seria tener
dos integraciones con META que mantener sincronizadas.

---

## 7. Archivos

**Backend** (`apps/api/src/templates/`)

| Archivo | Que hace |
|---|---|
| `templates.client.ts` | WABA `/api/templates` con `x-api-key` |
| `templates.util.ts` | Parseo defensivo, variables con fallback, resumen |
| `templates.service.ts` | Filtra, ordena, pagina; infiere `onlyApproved` |
| `templates.controller.ts` | `@Roles(Marketing)`, whitelist de sort y estado |

**Frontend** (`apps/web/src/components/plantillas/`)

| Archivo | Que hace |
|---|---|
| `plantillas.format.ts` | La traduccion a castellano de estados, categorias e idiomas |
| `TemplatePreview.tsx` | **Como le llega el mensaje al cliente**, con las variables resaltadas |
| `PlantillasPanel.tsx` | Compone: contadores por estado, buscador, tabla y paginado |

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

---

## 10. Lo que NO se hizo

- **Crear, editar, borrar y sincronizar.** Ver §6: falta del lado de WABA.
- **Ver plantillas no aprobadas.** Ver §5: la fuente las filtra.
- **Multi-cuenta.** La key resuelve una sola cuenta WABA.
- **Pasar por el middleware.** Ver §2.
- **Tocar el repo de WABA.** No se modifico una sola linea.
