# Surf Salvaje · instrucciones para Claude Code

- **Antes de empezar cualquier tarea, lee `docs/AVANCES_SURF_SALVAJE.md`** (memoria técnica: arquitectura, base de datos, cuentas, economía, estado de cada función y configuración pendiente).
- **Al terminar, actualiza `docs/AVANCES_SURF_SALVAJE.md`**: añade una entrada al historial (sección 29) y cambia los estados IMPLEMENTADO / PROBADO / PENDIENTE / BLOQUEADO POR CONFIGURACIÓN EXTERNA que correspondan. No borres el historial anterior ni escribas secretos en él.
- Servidor: `cd servidor && npm install && npm start` (Node ≥ 22.13). Pruebas: `npm test` con el servidor en marcha en el puerto 3000.
- El servidor es la autoridad de saldos, precios, propiedad y resultados: no muevas esa lógica al navegador.
- Esquema de base de datos: solo con migraciones nuevas en `servidor/migrations/` (nunca editar una ya aplicada ni usar `DROP TABLE` sobre datos reales).
- No cambiar los índices del catálogo (`client/src/shared/catalog.js`, `board-cosmetics.js`): los usan Babylon.js y el protocolo.
- Secretos solo en `servidor/.env` (ignorado por git). Plantilla: `servidor/.env.example`.
