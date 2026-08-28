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

## 8. Pendientes de deploy

1. **`WABA_URL` sin configurar.** Sin ella el proxy no se monta y la seccion queda
   deshabilitada (el iframe da 404). Ver `docs/ENV_VARIABLES.md`.
2. **WABA todavia no corre en esta maquina.** Al 2026-08-28 el repo esta recien clonado:
   **sin `.env` y sin `npm install`**. Necesita SQL Server y credenciales de META.
3. **La integracion no se probo end-to-end** por lo anterior. Lo que si esta verificado:
   la reescritura de rutas y el guard, con 43 tests. El comportamiento de
   `X-Frame-Options` se dedujo de la version de helmet, **no se observo en vivo**.

### Como verificarlo cuando WABA corra

```bash
# 1. Que headers manda realmente
curl -sI http://localhost:3000/login | grep -iE "x-frame-options|content-security-policy"

# 2. Con WABA_URL seteada y sesion de BackOffice, el panel responde bajo /waba
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3010/waba/login

# 3. Sin cookie de BackOffice -> 401 (el proxy no es abierto)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3010/waba/
```

En el navegador, lo que hay que ver: que **navegar dentro del iframe no lo saque de
`/waba`** (si aparece BackOffice adentro del iframe, falto un segmento en
`WABA_ROOTS`), y que el login de WABA **mantenga la sesion** al pasar de pagina (si
vuelve a pedir credenciales, la cookie no esta volviendo bien).

---

## 9. Lo que NO se hizo

- **SSO entre BackOffice y WABA.** Ver D3.
- **Reconstruir el panel con la API de WABA.** WABA expone `/api/*` con `x-api-key`, pero
  serian 13 secciones nuevas.
- **La seccion "Templates de WhatsApp".** Es una tarea aparte, todavia sin definir. Ver §1.
- **Embeber el webhook-server** (puerto 3001). No tiene UI: recibe callbacks de META.
- **Tocar el repo de WABA.** No se modifico una sola linea.
