# Surf Salvaje

## Iniciar el juego

Desde `C:\APLICATIVO\SURF\servidor`:

```powershell
npm install
npm start
```

Abrir http://localhost:3000. Las dependencias ya instaladas están en `servidor/node_modules`.
Desde otra carpeta también se puede usar `npm --prefix C:\APLICATIVO\SURF\servidor start`.

## Organización

- `../client/index.html`: entrada del navegador.
- `../client/src/`: código, dividido en core, audio, characters, effects, network, shared, ui y world.
- `../client/styles/`: hojas de estilo.
- `../client/assets/images/`: backgrounds, environment, hud, menu, powerups, sprites y wings.
- `../client/assets/audio/`: music, ambience y effects.
- `src/`: servidor uWebSockets.js.
- `test/`: pruebas automatizadas.
- `scripts/`: verificaciones y herramientas de mantenimiento.
- `artifacts/screenshots/`: capturas de comprobación; no son recursos del juego.
- `docs/`: documentación, instrucciones del arte e historial.
- `backups/`: originales, versiones anteriores y migraciones archivadas.

La simulación y el protocolo compartidos viven en `client/src/shared` y se importan también desde el servidor, sin duplicar reglas. El servidor publica únicamente archivos del cliente.

## Comprobaciones

Con el servidor iniciado, en otra terminal ubicada en `servidor`:

```powershell
npm test
node scripts/verify-layout.mjs
node scripts/verify-race-live.mjs
```

`verify-layout.mjs` comprueba imports, todos los recursos públicos y que el servidor no publique archivos internos. El mapa completo de la reorganización está en `docs/relocation-map.json`.

Las herramientas antiguas de migración permanecen en `backups/migrations` como referencia histórica, no como comandos que deban ejecutarse otra vez.

## Cuentas y economía

Login con Google y Discord, monedas (Tablas Normales y Tablas de Oro), inventario y tienda con precios.
Configuración: copia `.env.example` a `.env` y rellena las credenciales (ver `docs/AVANCES_SURF_SALVAJE.md`, secciones 8 y 9).
Precios y recompensas: `config/economy.json`. Ajustes de saldo autorizados: `npm run admin -- users | grant | history`.
La base de datos (SQLite) se crea sola en `servidor/data/` (no se sube a git). Requiere Node.js 22.13 o superior.
