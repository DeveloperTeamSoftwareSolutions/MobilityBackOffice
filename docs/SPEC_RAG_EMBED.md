# Spec (SDD) — Embeber DuwyEngineRAG en Mobility BackOffice

> Fecha: 2026-07-22
> Estado: aprobado, en implementacion
> Alcance: seccion "Documentacion del RAG" (rol Marketing), embebiendo la app externa
> DuwyEngineRAG via reverse-proxy same-origin.

---

## 1. Problema

El brief pide que BackOffice **consuma** el cargador de documentacion del RAG, que ya existe. Es
**DuwyEngineRAG** (`http://100.89.65.72:3800`, v0.7.0): una SPA Bootstrap con busqueda, documentos,
subir, fuentes, jobs y audit. No tiene login propio; trabaja por "Tenant / CompanyCode" que se
escribe en su topbar.

## 2. Restriccion que define el enfoque

DuwyEngineRAG responde con **`X-Frame-Options: SAMEORIGIN`**. Un iframe directo desde el origen de
BackOffice (otro host) lo **bloquea el browser**. La unica via es **reverse-proxy same-origin**: el
backend de BackOffice proxya un prefijo local hacia el RAG, y el iframe apunta a ese prefijo local
(mismo origen). Es el patron que MobilityManager ya usa para DuwyDashy (`/duwy`) y DuwyChat.

## 3. Decisiones

| # | Decision | Razon |
|---|---|---|
| D1 | Reverse-proxy same-origin en el prefijo `/rag` | Forzado por `X-Frame-Options: SAMEORIGIN` |
| D2 | El proxy **exige sesion de BackOffice** (cookie `bo_rag_token` scopeada a `/rag`) | El RAG no tiene auth propia; sin esto BackOffice seria un proxy abierto. Solo Marketing y SuperAdmin |
| D3 | Tenant/CompanyCode **manual** (como viene el RAG) | Cero acoplamiento; no tocamos la logica interna del RAG. Pre-cargarlo queda para otra iteracion |
| D4 | La URL del RAG va en `RAG_URL` (env). Sin ella, el proxy no se monta y la seccion queda deshabilitada | Mismo patron que los embeds opcionales de MM |
| D5 | Roles: **Marketing** y **SuperAdmin** | El brief ubica el RAG entre las herramientas de marketing |

## 4. Diseño

### 4.1 Reverse-proxy (`src/rag/`)

Espeja el modulo `duwy` de MM, adaptado a las rutas del RAG.

- **`rag.proxy.ts`**:
  - `RAG_PREFIX = '/rag'`, cookie `bo_rag_token`.
  - `createRagProxy(target)`: `http-proxy-middleware` con `selfHandleResponse`. En `proxyReq`
    quita las cookies del browser (el RAG no las necesita y no debe recibir el token de
    BackOffice). En `proxyRes` reescribe el `Location` de los redirects bajo `/rag`, fuerza
    `no-store` en el HTML, y transforma el body (rewrite de assets).
  - `createRagAuthGuard(verify)`: middleware Express que corre **antes** del proxy. Lee la cookie
    `bo_rag_token`, la verifica (JWT propio de BackOffice) y exige rol Marketing o SuperAdmin.
    Sin cookie o token invalido → 401; rol insuficiente → 403.
- **`rag-rewrite.ts`**: reescribe las rutas absolutas del RAG (`/css/`, `/js/`, `/api/`) ancladas a
  comilla, anteponiendo `/rag`, en respuestas HTML y JS. **No toca** URLs de CDN (`https://...`).
- Montaje en `main.ts`: solo si `RAG_URL` esta configurada, `app.use(RAG_PREFIX, guard, proxy)`,
  **antes** del fallback SPA. El fallback SPA excluye `/rag`.

### 4.2 Cookie de sesion para el iframe

Un iframe no puede mandar `Authorization: Bearer` en sus sub-requests, asi que la sesion viaja por
cookie:

- En el **login** (`POST /api/auth/login`), ademas del token en el body, se setea una cookie
  **httpOnly** `bo_rag_token` = el JWT propio, `path=/rag`, `SameSite=Lax`, `maxAge` = vida del
  token. Scopeada a `/rag`: no se manda a ninguna otra ruta.
- En el **logout** (`POST /api/auth/logout`, nuevo), se limpia la cookie. El front lo llama al salir.
- httpOnly: el JS no la lee; solo el browser la adjunta a las requests same-origin de `/rag`.

### 4.3 Frontend

- **`pages/RagPage.tsx`**: un iframe a `/rag/` (same-origin), a pantalla completa.
- **`components/rag/rag-frame.css`**: el iframe ocupa todo el alto disponible, sin borde.
- Ruta `/documentacion-rag` (ya declarada), envuelta en `RoleGuard allow={['Marketing']}` — reemplaza
  el `ComingSoon` de la fase 3. SuperAdmin pasa por el guard.
- El front llama a `logout` (nuevo endpoint) ademas de limpiar el localStorage.

## 5. Que NO hace esta iteracion

- No pre-carga el CompanyCode: el usuario lo escribe en la topbar del RAG (D3).
- No modifica DuwyEngineRAG ni su API.
- No cachea ni transforma los datos del RAG (solo reescribe rutas de assets).
- Templates de WhatsApp: es la otra seccion de Marketing, fuera de alcance.

## 6. Variables de entorno

| Variable | Requerida | Default | Descripcion |
|---|---|---|---|
| `RAG_URL` | no | — | Base URL de DuwyEngineRAG. Sin ella, el proxy no se monta y la seccion no carga |

## 7. Criterios de aceptacion

1. Con `RAG_URL` seteada, un usuario Marketing entra a "Documentacion del RAG" y ve la UI del RAG
   embebida (mismo origen, sin bloqueo de X-Frame-Options).
2. Los assets del RAG (`/rag/css/app.css`, `/rag/js/api.js`) y su API (`/rag/api/*`) cargan a traves
   del proxy.
3. Sin cookie de sesion valida, `GET /rag/` responde 401 (no proxya).
4. Un usuario con rol Administrador (no Marketing) recibe 403 en `/rag`.
5. Al hacer logout, la cookie `bo_rag_token` se limpia y `/rag` vuelve a dar 401.
6. Sin `RAG_URL`, el backend arranca igual y `/rag` responde 404 (proxy no montado).
7. El CDN de Bootstrap del RAG sigue cargando (no se reescriben URLs absolutas https).
