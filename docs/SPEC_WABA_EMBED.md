# Spec — Embeber el panel WABA en Mobility BackOffice

> Ultima actualizacion: 2026-08-28 · Version: 2.16.0
>
> Seccion "Panel de WhatsApp" (rol Marketing), embebiendo la app externa
> **WhatsApp WABA Admin** via reverse-proxy same-origin.

---

## 1. Para que la quiere BackOffice

Para **ver los chats**: que alguien de BackOffice pueda consultar las conversaciones de
Duwy Chat con cada usuario, sus contactos y el estado de los mensajes, sin entrar al
panel por afuera.

### No confundir con "Templates de WhatsApp"

Son **dos secciones distintas y las dos se quedan**:

| Seccion | Para que |
|---|---|
| **Panel de WhatsApp** (esta spec) | **Consultar**: los chats de Duwy Chat, contactos, estado de mensajes |
| **Templates de WhatsApp** (`soon`) | **Crear**: plantillas de saludos y mensajes para fechas especiales (Navidad, campañas) |

Se parecen porque WABA tambien tiene una pantalla de plantillas, pero el entregable que
se espera de "Templates" es propio de BackOffice y todavia no esta definido. Por eso esa
entrada queda en Proximamente y no se reemplaza por el panel.

---

## 2. Que es WABA

**WhatsApp WABA Admin** v1.1.1 (`Projects/WhatsAppApiCloud-META-WABA`): panel de
administracion de WhatsApp Business Cloud API. Express 4 + **EJS server-side**,
Bootstrap 5.3, SQL Server. Multi-tenant y multi-cuenta.

Dos procesos: el panel (`server.js`, **puerto 3000**) y un receptor de webhooks de META
(`webhook-server/`, puerto 3001). BackOffice embebe **solo el panel**.

Secciones propias: dashboard, contactos, mensajes, conversaciones, plantillas, cuentas
WABA, usuarios, settings, logs de API, logs internos y auditoria.

---

## 3. La restriccion que define el enfoque

WABA usa **helmet 7**, que manda `X-Frame-Options: SAMEORIGIN` y CSP
`frame-ancestors 'self'`. Un iframe directo desde el origen de BackOffice **lo bloquea el
navegador**, por partida doble.

La unica via es el **reverse-proxy same-origin**: BackOffice proxya `/waba` hacia el
panel y el iframe apunta a ese prefijo local. Servido desde el mismo origen, las dos
reglas se cumplen. Es el mismo patron que ya se usa para el RAG
(`docs/SPEC_RAG_EMBED.md`).

---

## 4. Decisiones

| # | Decision | Razon |
|---|---|---|
| D1 | Reverse-proxy same-origin en `/waba` | Forzado por `X-Frame-Options` + `frame-ancestors` |
| D2 | El proxy exige sesion de BackOffice (cookie `bo_waba_token`, scopeada a `/waba`) | Sin esto BackOffice seria un **proxy abierto** hacia la pantalla de login de WABA |
| D3 | **Doble login**: WABA conserva su autenticacion | Cero acoplamiento. El SSO obligaria a tocar WABA, que es otro repo. Queda como iteracion aparte |
| D4 | La URL va en `WABA_URL`. Sin ella el proxy no se monta | Mismo patron que `RAG_URL` |
| D5 | Roles de BackOffice: **Marketing** y SuperAdmin (`Usuario` entra por su regla de exclusion) | El panel es una herramienta de marketing |
| D6 | Se **agrega** "Panel de WhatsApp" y se **conserva** "Templates de WhatsApp" | Resuelven cosas distintas: una es consultar chats, la otra crear plantillas. Ver §1 |

---

## 5. Lo que lo diferencia del proxy del RAG

Espeja el modulo `rag/`, pero **no es una copia**. Tres diferencias, y todas salen de que
WABA tiene sesion propia y es server-side rendered.

### 5.1 Las cookies pasan (filtradas)

El proxy del RAG hace `proxyReq.removeHeader('cookie')`: el RAG no tiene auth y no
necesita cookies. **WABA si**: su sesion es `express-session` sobre SQL Server, y sin
cookies no puede mantener a nadie logueado.

`stripBackOfficeCookie()` saca **solo** `bo_waba_token` y deja pasar el resto. El token de
BackOffice no tiene por que salir hacia otro proceso; la cookie de sesion de WABA si tiene
que ir y volver.

### 5.2 El `Set-Cookie` se re-scopea

WABA setea su cookie con `Path=/`. Servida bajo `/waba`, viajaria en **todas** las
requests a BackOffice, incluidas las de su API. `rewriteSetCookiePath()` la acota al
prefijo, y las dos sesiones quedan separadas.

### 5.3 Se reescribe la navegacion, no solo los assets

El RAG es una SPA: alcanzaba con reescribir `/css/`, `/js/` y `/api/`. **WABA es SSR**,
asi que sus enlaces y formularios tambien son rutas absolutas (`<a href="/messages">`,
`<form action="/login">`).

Sin reescribirlos, un clic dentro del iframe navega a `https://backoffice/messages`, el
fallback SPA devuelve `index.html` y **BackOffice se carga dentro de su propio iframe**.

`waba-rewrite.ts` reescribe los 17 segmentos raiz del panel. Dos detalles que estan
fijados en tests:

- **Orden por longitud**: `api-logs` va antes que `api`. Al reves, `/api-logs` matchea
  `/api` y el lookahead lo descarta, dejando el enlace sin reescribir.
- **Anclaje a comilla + lookahead de delimitador**: evita tocar el `/js/` que aparece
  dentro de una URL de CDN, y evita que `/messagesX` matchee `/messages`.

---

## 6. Como viaja la sesion

Un iframe no puede mandar `Authorization: Bearer` en sus sub-requests, asi que la sesion
de BackOffice va por cookie:

1. `POST /api/auth/login` setea `bo_waba_token` (httpOnly, `path=/waba`, `SameSite=Lax`,
   caduca con el token) **ademas** de la del RAG.
2. `createWabaAuthGuard` la lee, la verifica y exige rol Marketing / Usuario / SuperAdmin.
   Sin cookie -> 401. Rol insuficiente -> 403.
3. Recien ahi corre el proxy.
4. **Adentro, WABA pide su propio login.** El guard no lo reemplaza.
5. `POST /api/auth/logout` limpia las dos cookies.

> Son **dos autorizaciones encadenadas**, no una. Tener rol Marketing en BackOffice no da
> acceso a WABA: da acceso a *ver su pantalla de login*.

---

## 7. Archivos

| Archivo | Que hace |
|---|---|
| `apps/api/src/waba/waba-rewrite.ts` | Reescritura de rutas y del `Path` de las cookies |
| `apps/api/src/waba/waba.proxy.ts` | Guard de sesion + proxy |
| `apps/api/src/main.ts` | Montaje (solo si `WABA_URL`), y exclusion del fallback SPA |
| `apps/api/src/auth/auth.controller.ts` | Cookie `bo_waba_token` en login/logout |
| `apps/web/src/components/waba/WabaPanel.tsx` | El iframe + el aviso del doble login |
| `apps/web/src/pages/WabaPage.tsx` | La pagina |

---

## 8. Verificacion end-to-end (2026-08-28)

Probado contra WABA corriendo en `localhost:3020` y la base **`WhatsAppWABA_QATEST`**
(14.794 mensajes, 119 contactos). Todo lo de esta seccion esta **observado**, no deducido.

### Los headers, medidos

```
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: ... frame-ancestors 'self'; form-action 'self'
```

Confirma la premisa de D1: el iframe directo estaba bloqueado, y por partida doble.

### Resultados

| Que se probo | Resultado |
|---|---|
| Sin sesion de BackOffice | **401** `Sesion de BackOffice requerida` — no es proxy abierto |
| Con cookie invalida | **401** |
| Con sesion valida (Marketing) | El panel responde |
| Redirect de WABA | `/login` llega como **`/waba/login`**: no escapa del prefijo |
| `Set-Cookie` de WABA | Llega como **`Path=/waba`** (WABA la manda con `Path=/`) |
| Login del panel **a traves del proxy** | **302 -> `/waba/`**: la sesion de WABA se establece bien |
| Navegacion autenticada | `/`, `/conversations`, `/contacts`, `/messages`, `/templates`, `/accounts` -> **200** |
| Reescritura de rutas | **137 rutas absolutas** en `/conversations`, **ninguna escapa** de `/waba` |
| URLs de CDN | Intactas (`cdn.jsdelivr.net`) |

> El arranque **no modifico** `WhatsAppWABA_QATEST`: su esquema ya estaba al dia con esta
> version del codigo (`Schema initialized`, sin crear tablas ni columnas).

### OJO con cual base

Hay dos: **`WhatsAppWABA`** (2.8 GB, ~90k mensajes — la de uso real) y
**`WhatsAppWABA_QATEST`**. Se usa la segunda.

Apuntar a la primera **le modificaria el esquema**: `schema.sql` corre en cada arranque y
le crearia `AiConversations`, `AiMessages`, `AiToolCalls` mas cuatro columnas del bot de
IA. Son cambios aditivos, pero sobre una base en uso.

### Los dos `.env` de BackOffice

Hay un `.env` en la raiz **y** otro en `apps/api/`. El API arranca con
`npm --workspace apps/api`, asi que su cwd es `apps/api` y **lee el de ahi**.

`WABA_URL` va en **`apps/api/.env`**. Puesta en la raiz, el proxy no se monta y **no hay
ningun error que lo delate**: lo unico que se nota es que falta la linea
`Reverse-proxy WABA montado` en el log de arranque.

### Como reproducirlo

```bash
# Los headers que manda WABA
curl -sI http://localhost:3020/login | grep -iE "x-frame-options|content-security-policy"

# Sin cookie de BackOffice -> 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3010/waba/

# Y en el log del API tiene que aparecer:
#   Reverse-proxy WABA montado en /waba -> http://localhost:3020
```

Si alguna vez aparece **BackOffice dentro del iframe**, es que a `WABA_ROOTS`
(`waba-rewrite.ts`) le falta un segmento: una ruta absoluta quedo sin prefijo, el fallback
SPA la atendio y devolvio `index.html`.

---

## 9. Lo que NO se hizo

- **SSO entre BackOffice y WABA.** Ver D3.
- **Reconstruir el panel con la API de WABA.** WABA expone `/api/*` con `x-api-key`, pero
  serian 13 secciones nuevas.
- **La seccion "Templates de WhatsApp".** Es una tarea aparte, todavia sin definir. Ver §1.
- **Embeber el webhook-server** (puerto 3001). No tiene UI: recibe callbacks de META.
- **Configurar META** (`META_ACCESS_TOKEN` y companía). El panel se ve y se navega sin
  eso; hace falta para enviar mensajes y sincronizar plantillas desde la Cloud API.
- **Tocar el repo de WABA.** No se modifico una sola linea.
