// Registro de seguridad de las cuentas (tabla security_events, migración 005).
// Qué se anota: inicio de sesión correcto o fallido, cuenta nueva, vincular/desvincular,
// cierre de sesión, cambio de nick, compras, cambios de moneda, pagos y trades aceptados.
// Nunca se guardan secretos (tokens, códigos OAuth, cookies): solo el evento, la cuenta, la IP,
// el navegador y un detalle corto. Escribir el registro nunca rompe la acción del jugador.
import {nowSql} from './db.js';

const clip = (v, n) => v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

export function createAudit(db, {retentionDays = Number(process.env.SECURITY_LOG_DAYS) || 365} = {}) {
  async function log({event, ok = true, userId = null, ip = null, ua = null, detail = null}) {
    try {
      await db.run('INSERT INTO security_events (event, outcome, user_id, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?)',
        [clip(event, 48), ok ? 'ok' : 'fail', clip(userId, 36), clip(ip, 64), clip(ua, 200), detail == null ? null : clip(JSON.stringify(detail), 1000)]);
    } catch (error) { console.error('[audit] no se pudo registrar', event, error.message); }
  }
  // Para el panel: más recientes primero, con filtros opcionales.
  async function list({limit = 100, event = '', userId = '', ip = '', outcome = ''} = {}) {
    const where = [], args = [];
    if (event) { where.push('event LIKE ?'); args.push(String(event).slice(0, 48) + '%'); }
    if (userId) { where.push('user_id = ?'); args.push(String(userId).slice(0, 36)); }
    if (ip) { where.push('ip = ?'); args.push(String(ip).slice(0, 64)); }
    if (outcome === 'ok' || outcome === 'fail') { where.push('outcome = ?'); args.push(outcome); }
    args.push(Math.max(1, Math.min(500, Number(limit) | 0 || 100)));
    return (await db.all(`SELECT id, created_at AS createdAt, event, outcome, user_id AS userId, ip, user_agent AS userAgent, detail
      FROM security_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`, args))
      .map(r => ({...r, id: Number(r.id), detail: (() => { try { return r.detail ? JSON.parse(r.detail) : null; } catch { return r.detail; } })()}));
  }
  // Resumen de las últimas 24 h para el panel (fallos de login por IP, etc.).
  async function summary() {
    const since = nowSql(new Date(Date.now() - 24 * 3600_000));
    const rows = await db.all('SELECT event, outcome, COUNT(*) AS n FROM security_events WHERE created_at > ? GROUP BY event, outcome ORDER BY event', [since]);
    const topFailIps = await db.all("SELECT ip, COUNT(*) AS n FROM security_events WHERE outcome = 'fail' AND created_at > ? AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 5", [since]);
    return {since, events: rows.map(r => ({...r, n: Number(r.n)})), topFailIps: topFailIps.map(r => ({ip: r.ip, n: Number(r.n)}))};
  }
  // Retención: borra lo más antiguo que SECURITY_LOG_DAYS (365 por defecto).
  async function purge(days = retentionDays) {
    if (!(days > 0)) return 0;
    const r = await db.run('DELETE FROM security_events WHERE created_at < ?', [nowSql(new Date(Date.now() - days * 86400_000))]);
    return Number(r?.changes ?? r?.affectedRows ?? 0);
  }
  return {log, list, summary, purge};
}

// IP del cliente. Detrás de un proxy (nginx de aaPanel, Cloudflare...) la conexión llega desde
// 127.0.0.1: con TRUST_PROXY=1 se usa la primera IP de X-Forwarded-For (o X-Real-IP). Sin esa
// variable NO se hace caso a esas cabeceras (cualquiera podría falsearlas).
export function clientIp(res, req, trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '')) {
  if (trustProxy) {
    const fwd = (req.getHeader('x-forwarded-for') || '').split(',')[0].trim() || req.getHeader('x-real-ip').trim();
    if (/^[0-9a-fA-F:.]{3,45}$/.test(fwd)) return fwd;
  }
  return Buffer.from(res.getRemoteAddressAsText()).toString();
}
