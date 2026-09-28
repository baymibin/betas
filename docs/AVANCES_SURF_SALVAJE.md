# Surf Salvaje · Avances técnicos

> Memoria técnica del proyecto. **Léela antes de empezar cualquier tarea y actualízala al terminar** (sin borrar el historial).
> No contiene secretos: las credenciales viven solo en `servidor/.env` (fuera de git).

Leyenda de estados: **IMPLEMENTADO** (código hecho) · **PROBADO** (verificado con pruebas automáticas o en navegador) · **PENDIENTE** (falta hacerlo) · **BLOQUEADO POR CONFIGURACIÓN EXTERNA** (el código está listo; falta algo que solo puede hacer el dueño del proyecto, como crear credenciales).

Última actualización: **2026-09-28**

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
| `GET /api/trade/summary` · `/inventory` · `/user?code=` · `/offers?box=received\|sent\|history` · `/blocked` | Trade: código propio y ofertas pendientes, items intercambiables, buscar surfista, listados, bloqueados | sí | — |
| `POST /api/trade/offers` · `/accept` · `/decline` · `/cancel` · `/block` · `/unblock` | Trade: crear (o contraofertar, o negociar una publicación con `listingId`), aceptar, rechazar, cancelar, bloquear | sí | sí |
| `GET /api/trade/listings[?mine=1]` · `POST /api/trade/listings` · `POST /api/trade/listings/withdraw` | Trades públicos: tablón, publicar, retirar | sí | POST: sí |

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
- `002_trade.sql` (Trade): crea `user_inventory_v2` e `item_purchases_v2` **copiando** los datos de `user_inventory` e `item_purchases`, que quedan como histórico (no se borran ni se modifican). Hacía falta porque la tabla anterior no admitía el origen `TRADE` (su `CHECK` no se puede cambiar en SQLite sin reconstruirla) y `item_purchases` impedía volver a comprar un item entregado en un trade (`UNIQUE (user_id, item_id)`). Añade `trade_profiles` (código de surfista), `trade_offers`, `trade_offer_items`, `item_transfers` (libro de movimientos de items) y `trade_blocks`. Sin `ALTER TABLE`: se puede relanzar en MySQL.
- `003_trade_listings.sql` (Trades públicos): `trade_listings`, `trade_listing_items` (OFFER = lo que se publica, WANT = lo que se busca) y `trade_listing_offers` (qué ofertas nacen de cada publicación). Solo tablas nuevas.
- **Las dos tablas `user_inventory` y `user_inventory_v2` conviviendo es normal:** la antigua queda como copia de antes del Trade y ya no se usa. No hace falta importar ningún `.sql` a mano: el servidor aplica las migraciones pendientes al arrancar.
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

**IMPLEMENTADO · PROBADO.** `user_inventory_v2` (desde la migración 002) guarda lo comprado, lo entregado por un admin (`npm run admin -- give-item`) y lo recibido en un trade (origen `TRADE`). Los artículos gratuitos no hace falta poseerlos: todos pueden usarlos. No se regala el catálogo a las cuentas nuevas. El inventario se ve en Perfil y se recupera en cualquier PC.

## 16. Catálogo

**IMPLEMENTADO · PROBADO.**
- Fuente única: `client/src/shared/catalog.js` (nombres, descripciones, wings) + `board-cosmetics.js` (tablas). Lo usan la tienda, las salas y el servidor.
- IDs estables `categoria:indice` (`character:0..4`, `board:0..5`, `wing:0..8`, `hat:0`). **El índice es el que usa Babylon.js y el protocolo: no reordenar ni borrar**, solo añadir al final.
- Precios en `config/economy.json → itemPrices` (Tablas Normales). **Desde el 2026-09-28 solo son gratis Classic (`character:0`), Ola Tropical (`board:0`), Angel Wings (`wing:0`) y Sin hat (`hat:0`).** El resto tiene precio:

| Rareza | Items | Precio |
|---|---|---|
| Común | Mint, Sunny, Lilac, Coral (`character:1..4`) | 300 |
| Raro | Gótica, Dragón, Anime (`board:1..3`) · Aqua, Fire, Crystal, Nature Wings (`wing:1..4`) | 600 |
| Épico | Cine, Bloques (`board:4..5`) · Bat Demon, Crimson Butterfly Wings (`wing:5..6`) | 1000 |
| Legendario | Dark Demon, Mechanical Demon Wings (`wing:7..8`) | 1500 |

- Rareza en `itemRarity` (common, rare, epic, legendary; solo presentación): se ve en La tiendita y en el Trade.
- Consecuencia: quien llevaba un item que ahora es de pago sin haberlo comprado vuelve al gratuito de esa ranura (el servidor nunca regala items de pago). Los invitados solo pueden lucir los gratuitos.

## 17. Compras

**IMPLEMENTADO · PROBADO.** `POST /api/shop/purchase {itemId, requestId}`:
1. Sesión + CSRF.
2. En una transacción atómica: repetición del mismo `requestId` → devuelve el mismo resultado sin cobrar; artículo existente y disponible; precio leído de la base de datos (se ignora cualquier precio que envíe el cliente); no gratuito; no poseído.
3. Descuenta Tablas Normales (falla con `insufficient_funds` sin tocar nada), entrega el artículo y registra la compra y el movimiento.

Un item entregado en un trade se puede volver a comprar (la propiedad la decide el inventario; `item_purchases_v2` solo registra la compra por `requestId`).

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

## Remasterización del perfil "Mi surfer" (2026-09-27)

**IMPLEMENTADO · PROBADO en navegador (Chromium) a 1920×1080, 1672×941, 1366×768 y 390×844.**

Un único modal (`#profile-dialog`) para invitado y cuenta, con el mismo tamaño, el mismo fondo y la misma columna izquierda; solo cambia la columna derecha según haya sesión.

- **Formato:** panorámico como La tiendita, `width:min(1180px,96vw)`, `max-height:94dvh`, radio de 22 px, borde turquesa y cristal azul petróleo. El fondo del modal y el `::backdrop` usan `shop-bg-tropical.webp` con un velo suave (se ven las islas, las palmeras y el atardecer). Dos columnas 45 % / 55 %. En escritorio no hay scroll interno; por debajo de 900 px de ancho las columnas se apilan y el modal hace scroll vertical.
- **Columna izquierda (común):** kicker "TU IDENTIDAD EN EL AGUA", título "Mi surfer" con icono de ola y **escena 3D real**. Esta es una segunda instancia de `createShopPreview` (el mismo módulo de La tiendita, sin duplicar lógica), sobre `shop-preview-backdrop.webp`, con la roca, el personaje, la tabla y las wings equipadas, las alas animadas y giro con el ratón. Debajo, el nick grande, la línea "personaje · tabla · wings" (del equipo real) y la tarjeta del nick: avatar, campo con lápiz y botón Guardar. Con cuenta se añade el ID Surf Salvaje con botón de copiar.
- **Nick:** es uno solo. Con cuenta se guarda en el servidor (`/api/account/nickname`); como invitado, en el perfil del navegador (el mismo que el campo "TU NICK" del menú).
- **Invitado (imagen A):**
  - tarjeta "GUARDA TU PROGRESO" con los botones reales **Continuar con Google** y **Continuar con Discord** (los mismos flujos OAuth del login; sin credenciales explican que falta configurarlos);
  - tres tarjetas: Guarda monedas, Recupera inventario y Accede desde cualquier PC;
  - nota "MODO INVITADO";
  - pie con **Personalizar en la tienda** y **Practicar en solitario**.
  - No se muestran saldos.
- **Cuenta (imagen B):**
  - **Monedero** con los saldos reales;
  - **Accesos vinculados** con el estado real: Vincular / Desvincular / "Acceso principal" si es el único;
  - **Equipamiento** con 4 tarjetas visuales: personaje (SVG), tabla (imagen real), wings (sprite real), y hat o "Sin hat";
  - **Inventario** real (o un estado vacío) con acceso a La tiendita;
  - **Historial** real del servidor;
  - pie con **Personalizar en la tienda** y **Cerrar sesión** (acento rojo).
- **Tiempo real:** si cambia la sesión o el equipo con el perfil abierto, se vuelve a pintar y la escena 3D se actualiza.

Archivos:
- Creados: `client/src/account/profile-ui.js` y `client/styles/profile.css`.
- Modificados: `client/index.html` (nuevo marcado del modal y enlace a `profile.css`), `client/src/account/account-ui.js` (el perfil sale de aquí), `client/src/account/account.js` (`DEFAULT_AVATAR` compartido) y `client/styles/account.css` (se retiran los estilos del perfil antiguo).
- Estilos reutilizados: fondo y escenario de La tiendita (`shop-bg-tropical.webp`, `shop-preview-backdrop.webp`), botones dorados, cristal y bordes turquesa, iconos de moneda (`tabla-normal.svg`, `tabla-oro.svg`) y el sprite de wings.

Pruebas (Playwright, servidor real, cuenta de prueba creada con `loginIdentity` + sesión):
- Invitado: Google y Discord visibles, y abren `accounts.google.com` (`scope=openid profile`) y `discord.com/oauth2/authorize` (`scope=identify`) cuando hay credenciales; sin ellas lo explican. El nick se guarda en el perfil, el menú y el navegador. Personalizar abre La tiendita. Practicar arranca la práctica.
- Cuenta: saldos, accesos, equipo (3 activos + sin hat), inventario e historial reales. El nick se guarda en el servidor. Cerrar sesión vuelve al modo invitado en el mismo modal.
- Sin errores de consola. Sin scroll horizontal. Sin scroll interno en escritorio (1366×768 incluido). `npm test` 60/60.

Pendiente: avatar propio para invitados (hoy se usa el genérico); hats reales en el equipamiento cuando existan; el sprite de wings de la tarjeta muestra el primer fotograma (sin animación).

## Remasterización del modal Ajustes (2026-09-28)

**IMPLEMENTADO · PROBADO en navegador (Chromium) a 1274×716, 1366×768, 1672×941 y 390×844.**

Cambio **solo de presentación**. Los controles conservan sus `id`, así que `home-ui.js` (lectura, guardado y aplicación), `core/settings.js` (persistencia en `localStorage`, clave `surf.settings.v1`) y el audio (`categoryGain` = general × categoría, aplicado una sola vez) siguen **sin cambios**.

- **Modal:** `width:min(90vw,950px)`, `max-height:94dvh`, radio de 26 px, borde turquesa y cristal azul petróleo sobre `shop-bg-tropical.webp`. El `::backdrop` usa el mismo paisaje con `blur(7px) saturate(.9)` y un velo azul petróleo. Dos siluetas tropicales (hibisco y hojas) como capas del fondo con opacidad del 6-8 %, sin imágenes nuevas y sin crear desbordamiento.
- **Cabecera:** "A TU MANERA", título "Ajustes 🌊" (emoji, como pediste) y el mismo botón × circular del Perfil (`.profile-close`).
- **Tarjetas:**
  - **Sonido:** icono de altavoz en dorado y casilla.
  - **Ajustes de audio:** 4 filas con la estructura [icono] [nombre] [slider] [porcentaje], separadas por líneas turquesa tenues:
    - Volumen general (altavoz);
    - Música (nota);
    - Ambiente (ola);
    - Efectos (destellos).
  - **Efectos visuales:** icono de ojo y casilla.
  - **Calidad gráfica:** icono de monitor, select con flecha y la nota informativa debajo.
- **Sliders:** pista azul petróleo, tramo activo con degradado turquesa → aqua → amarillo (`--fill`, lo actualiza `home-ui.js`; en Firefox, `::-moz-range-progress`) y thumb dorado con borde claro, brillo y anillo de foco para teclado. El porcentaje real se actualiza en tiempo real.
- **Casillas:** cuadrado turquesa con marca blanca (`appearance:none`), foco visible.
- **Iconos:** SVG en línea (altavoz, nota, ola, destellos, ojo y monitor), sin librerías.
- **Responsive:** en escritorio no hay scroll interno ni horizontal; en pantallas bajas se compacta; por debajo de 640 px cada slider pasa a su propia fila, el select ocupa todo el ancho y el modal hace scroll vertical.
- **Perfil:** el icono del título "Mi surfer" pasa a ser el emoji 🌊 (antes era una imagen).

Archivos:
- Creado: `client/styles/settings.css`.
- Modificados: `client/index.html` (marcado del modal Ajustes, título del Perfil y enlace a `settings.css`) y `client/styles/profile.css` (estilo del emoji).
- Sin cambios: `home-ui.js`, `settings.js`, `audio.js` y el juego.

Pruebas (Playwright, 12 comprobaciones OK):
- valores reales por defecto (100/70/80/90);
- cada slider actualiza porcentaje y relleno al instante, también con teclado;
- volumen efectivo = general × categoría;
- Efectos visuales aplica `effects-off`;
- Sonido desactivado silencia todo;
- Calidad cambia y conserva los 3 presets;
- tras **F5** se recuperan volúmenes, casillas y calidad;
- la × cierra el modal;
- 0 errores de consola.
- `npm test` 60/60.

Problemas encontrados: el porcentaje "100 %" se partía en dos líneas (columna ampliada y `nowrap`), y las decoraciones hechas con pseudo-elementos que salían del borde generaban scroll interno (pasaron a ser capas de fondo).

## Trade (2026-09-28)

**IMPLEMENTADO · PROBADO (servidor en SQLite y MariaDB; navegador Chromium a 1366×768, 1672×941 y 390×844).**

Intercambio de **items por items, sin monedas**, solo entre **cuentas registradas**. El servidor decide todo: qué tiene cada uno, si la oferta vale y el intercambio en sí.

**Reglas (servidor, `servidor/src/trade.js`):**
- Solo se ofrecen items **poseídos** y **no gratuitos** (los gratuitos los tiene todo el mundo). `trade.untradeable` en `economy.json` puede excluir ids concretos.
- De 1 a `maxItemsPerSide` (4) items por lado. Quien recibe un item no puede tenerlo ya. No se puede hacer un trade con uno mismo.
- Cada cuenta tiene un **código de surfista** (`SURF-XXXXX`, 5 caracteres sin 0/O/1/I). Se ve en el Perfil y en la cabecera del Trade, y se escribe con o sin guion, en mayúsculas o minúsculas. Los nicks se repiten, por eso no se busca por nick.
- Las ofertas son **inmutables**: cambiar algo es una **contraoferta** (`parentId`), y la original pasa a `COUNTERED`.
- Aceptar exige el `contentHash` de lo que se vio, así nadie puede cambiar la oferta en el último momento. Sucede en **una sola transacción**:
  1. Se bloquean los monederos de las dos cuentas, siempre en el mismo orden, así no hay interbloqueos en MySQL.
  2. Se vuelve a comprobar todo: estado, caducidad, límite diario, propiedad y que nadie reciba algo que ya tiene.
  3. Se mueven los items (origen `TRADE`). Lo entregado que estuviera equipado vuelve al gratuito.
  4. Cada movimiento queda en `item_transfers`.
  5. Las demás ofertas abiertas con esos items pasan a `INVALID`.

  Repetir la petición no repite el trade.
- **Estados:** `OPEN`, `COMPLETED`, `DECLINED`, `CANCELED`, `EXPIRED` (a las `offerTTLHours` = 72 h), `INVALID`, `COUNTERED` y `REVERTED`.
- **Anti-abuso:**
  - antigüedad mínima de la cuenta (`minAccountAgeHours` = 24; pon 0 para probar en local con cuentas recién creadas);
  - `dailyTradeLimit` (20) trades por cuenta y día;
  - `maxOpenOffers` (10) ofertas abiertas;
  - no se repite la misma oferta abierta;
  - límite de peticiones del grupo `write`.
- **Bloqueos:** quien bloquea deja de recibir ofertas de esa cuenta y se cancelan las pendientes entre las dos. Se desbloquea desde el Historial.
- **Administración** (solo consola):
  - `npm run admin -- give-item <userId> <itemId> "<motivo>"`: entrega un item, útil para eventos o para probar;
  - `trades <userId>`: lista los trades de una cuenta;
  - `trade-revert <tradeId>`: deshace un trade si los items siguen en manos de quien los recibió; queda como `REVERT` en `item_transfers`.

**Interfaz (`client/src/account/trade-ui.js`, `client/styles/trade.css`), según el boceto:**
- Botón **Trade** en el menú con el icono entregado (`assets/images/menu/menu-trade.webp`, recortado a 256 px) y un globo con las ofertas recibidas pendientes.
- **Sin sesión:** el modal solo muestra "Solo para surfistas registrados" con Continuar con Google / Discord.
- **Cabecera:**
  - kicker "🌴 SURF CLUB · TRADE";
  - título "Trade" con el icono;
  - tu código de surfista, que se copia con un clic;
  - pestañas **Mis items**, **Ofertas recibidas** (con contador), **Ofertas enviadas** e **Historial**.
- **Mis items (nuevo trade), en tres columnas:**
  1. **Items:** interruptor Tus items / Items de <nick>, filtros Todos, Personajes, Tablas, Wings y Hats, y tarjetas con rareza, "EN USO" y "YA LO TIENES".
  2. **Nuevo trade:** buscar por código, surfista elegido, columnas Ofreces y Recibes con "Agregar item", botón **Enviar oferta** y confirmación.
  3. **Vista del item:** en 3D (la misma escena de La tiendita, con el item puesto sobre tu surfer), nombre, rareza, tipo, descripción y el **Resumen del trade**.
- **Ofertas:**
  - **recibidas:** Aceptar (con confirmación que avisa de lo que entregas), Contraofertar (abre el constructor con la oferta), Rechazar y Bloquear;
  - **enviadas:** Cancelar;
  - **historial:** estado y fecha, más la lista de surfistas bloqueados.
- Responsive: dos columnas por debajo de 1060 px y una sola en móvil, sin scroll horizontal.
- Hats: la pestaña existe, pero hoy solo hay "Sin hat" (gratuito), así que aparece vacía con "Los hats llegarán pronto".
- Para las pruebas en vivo de red, `test/fixtures/economy-free.json` deja todos los cosméticos gratis. Solo es una fixture de pruebas y el servidor real no la usa.

### Trades públicos y ajustes del inicio (2026-09-28, segunda entrega)

**IMPLEMENTADO · PROBADO (servidor en SQLite y MariaDB; navegador Chromium).**

- **Trades públicos (tablón):**
  - Pestaña "Trades públicos" en el Trade, con contador. Cada publicación muestra quién la hizo, lo que ofrece y lo que busca (o "Acepta ofertas"), cuánto le queda y la pista "Tienes lo que busca".
  - **Publicar:** en "Mis items", el interruptor "Publicar en el tablón" (o el botón "Publicar trade" del tablón) permite elegir de 1 a 4 items propios y, si se quiere, hasta 4 items buscados del catálogo ("Lo que buscas").
  - **Negociar:** abre el constructor con el dueño ya elegido, su publicación en "Recibes" y en "Ofreces" lo que busca y ya tienes. Se puede cambiar todo. La oferta llega al dueño marcada "por tu publicación", y él la acepta, rechaza o contraoferta como cualquier otra.
  - **"Mis publicaciones":** ves las tuyas con el número de ofertas recibidas y puedes retirarlas.
  - **Cierre automático:** al completarse un trade nacido de una publicación, esta se cierra (COMPLETED); las publicaciones que ofrecían items ya entregados pasan a INVALID; las de surfistas bloqueados no se ven; caducan a las `listingTTLHours` (168 h), y cada cuenta puede tener como mucho `maxOpenListings` (5) abiertas.
- **Trade:**
  - título con 🌊;
  - el modal se abre ya con su tamaño final (altura fija), en vez de abrirse pequeño y crecer al cargar;
  - para invitados usa los mismos botones de Google y Discord que el menú (`.auth-btn`).
- **Inicio:**
  - se quitan "SUBE A TU TABLA" y los datos (playas, vueltas, estilo);
  - en la caja de JUGAR quedan solo **Jugar en solitario** y, con sesión, **Cerrar sesión**. Desaparece el bloque de nick, monedas y "Cerrar sesión" en texto;
  - sin sesión, **Continuar con Google / Discord** va abajo a la izquierda, encima de los controles;
  - abajo a la derecha, el **icono de Discord**. Abre la invitación de `DISCORD_INVITE_URL` (en `servidor/.env`; solo https). Sin ella, explica que falta configurarla.
- **Botón cerrar de todos los modales:** Perfil, Ajustes, Trade, Tienda y Salas usan el mismo círculo que "Crear partida" (44 px, `#143c4a9c`, borde blanco translúcido y coral al pasar el ratón).
- **Pausa (ESC):**
  - usa el cristal de los demás modales y los botones del juego: REANUDAR dorado como JUGAR, y "Salir al menú" como los botones secundarios del inicio;
  - antes, `font: 900 16px inherit` era CSS inválido y los botones salían con la fuente del sistema.

## Panel administrativo (2026-09-28)

**IMPLEMENTADO · PROBADO (servidor en SQLite y MariaDB; navegador Chromium).**

- **Acceso:**
  - Dirección `https://tu-dominio/admin`, con usuario y contraseña. No usa Google ni Discord: son cuentas propias del panel (`admin_users`).
  - Para crear el administrador (o cambiarle la contraseña), en `servidor/`: `npm run admin -- admin-user <usuario> <contraseña>`. La contraseña debe tener 10 caracteres o más.
  - Alternativa: `ADMIN_USER` + `ADMIN_PASSWORD` en `.env`. Solo crea el administrador si todavía no existe ninguno. Después conviene quitar `ADMIN_PASSWORD`.
- **Seguridad:**
  - contraseñas con scrypt;
  - cookie `ss_admin` HttpOnly + SameSite=Strict limitada a `/admin`, que dura 8 h, y en la base solo se guarda su SHA-256;
  - cabecera `X-Admin-CSRF` + Origin en todo lo que cambia algo;
  - 5 intentos fallidos bloquean 15 min;
  - cambiar la contraseña cierra las sesiones abiertas;
  - cada acción queda en `admin_audit` (sección "Registro").
- **Secciones:**
  - **Resumen:** usuarios (y nuevos hoy), compras y monedas gastadas, monedas en circulación, recompensas de hoy, trades y últimas compras y trades.
  - **Usuarios:** búsqueda por nick, código `SURF-XXXXX` o ID. En la ficha:
    - ver accesos, saldo, inventario, movimientos y trades;
    - ajustar monedas (siempre con motivo; nunca puede quedar negativo);
    - entregar o quitar items (lo quitado se desequipa).
  - **Compras** y **Movimientos**, con filtro por tipo.
  - **Trades:** filtro por estado; los completados se pueden **revertir** si los items siguen en manos de quien los recibió.
  - **Tienda:**
    - editar precio, rareza, nombre, descripción y "a la venta" de cualquier item. El item 0 de cada ranura es de serie y siempre gratis;
    - **subir tablas, wings y hats nuevos.** Se validan la firma real (PNG, WebP o JPEG) y el tamaño (hasta 4 MB), y se guardan en `servidor/data/uploads` con nombre aleatorio (fuera de git; `UPLOADS_DIR` lo cambia);
    - los items subidos se **añaden al final** de su lista (`custom_items`), así que nunca cambia un índice existente, y se ven en la tienda, el Trade, las salas y la carrera;
    - formatos:
      - tabla: vista cenital en vertical, fondo transparente;
      - wing: hoja de 4×2 fotogramas, como las actuales;
      - hat: imagen frontal cuadrada. Se dibuja sobre la cabeza del surfer, siempre de cara a la cámara.
  - **Monedas:** paquetes Oro → Normales, productos de oro (precio en céntimos; la compra real sigue desactivada) y recompensas de carrera. Se aplican al momento.
  - **Registro:** entradas, intentos fallidos y cada acción del panel.
- **Dónde se guardan los cambios:** en la base de datos (`item_overrides`, `economy_overrides`, `custom_items`; migración `004_admin.sql`), por encima de `economy.json`. Los jugadores ven los items y los precios nuevos al recargar el juego (`/api/catalog/custom`).
- **Nota:** "a la venta" desactivado oculta el item de La tiendita y bloquea su compra (`item_not_for_sale`), pero quien ya lo tiene lo conserva.

## Ajustes del juego (2026-09-28, tercera entrega)

**IMPLEMENTADO · PROBADO (navegador Chromium y pruebas automáticas).**

- **Caja de poder estilo Mario Kart:**
  - Al coger una caja, la ruleta gira 2,5 s (`ITEM_ROLL_TICKS`).
  - Pulsar **E** mientras gira solo la **para** y muestra el poder; hay que volver a pulsar E para usarlo. Si no se pulsa, la ruleta se para sola.
  - Es una regla de la simulación (servidor, práctica y predicción del cliente, igual en los tres) y viaja en el SNAPSHOT (byte libre 106, sin cambiar la versión del protocolo). Los bots esperan a ver su poder.
- **Mirar atrás (clic derecho sostenido):** antes nunca se activaba sobre el juego, porque Babylon cancela los `mousedown` del canvas. Ahora usa eventos pointer y muestra el aviso "MIRANDO ATRÁS".
- **Salas:**
  - el interruptor **Privada** ahora sí llega al servidor (byte 22 de ROOM_REQUEST). Una sala privada no aparece en "Buscar salas" y solo se entra con su código;
  - el código se muestra con una nota explicativa y queda más separado del botón "Crear sala de espera";
  - "Copiar código" ya no rebota entre "¡Copiado!" y "Copiar código" al pulsarlo dos veces.
- **Bots en salas:** comprobado en navegador que los bots elegidos están en la sala de espera, en el ranking (8/8 surfistas) y en la carrera. Al principio salen justo al lado y detrás de la cámara.
- **Perfil:** ya no se muestra el ID interno, solo el código de surfista.
- **Ajustes:** el modal ya no se estira al mover un volumen (el aviso "Preferencias guardadas" tiene su espacio reservado).
- **Menú:** el icono del Trade pasa a `menu-trade.png`, como los demás iconos del menú.
- **La tiendita:**
  - la pestaña "Conseguir monedas" pasa a llamarse **Monedas**;
  - **Hats** ya no dice "Pronto" y muestra los hats subidos desde el panel.

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
- **Trade (2026-09-28):**
  - `test/trade.test.js`: 11 pruebas × 2 motores = **22/22** (SQLite y MariaDB 10.11). Cubren:
    - códigos de surfista;
    - un trade completo, con desequipado, libro de movimientos, repetición sin efecto y recompra;
    - todas las validaciones de creación;
    - solo acepta el destinatario y con la huella exacta;
    - **5 aceptaciones simultáneas → 1 trade**;
    - el mismo item en dos ofertas aceptadas a la vez: solo una se completa y el item existe una sola vez;
    - contraofertas, caducidad, bloqueos, antigüedad mínima y reversión del admin.
  - `npm test` completo (servidor con `test/fixtures/economy-free.json`): **71/71**.
  - Navegador, dos cuentas de prueba: **32 comprobaciones**. Cubren:
    - invitado sin acceso ni globo;
    - globo con las ofertas reales;
    - código propio;
    - solo los items intercambiables;
    - códigos mal escritos, propio o en minúsculas;
    - items del otro;
    - vista 3D con rareza y resumen;
    - confirmación antes de enviar;
    - oferta en Enviadas;
    - aceptar una oferta, con el inventario real cambiado en el servidor;
    - contraoferta;
    - historial;
    - rechazar, bloquear y desbloquear;
    - código visible en el Perfil.

    No hay errores de consola, salvo los 400 esperados de los códigos inválidos que la propia prueba escribe.
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
- Trade: lista de **jugadores recientes** para elegir destinatario.
- Trade: aviso en tiempo real de ofertas nuevas (hoy el globo se actualiza al abrir el menú o el Trade).

## 27. Configuración externa pendiente

| Qué | Dónde | Estado |
|---|---|---|
| Base de datos MySQL + `DATABASE_URL` | aaPanel → Databases y `servidor/.env` | PENDIENTE (dueño, pasos en la sección 6) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` y redirect URI | Google Cloud Console | BLOQUEADO (dueño) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` y redirect | Discord Developer Portal | BLOQUEADO (dueño) |
| `PUBLIC_URL` con dominio https + `SESSION_SECRET` + `NODE_ENV=production` | Servidor de producción | BLOQUEADO (dueño) |
| Proveedor de pagos, credenciales y webhook | Proveedor elegido | BLOQUEADO (dueño) |
| `DISCORD_INVITE_URL` (icono de Discord del inicio) | `servidor/.env` | PENDIENTE (dueño) |
| Precios de artículos | `servidor/config/economy.json` | IMPLEMENTADO (2026-09-28, sección 16) |
| Precios de paquetes Oro → Normales | `servidor/config/economy.json` | PENDIENTE (decisión de negocio) |

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

### 2026-09-28 · Panel administrativo y ajustes del juego
- Panel `/admin` con usuario y contraseña. Permite ver usuarios, compras, movimientos y trades; ajustar monedas, entregar y quitar items y revertir trades; editar la tienda; subir tablas, wings y hats; y editar paquetes de monedas y recompensas. Migración 004.
- Caja de poder estilo Mario Kart (E para la ruleta y E usa el poder), mirar atrás con clic derecho, salas privadas por código, arreglo de "Copiar código", Perfil sin ID, Ajustes sin estirarse, tienda con "Monedas" y hats reales, e icono del Trade en PNG.

### 2026-09-28 · Trades públicos, inicio simplificado y modales unificados
- Tablón de Trades públicos (publicar, negociar, retirar) con migración 003. Trade con 🌊 y sin redimensionarse al abrir.
- Inicio: JUGAR + Jugar en solitario (+ Cerrar sesión), acceso con Google/Discord abajo a la izquierda e icono de Discord abajo a la derecha. Botón cerrar idéntico en todos los modales y pausa con los botones del juego.

### 2026-09-28 · Sistema de Trade
- Intercambio de items por items (sin monedas) solo para cuentas registradas, con código de surfista, ofertas, contraofertas, caducidad, bloqueos, historial y administración por consola (sección "Trade").
- Todos los items tienen precio salvo Classic, Ola Tropical, Angel Wings y Sin hat, con rareza en la tienda y el Trade (sección 16).
- Migración 002 (SQLite y MySQL), probada en MariaDB y SQLite. Botón Trade en el menú con el icono entregado, y código de surfista en el Perfil.

### 2026-09-28 · Remasterización del modal Ajustes
- Panel horizontal con tarjetas, iconos SVG, sliders turquesa → amarillo con thumb dorado y porcentaje real; misma lógica y persistencia. Título del Perfil con emoji 🌊.

### 2026-09-27 · Remasterización del perfil "Mi surfer"
- Nuevo modal panorámico de dos columnas, compartido por invitado y cuenta, con la escena 3D de La tiendita y el equipo real (detalles en la sección "Remasterización del perfil").

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
