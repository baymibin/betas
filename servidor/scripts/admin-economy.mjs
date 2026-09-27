// Administración de la economía desde la consola del servidor (ajustes autorizados).
// No existe ninguna ruta web para esto: solo quien tiene acceso al servidor puede usarlo.
//
//   npm run admin -- users                              lista cuentas y saldos
//   npm run admin -- grant <userId> <NORMAL_COIN|GOLD_COIN> <cantidad> "<motivo>"
//   npm run admin -- history <userId>                   últimos movimientos
//
// Cada ajuste queda en wallet_transactions como ADMIN_ADJUSTMENT con su motivo.
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase, syncCatalog, loadEconomyConfig} from '../src/db.js';
import {createEconomy} from '../src/economy.js';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = loadEconomyConfig(), db = await openDatabase();
await syncCatalog(db, config);
const economy = createEconomy(db, config);
const [command, ...args] = process.argv.slice(2);

if (command === 'users') {
  const rows = await db.all(`SELECT u.id, u.nickname, group_concat(DISTINCT a.provider) AS providers,
      (SELECT balance FROM wallets w WHERE w.user_id = u.id AND currency = 'NORMAL_COIN') AS normal,
      (SELECT balance FROM wallets w WHERE w.user_id = u.id AND currency = 'GOLD_COIN') AS gold
    FROM users u LEFT JOIN auth_identities a ON a.user_id = u.id GROUP BY u.id, u.nickname, u.created_at ORDER BY u.created_at`);
  console.table(rows.map(r => ({...r})));
} else if (command === 'grant') {
  const [userId, currency, amountText, ...reason] = args, amount = Number(amountText);
  if (!await economy.getUser(userId)) { console.error('No existe la cuenta', userId); await db.close(); process.exit(1); }
  if (!Number.isSafeInteger(amount) || amount === 0) { console.error('Cantidad entera distinta de 0 (negativa para retirar)'); await db.close(); process.exit(1); }
  const balance = await economy.adminAdjust(userId, currency, amount, reason.join(' '));
  console.log(`OK · ${currency} de ${userId}: ${balance}`);
} else if (command === 'history') {
  console.table(await economy.transactions(args[0], 50));
} else {
  console.log('Uso: npm run admin -- users | grant <userId> <NORMAL_COIN|GOLD_COIN> <cantidad> "<motivo>" | history <userId>');
}
await db.close();
