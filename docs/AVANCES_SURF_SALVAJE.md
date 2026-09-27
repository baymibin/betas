# Surf Salvaje · Avances técnicos

> Memoria técnica del proyecto. **Léela antes de empezar cualquier tarea y actualízala al terminar** (sin borrar el historial).
> No contiene secretos: las credenciales viven solo en `servidor/.env` (fuera de git).

Leyenda de estados: **IMPLEMENTADO** (código hecho) · **PROBADO** (verificado con pruebas automáticas o en navegador) · **PENDIENTE** (falta hacerlo) · **BLOQUEADO POR CONFIGURACIÓN EXTERNA** (el código está listo; falta algo que solo puede hacer el dueño del proyecto, como crear credenciales).

Última actualización: **2026-09-27**

---

## 1. Descripción del videojuego

Surf Salvaje es un juego multijugador de carreras de surf en el navegador. Hasta 8 surfistas stickman (humanos o bots) compiten 3 vueltas en circuitos costeros cerrados, con rampas, saltos, turbo y ocho power-ups. Incluye un modo solitario (práctica contra 7 bots en el propio navegador), salas online con código, sala de espera, tienda cosmética (La tiendita: personajes, tablas, wings, hats) y ajustes gráficos y de audio.

Desde esta fase el juego tiene **cuentas permanentes** (Google y Discord), una **economía con dos monedas**, **inventario persistente** y **equipamiento guardado en el servidor**. Se sigue pudiendo jugar como invitado.

## 2. Tecnologías

- **Cliente:** HTML + JavaScript ES modules sin bundler, **Babylon.js 9.26.1** (CDN jsDelivr) para el 3D, CSS propio y fuente Baloo 2 (Google Fonts). Service Worker para caché de assets.
- **Servidor:** **Node.js ≥ 22.13** + **uWebSockets.js 20.67** (HTTP y WebSocket en el mismo proceso).
- **Base de datos:** **MySQL / MariaDB** (librería `mysql2`, p. ej. la base de datos de aaPanel) **o SQLite** embebido de Node (`node:sqlite`). Se elige con `DATABASE_URL`; mismo modelo y mismas reglas en los dos.
- **Protocolo de juego:** binario propio (ArrayBuffer/DataView, little-endian), versión 3. Simulación compartida cliente/servidor a 30 Hz.
- **Autenticación:** Google OpenID Connect y Discord OAuth2, ambos con *authorization code flow* en el servidor.

## 3. Arquitectura actual

```
Navegador ── HTTP ──> uWebSockets.js (servidor/src/index.js)
   │                    ├─ archivos del cliente (client/) con ETag y caché
   │                    ├─ /auth/*  login Google/Discord  (src/auth.js)
   │                    ├─ /api/*   cuenta, tienda, monedas, pagos (src/api.js)
   │                    │             └─ src/economy.js ──> src/db.js ──> MySQL/MariaDB  o  SQLite
   ├─ WS /lobby ──────> lista de salas
   └─ WS /play  ──────> carreras (cola de inputs, bots, power-ups, snapshots 30 Hz)
                          └─ la sesión viaja en la cookie del handshake: el servidor
                             aplica el equipamiento de la cuenta y da las recompensas
```

Principio clave: **el servidor es la única autoridad** de saldos, precios, propiedad y resultados. El navegador solo muestra y pide.

## 4. Estructura de carpetas

```
client/
  index.html                 menú, HUD, diálogos (perfil, ajustes, pausa, tienda)
  sw.js                      Service Worker (solo cachea /assets y librerías versionadas)
  assets/images/currency/    iconos SVG: tabla-normal.svg, tabla-oro.svg
  src/account/               account.js (API y estado de cuenta), account-ui.js (panel de acceso y perfil)
  src/shared/                código compartido cliente/servidor: simulación, protocolo, bots,
                             power-ups, catalog.js (catálogo cosmético), board-cosmetics.js
  src/ui/                    shop.js (La tiendita), rooms.js (salas), home-ui.js, race-ui.js...
  styles/                    ui.css, home.css, multiplayer.css, account.css
servidor/
  src/index.js               servidor HTTP/WS, salas, bucle de simulación
  src/db.js                  capa de base de datos (MySQL/MariaDB o SQLite), migraciones, catálogo
  src/economy.js             monedero, compras, conversión, recompensas, pagos
  src/auth.js                Google/Discord, sesiones, vinculación
  src/api.js                 rutas HTTP, CSRF, límite de peticiones
  src/input-queue.js         cola de inputs por jugador
  migrations/mysql/*.sql     migraciones para MySQL/MariaDB
  migrations/sqlite/*.sql    migraciones para SQLite (mismo modelo)
  config/economy.json        configuración central de la economía
  scripts/admin-economy.mjs  ajustes administrativos por consola
  test/*.test.js             pruebas automáticas (npm test); test/helpers/mysql.js recrea bases *_test
  data/                      base SQLite y secreto local (IGNORADO por git)
  .env.example               plantilla de variables de entorno
docs/AVANCES_SURF_SALVAJE.md este documento
```

## 5. Backend

- `npm start` (en `servidor/`) arranca todo y muestra el estado:
  `Surf Salvaje (protocolo v3): http://localhost:3000` y
  `Cuentas: Google activo|sin configurar · Discord activo|sin configurar · pagos reales deshabilitados`.
- Lee `servidor/.env` si existe (`process.loadEnvFile`).
- Rutas nuevas (todas responden JSON con `Cache-Control: no-store`):

| Ruta | Qué hace | Sesión | CSRF |
|---|---|---|---|
| `GET /auth/{google\|discord}/start?mode=login\|link` | Redirige al proveedor | link: sí | — |
| `GET /auth/{google\|discord}/callback` | Valida y crea la sesión | — | state + cookie |
| `POST /auth/logout` | Cierra la sesión | sí | sí |
| `GET /api/me` | Estado de la cuenta, monedero, inventario, equipo, token CSRF | opcional | — |
| `POST /api/account/nickname` · `/unlink` · `/migrate-local` | Nick, desvincular, importar equipo local | sí | sí |
| `GET /api/shop/catalog` | Catálogo con precio, propiedad y equipado | opcional | — |
| `POST /api/shop/purchase` · `/api/shop/equip` | Comprar (Tablas Normales) / equipar | sí | sí |
| `GET /api/wallet/transactions` | Historial | sí | — |
| `GET /api/coins/packages` · `POST /api/coins/exchange` | Paquetes Oro→Normales y cambio | exchange: sí | sí |
| `GET /api/payments/products` · `POST /api/payments/checkout` | Productos de oro / pago (deshabilitado: 503) | — / sí | sí |
| `POST /api/payments/webhook/:provider` | Reservado para el proveedor de pagos (501) | — | firma (pendiente) |

## 6. Base de datos

**IMPLEMENTADO · PROBADO en MySQL/MariaDB (MariaDB 10.11) y en SQLite.**

El motor se elige con `DATABASE_URL` en `servidor/.env`:

| `DATABASE_URL` | Motor |
|---|---|
| `mysql://usuario:contraseña@localhost:3306/surf_salvaje` | **MySQL 5.7+/8 o MariaDB 10.3+** (p. ej. aaPanel). Recomendado en el VPS. |
| `file:./data/surf-salvaje.db` (o sin definir) | SQLite en `servidor/data/` (desarrollo local). |

- **No hay que importar ningún `.sql`**: al arrancar, el servidor crea o actualiza las tablas con las migraciones de su motor (`servidor/migrations/mysql/` o `servidor/migrations/sqlite/`) y las anota en `schema_migrations`.
- Si la contraseña tiene símbolos, van codificados en la URL: `@`→`%40`, `:`→`%3A`, `/`→`%2F`, `#`→`%23`, `?`→`%3F` (probado).
- Al arrancar, el servidor muestra `Base de datos: MySQL mysql://usuario:***@...` (sin la contraseña).
- MySQL: InnoDB, utf8mb4, fechas `DATETIME(3)` en UTC, saldos `BIGINT` con `CHECK (balance >= 0)` y claves foráneas. Cada operación de dinero es una transacción real que **bloquea la fila del monedero (`SELECT ... FOR UPDATE`)**: compras o conversiones simultáneas no pueden gastar el mismo saldo (probado con peticiones en paralelo).
- Conexiones: un pool de `DATABASE_POOL` (10 por defecto).

### Puesta en marcha en aaPanel (VPS)
1. *aaPanel → Databases → Add database*: nombre `surf_salvaje`, usuario y contraseña, acceso **Local server**. Charset utf8mb4.
2. *App Store → Node.js version manager*: instala **Node.js 22.13 o superior**.
3. Sube `client/` y `servidor/` (sin `node_modules` ni `servidor/data/`), por ejemplo a `/www/wwwroot/surf/`, y ejecuta `npm install` en `servidor/`.
4. Crea `servidor/.env` a partir de `.env.example` con `DATABASE_URL=mysql://usuario:contraseña@localhost:3306/surf_salvaje`, `PUBLIC_URL=https://tu-dominio`, `NODE_ENV=production`, `SESSION_SECRET` y las credenciales de Google y Discord.
5. *Website → Node project → Add*: ruta `/www/wwwroot/surf/servidor`, arranque `npm start`, puerto `3000`. Asocia el dominio y activa **SSL**. El proxy debe dejar pasar los **WebSockets** (`/play`, `/lobby`).
6. Arranca y comprueba el log: `Base de datos: MySQL ...`. Las tablas aparecerán en phpMyAdmin.
7. Copias de seguridad: *Databases → Backup* (programable en *Cron*).
8. Si ya tenías cuentas en SQLite, no se pasan solas a MySQL (hoy no hay herramienta de traspaso). En una instalación nueva no hace falta.

| Tabla | Para qué |
|---|---|
| `users` | Cuenta interna (`id` = **surf_user_id**, UUID), nick, avatar |
| `auth_identities` | Google/Discord vinculados. Únicos: (provider, subject) y (user_id, provider) |
| `sessions` | Sesiones (solo el HMAC del token), token CSRF, caducidad (30 días) |
| `oauth_states` | Flujos OAuth en curso: state de un solo uso, PKCE, nonce, cookie del navegador |
| `user_settings` | Preferencias por cuenta (preparada; aún sin uso) |
| `wallets` | Saldo por (usuario, moneda). `CHECK (balance >= 0)` |
| `wallet_transactions` | Libro de movimientos con saldo resultante. Único (user, moneda, tipo, referencia) |
| `shop_items` | Catálogo (`id` = `categoria:indice`, p. ej. `wing:5`), precio en Tablas Normales |
| `user_inventory` | Artículos comprados/regalados |
| `equipped_items` | Equipo por ranura (character, board, wing, hat) |
| `item_purchases` | Compras, idempotentes por `request_id` |
| `coin_exchange_packages` / `coin_exchange_transactions` | Paquetes Oro→Normales y cambios realizados |
| `payment_products` / `payment_orders` / `payment_events` | Pagos reales (preparado) |
| `race_rewards` | Recompensas entregadas (una por cuenta y carrera) + tope diario |

Todas las cantidades son **INTEGER**; nunca coma flotante.

## 7. Migraciones

- Una carpeta por motor: `servidor/migrations/mysql/NNN_nombre.sql` y `servidor/migrations/sqlite/NNN_nombre.sql`, con el **mismo nombre** y el mismo modelo. Se aplican en orden por `db.js` y se anotan en `schema_migrations`. Nunca se reaplican.
- **Regla:** no editar una migración ya aplicada. Para cambiar el esquema se crea `002_...sql` **en las dos carpetas**. Prohibido `DROP TABLE` sobre datos reales.
- En MySQL el DDL no es transaccional: las migraciones usan `CREATE TABLE IF NOT EXISTS` para poder relanzarse si algo se corta.
- El catálogo (`shop_items`), los paquetes y los productos se **sincronizan** en cada arranque desde `config/economy.json` y el catálogo compartido. Lo que desaparece se marca como no disponible; no se borra.

## 8. Login Google

**Estado: IMPLEMENTADO · PROBADO con proveedor simulado · BLOQUEADO POR CONFIGURACIÓN EXTERNA (faltan GOOGLE_CLIENT_ID/SECRET reales).**

Flujo (OpenID Connect, authorization code + PKCE):
1. El botón **Continuar con Google** abre `/auth/google/start`. El servidor crea un `state` de un solo uso, un `nonce` y un verificador PKCE, y redirige a `accounts.google.com` con `scope=openid profile` (no pide correo ni otros permisos).
2. Google vuelve a `/auth/google/callback`. El servidor comprueba el `state` y que la cookie del navegador sea la que inició el flujo, y canjea el código (con `client_secret` y `code_verifier`).
3. Valida el `id_token` con las claves públicas de Google (JWKS, con caché y rotación): firma RS256, emisor, audiencia, caducidad y nonce.
4. Usa el `sub` de Google como identificador estable (**nunca el correo**), busca la identidad, crea la cuenta si es nueva y abre la sesión.

**Cómo activarlo:**
1. [Google Cloud Console](https://console.cloud.google.com/) → crea o elige un proyecto.
2. *APIs y servicios → Pantalla de consentimiento de OAuth*: tipo **Externo**, nombre "Surf Salvaje", correo de soporte. Ámbitos: `openid` y `.../auth/userinfo.profile`. Mientras esté en modo *Prueba*, añade los correos de quienes vayan a probar.
3. *Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*.
   - Orígenes autorizados: `http://localhost:3000` (y tu dominio con `https://`).
   - **URI de redireccionamiento autorizado:** `{PUBLIC_URL}/auth/google/callback`, p. ej. `http://localhost:3000/auth/google/callback` y `https://tu-dominio/auth/google/callback`.
4. Copia el ID y el secreto en `servidor/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) y reinicia. El servidor debe decir `Google activo`.

## 9. Login Discord

**Estado: IMPLEMENTADO · PROBADO con proveedor simulado · BLOQUEADO POR CONFIGURACIÓN EXTERNA (faltan DISCORD_CLIENT_ID/SECRET reales).**

Flujo (OAuth2 authorization code):
1. **Continuar con Discord** abre `/auth/discord/start` y redirige a `discord.com/oauth2/authorize` con `scope=identify` (sin servidores, mensajes ni correo) y un `state` de un solo uso.
2. En `/auth/discord/callback` el servidor valida el `state` y la cookie, canjea el código con el `client_secret`, lee `GET /users/@me` y **revoca el access token** (no se guarda ningún token de Discord).
3. Usa el `id` numérico de Discord como identificador estable (**nunca el nombre de usuario**).

**Cómo activarlo:**
1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → "Surf Salvaje".
2. *OAuth2*: copia el **Client ID** y pulsa **Reset Secret** para obtener el **Client Secret**.
3. *OAuth2 → Redirects*: añade `{PUBLIC_URL}/auth/discord/callback` (p. ej. `http://localhost:3000/auth/discord/callback`).
4. Ponlos en `servidor/.env` (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`) y reinicia. El servidor debe decir `Discord activo`.

## 10. Vinculación de cuentas

**IMPLEMENTADO · PROBADO.**
- Una cuenta (surf_user_id) puede tener Google, Discord o ambos. Las dos identidades llevan al **mismo** monedero, inventario y equipo.
- Desde **Perfil → Vincular Google/Discord** (`mode=link`) se exige la sesión activa y que la vuelta llegue al mismo navegador y cuenta. No se crea otra cuenta ni otro monedero.
- Si la identidad ya pertenece a **otra** cuenta, se rechaza (`identity_in_use`). No se fusionan cuentas por correo ni automáticamente.
- **Desvincular** solo se permite si queda otro acceso (`last_identity`).
- *Pendiente:* un procedimiento seguro (con verificación de ambas cuentas) para fusionar dos cuentas ya existentes.

## 11. Sistema de sesiones

**IMPLEMENTADO · PROBADO.**
- Cookie `ss_session`: token aleatorio de 256 bits, `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` si `PUBLIC_URL` es https. Dura 30 días.
- En la base de datos solo se guarda `HMAC-SHA256(SESSION_SECRET, token)`.
- Cada sesión tiene su token CSRF (se entrega en `/api/me`). Toda petición que cambia datos exige `X-CSRF-Token` y `Origin` del propio sitio.
- El WebSocket `/play` lee la sesión de la cookie del handshake: nunca viajan tokens por WebSocket.
- Al iniciar sesión se descarta cualquier sesión anterior del navegador.

## 12. Monedas normales (NORMAL_COIN · "Tablas Normales")

**IMPLEMENTADO · PROBADO.** Icono: `client/assets/images/currency/tabla-normal.svg` (tabla turquesa).
- Sirven para comprar en La tiendita, y solo ellas.
- Se obtienen con: recompensas de carrera (servidor), conversión desde Tablas de Oro y ajustes administrativos. Misiones, logros y eventos quedan preparados (el tipo de movimiento se añade al CHECK en una migración nueva).
- **Recompensas de carrera** (`config/economy.json → rewards`): las calcula el servidor con el puesto real al cruzar la meta, en carreras online y solo para cuentas con sesión. Valores iniciales: 20 por terminar más un bonus por puesto (30/20/10). Hace falta un mínimo de **2 humanos** para evitar farmear contra bots, hay un **tope de 300 al día** y cada carrera se paga una sola vez. Son valores de partida para ajustar.

## 13. Monedas de oro (GOLD_COIN · "Tablas de Oro")

**IMPLEMENTADO · PROBADO.** Icono: `client/assets/images/currency/tabla-oro.svg` (tabla dorada con estrella).
- Moneda premium. Solo sirve para conseguir Tablas Normales (no compra artículos; no hay conversión inversa, retirada ni intercambio entre jugadores).
- Solo entra por: un **pago confirmado por el proveedor** (`creditPaidOrder`, pendiente de integrar) o un **ajuste administrativo** por consola.
- El navegador no puede acreditar oro: no hay ninguna ruta web para ello.

## 14. Monedero

**IMPLEMENTADO · PROBADO.** Dos saldos independientes por cuenta (`wallets`). Se muestran en el menú (tarjeta de cuenta), en La tiendita (cabecera) y en Conseguir monedas y Perfil. Siempre vienen del backend; nada está fijado en el código.

Ajustes administrativos:
```
cd servidor
npm run admin -- users
npm run admin -- grant <userId> GOLD_COIN 100 "motivo del ajuste"
npm run admin -- history <userId>
```

## 15. Inventario

**IMPLEMENTADO · PROBADO.** `user_inventory` guarda lo comprado (o regalado por un admin). Los artículos gratuitos no hace falta poseerlos: todos pueden usarlos. No se regala el catálogo a las cuentas nuevas. El inventario se ve en Perfil y se recupera en cualquier PC.

## 16. Catálogo

**IMPLEMENTADO · PROBADO.**
- Fuente única: `client/src/shared/catalog.js` (nombres, descripciones, wings) + `board-cosmetics.js` (tablas). Lo usan la tienda, las salas y el servidor.
- IDs estables `categoria:indice` (`character:0..4`, `board:0..5`, `wing:0..8`, `hat:0`). **El índice es el que usa Babylon.js y el protocolo: no reordenar ni borrar**, solo añadir al final.
- Precios en `config/economy.json → itemPrices` (Tablas Normales). **Hoy todo el catálogo sigue gratis (precio 0)**, como antes. Para poner a la venta un artículo: `"itemPrices": {"wing:8": 900}` y reiniciar.

## 17. Compras

**IMPLEMENTADO · PROBADO.** `POST /api/shop/purchase {itemId, requestId}`:
1. Sesión + CSRF.
2. En una transacción atómica: repetición del mismo `requestId` → devuelve el mismo resultado sin cobrar; artículo existente y disponible; precio leído de la base de datos (se ignora cualquier precio que envíe el cliente); no gratuito; no poseído.
3. Descuenta Tablas Normales (falla con `insufficient_funds` sin tocar nada), entrega el artículo y registra la compra y el movimiento.

Estados en la tienda: **COMPRAR · EQUIPAR · EQUIPADO · SALDO INSUFICIENTE** (lleva a Conseguir monedas) · **INICIA SESIÓN** (invitado ante un artículo de pago).

## 18. Conversión de monedas

**IMPLEMENTADO · PROBADO.** Pestaña **Conseguir monedas** de La tiendita. `POST /api/coins/exchange {packageId, requestId}`: descuenta el oro y acredita las Normales en la **misma transacción**, es idempotente y deja dos movimientos `GOLD_EXCHANGE` con la misma referencia.
Paquetes en `config/economy.json → exchangePackages`: Pequeño 500, Mediano 1.500 y Grande 5.000 Tablas Normales. **Los precios en oro están en `null` (sin definir) y por eso los paquetes salen como "PRÓXIMAMENTE"**. Para activarlos, pon `goldPrice` y reinicia.

## 19. Pagos reales

**PREPARADO · DESHABILITADO · BLOQUEADO POR CONFIGURACIÓN EXTERNA.**
- Hecho: tablas `payment_products` (en `config/economy.json → goldProducts`, sin precio e inactivos), `payment_orders` (estados CREATED, PENDING, PAID, CREDITED, FAILED, CANCELED, REFUNDED, CHARGEBACK), `payment_events` (idempotencia por id de evento) y `creditPaidOrder()` (acredita una sola vez una orden PAID).
- `POST /api/payments/checkout` → 503 `payments_disabled`. `POST /api/payments/webhook/:provider` → 501 (no acredita nada).
- **Pendiente para activar:**
  1. Elegir un proveedor que opere en tu país (p. ej. Stripe, Mercado Pago o PayPal) y crear la cuenta.
  2. Checkout en el servidor: crea `payment_orders` con precio del servidor y redirige al pago del proveedor.
  3. Webhook con **verificación de firma**: registrar el evento en `payment_events`, marcar la orden PAID y llamar a `creditPaidOrder`. **Nunca acreditar por volver a una URL de éxito.**
  4. Reembolsos y contracargos: política de saldo (el oro ya gastado no puede dejar el saldo negativo).
  5. Aspectos legales: precios con impuestos, términos y condiciones, edad mínima.

## 20. Seguridad

**IMPLEMENTADO · PROBADO** (salvo lo marcado).
- Secretos solo en `servidor/.env` (ignorado por git). `SESSION_SECRET` es obligatorio en producción; en local se genera uno en `servidor/data/.session-secret`.
- OAuth: `state` de un solo uso ligado a la cookie del navegador (contra CSRF de login y callbacks reutilizados), PKCE y nonce en Google, validación completa del id_token, scopes mínimos y token de Discord revocado.
- CSRF: `X-CSRF-Token` por sesión + comprobación de `Origin` + cookies `SameSite=Lax`.
- Límite de peticiones por IP y minuto: auth 60, escrituras 120, lecturas 600 (configurable con `RATE_LIMIT_*`).
- Economía: autoridad del servidor, transacciones atómicas, `requestId` idempotente, restricciones `CHECK`/`UNIQUE` en la base de datos y sin coma flotante.
- Multijugador: con sesión, los demás ven el equipo de la **cuenta** aunque el cliente pida otro. Un invitado solo puede lucir artículos gratuitos. Por WebSocket no viajan saldos, tokens ni datos privados.
- Cabeceras `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: same-origin` en la API.
- *Pendiente:* HTTPS en producción (obligatorio para Google fuera de localhost) y cabeceras CSP.

## 21. Archivos modificados (esta fase)

- `client/index.html`: logo SVG, panel de acceso, botones de Google y Discord, datos con iconos, perfil y tienda (monedero, pestaña Conseguir monedas).
- `client/src/ui/shop.js`: precios, propiedad, compra, equipar en cuenta y Conseguir monedas.
- `client/src/ui/home-ui.js`: el perfil pasa a `account-ui.js`.
- `client/src/shared/board-cosmetics.js`: comentario.
- `servidor/src/index.js`: base de datos, API, sesión en el WebSocket, equipo autoritativo y recompensas.
- `servidor/src/asset-manifest.js`: lee las wings de `catalog.js`.
- `servidor/package.json` (Node ≥ 22.13, `npm run admin`) y `servidor/.gitignore` (`data/`, `.env`).

## 22. Archivos creados (esta fase)

- `client/src/account/account.js`, `client/src/account/account-ui.js`
- `client/src/shared/catalog.js`
- `client/styles/account.css`
- `client/assets/images/currency/tabla-normal.svg`, `tabla-oro.svg`
- `servidor/src/db.js`, `economy.js`, `auth.js`, `api.js`
- `servidor/migrations/001_accounts_economy.sql`
- `servidor/config/economy.json`
- `servidor/scripts/admin-economy.mjs`
- `servidor/.env.example`
- `servidor/test/economy.test.js`, `servidor/test/auth-flow.test.js`
- `docs/AVANCES_SURF_SALVAJE.md`, `CLAUDE.md`

### Fase 1b · MySQL/MariaDB (2026-09-27)
- Modificados: `servidor/src/db.js` (capa dual), `economy.js`, `auth.js`, `api.js`, `index.js`, `scripts/admin-economy.mjs` (todo asíncrono), `package.json` (`mysql2`), `.env.example`, `README.md`, `test/economy.test.js`, `test/auth-flow.test.js`.
- Movido: `migrations/001_accounts_economy.sql` → `migrations/sqlite/001_accounts_economy.sql` (mismo contenido y nombre).
- Creados: `servidor/migrations/mysql/001_accounts_economy.sql`, `servidor/test/helpers/mysql.js`.

## 23. Problemas encontrados

1. No había backend de datos ni cuentas: el equipo vivía solo en `localStorage`.
2. El catálogo (nombres y wings) estaba dentro de `ui/shop.js`, que toca el DOM, y el servidor no podía usarlo.
3. uWebSockets.js invalida `req` tras el primer `await` y reutiliza los buffers del cuerpo.
4. El límite de peticiones frenó las pruebas de login encadenadas desde la misma IP.
5. Playwright no intercepta peticiones que vienen de una redirección (pruebas de los botones).
6. `prompt=none` en Discord podía fallar con usuarios que nunca habían autorizado la app.
7. La primera versión era síncrona (SQLite) y no servía para MySQL, cuyo acceso es asíncrono.
8. Con MySQL y peticiones en paralelo, la comprobación "ya lo tiene" podía leerse antes de que se confirmara otra compra.
9. SQLite tiene una sola conexión: con código asíncrono, una consulta suelta podía colarse dentro de una transacción ajena.
10. Previos a esta fase y sin tocar: `scripts/verify-layout.mjs` falla (espera solo `client` y `servidor` en la raíz) y `scripts/verify-race-live.mjs` falla con el protocolo actual.

## 24. Soluciones implementadas

1. SQLite embebido con migraciones y una economía con autoridad en el servidor.
2. `shared/catalog.js` como fuente única; `shop.js` la reexporta sin cambiar su API.
3. `api.js` copia de `req` lo necesario antes de cualquier espera y copia cada fragmento del cuerpo (límite 16 KB).
4. Límites razonables para LAN y configurables con `RATE_LIMIT_*`.
5. Las pruebas de botones registran la URL de la petición en lugar de esperar a que cargue la página.
6. Discord sin `prompt`: siempre muestra la pantalla de consentimiento.
7. Capa `db.js` con la misma interfaz asíncrona para los dos motores (get/all/run/upsert/tx) y migraciones por motor.
8. Cada operación de dinero bloquea primero la fila del monedero (`FOR UPDATE`), y después lee: ya ve lo confirmado por la operación anterior.
9. En SQLite, las transacciones se encolan y las consultas sueltas esperan a que no haya ninguna abierta.

## 25. Pruebas ejecutadas

- **MySQL/MariaDB (MariaDB 10.11):** con `TEST_MYSQL_URL=mysql://usuario:clave@localhost:3306/surf_test`:
  - `test/economy.test.js`: 16/16 (8 en SQLite y 8 en MariaDB, incluida concurrencia: 6 compras simultáneas → 1 cobro; mismo `requestId` ×5 → 1 cobro; 5 conversiones simultáneas con oro para 2 → 2; tope diario con llegadas simultáneas; orden pagada acreditada una vez aunque se procese dos veces a la vez).
  - `test/auth-flow.test.js`: 3/3 con el servidor real sobre MariaDB.
  - Servidor real sobre MariaDB + `npm test`: **60/60** y `test-cosmetics-sync-live` OK. En el navegador, compra real (2.500 → 2.200) comprobada en las tablas.
  - Contraseña con símbolos codificados en `DATABASE_URL`: conecta.
- `npm test` (servidor en marcha, SQLite): **60/60**. Incluye:
  - `test/economy.test.js` (7): saldos independientes, compra atómica, rechazo por saldo, doble compra, idempotencia, saldo nunca negativo (también por `CHECK`), oro que no compra artículos, conversión atómica, recompensas con tope, oro solo desde orden PAID y migración local sin regalos.
  - `test/auth-flow.test.js` (3): servidor real + **proveedor OAuth simulado** (RSA/JWKS/PKCE para Google, token/@me para Discord). Cubre cuenta nueva, cuenta existente, vinculación, login desde otro navegador a la misma cuenta, robo de identidad bloqueado, desvincular, logout, state reutilizado, otro navegador, `aud`/`nonce` falsos, CSRF/Origin, compra/conversión idempotentes, ajuste admin por CLI, pagos deshabilitados, webhook sin efecto y equipo autoritativo por WebSocket (cuenta e invitado).
- `scripts/test-cosmetics-sync-live.mjs`: OK con 3 clientes.
- **Navegador (Chromium, Playwright):**
  - Menú como en la referencia, con y sin sesión.
  - Tienda con precios de prueba: compra real (2.500 → 2.200) y el botón pasa de COMPRAR a EQUIPAR y luego a EQUIPADO.
  - Conseguir monedas y Perfil.
  - Los botones abren los endpoints oficiales `accounts.google.com/o/oauth2/v2/auth` y `discord.com/oauth2/authorize` con los parámetros correctos.
- **No probado con cuentas reales de Google/Discord** (faltan credenciales).

## 26. Funciones pendientes

- Probar Google y Discord con credenciales reales (checklist de la sección 27).
- Integrar la pasarela de pago (sección 19).
- Definir precios: `goldPrice` de los paquetes e `itemPrices` de los artículos que se vendan.
- Hats reales (hoy solo existe `hat:0` = sin hat).
- Misiones, logros y eventos como fuentes de Tablas Normales.
- Fusión segura de dos cuentas ya existentes.
- Recuperar el equipo de la cuenta en el modo solitario (hoy usa el mismo perfil en memoria; funciona, pero sin validación del servidor porque la práctica es local).
- Prueba en vivo de la recompensa al terminar una carrera online entera (la lógica está probada a nivel de unidad).
- Cabeceras CSP y despliegue con HTTPS.

## 27. Configuración externa pendiente

| Qué | Dónde | Estado |
|---|---|---|
| Base de datos MySQL + `DATABASE_URL` | aaPanel → Databases y `servidor/.env` | PENDIENTE (dueño, pasos en la sección 6) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` y redirect URI | Google Cloud Console | BLOQUEADO (dueño) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` y redirect | Discord Developer Portal | BLOQUEADO (dueño) |
| `PUBLIC_URL` con dominio https + `SESSION_SECRET` + `NODE_ENV=production` | Servidor de producción | BLOQUEADO (dueño) |
| Proveedor de pagos, credenciales y webhook | Proveedor elegido | BLOQUEADO (dueño) |
| Precios de paquetes y artículos | `servidor/config/economy.json` | PENDIENTE (decisión de negocio) |

Checklist de prueba con credenciales reales (para cada proveedor):
- [ ] Botón visible y abre la autenticación real.
- [ ] Crea una cuenta nueva.
- [ ] Recupera la cuenta existente.
- [ ] Recupera monedas, inventario y equipo.
- [ ] Mantiene la sesión tras F5.
- [ ] Desde otra PC entra a la misma cuenta.
- [ ] Vincular el otro proveedor y entrar con él a la misma cuenta.
- [ ] Cerrar sesión.

## 28. Próximos pasos

1. Crear las credenciales de Google y Discord (secciones 8 y 9) y completar el checklist.
2. Decidir precios y activar los paquetes de conversión.
3. Elegir el proveedor de pagos e implementar checkout y webhook firmado.
4. Añadir hats y los primeros artículos de pago.
5. Desplegar con HTTPS.

## 29. Historial

### 2026-09-27 · Fase 1b · Soporte MySQL/MariaDB (aaPanel)
- `DATABASE_URL=mysql://...` usa MySQL/MariaDB; sin ella, SQLite. Las tablas se crean solas (migraciones por motor).
- Toda la capa de cuentas y economía pasa a ser asíncrona, con transacciones reales y bloqueo de filas (`FOR UPDATE`) en las operaciones de dinero.
- Probado en MariaDB 10.11 y SQLite: economía (con concurrencia), login completo con proveedor simulado, suite del juego y compra en el navegador.

### 2026-09-27 · Fase 1 de cuentas y economía
Todo lo descrito arriba: login Google y Discord, cuentas, SQLite, dos monedas, monedero, inventario, compras, conversión, pagos preparados, perfil, menú según la referencia, tienda con precios y pruebas.

### 2026-09-27 · Rendimiento y red (sesiones anteriores, PR #1–#4)
- **PR #1:** GlowLayer solo con poderes activos cercanos, ranking con límite de refresco, arreglo del temblor de los rivales en curvas, interpolación remota a 110 ms, no descartar snapshots por un byte pendiente y correcciones suavizadas.
- **PR #2:** predicción de los poderes propios (Tiki, Ola cohete, Delfín), interpolación del jugador local y thin instances en los stickman (2 draw calls por avatar en vez de 19).
- **PR #3:** cola de inputs en el servidor, un input por tick con colchón adaptativo. Correcciones visibles con jitter de 40 ms: del 37,7 % al 0,6 %.
- **PR #4:** aviso en la sala de espera si el servidor es antiguo (las wings de los demás salían como alas de ángel) y versión de protocolo en el arranque.
