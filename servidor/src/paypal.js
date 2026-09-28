// Cliente mínimo de la API REST de PayPal (Orders v2 + verificación de webhooks).
//   - Token OAuth2 (client_credentials) con caché hasta poco antes de caducar.
//   - createOrder: orden con intent CAPTURE y precio decidido por el servidor.
//   - captureOrder: cobra una orden aprobada (idempotente con PayPal-Request-Id).
//   - verifyWebhook: pide a PayPal que compruebe la firma de un webhook recibido.
// Credenciales solo desde servidor/.env (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID).
const BASES = {sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com'};

export class PayPalError extends Error {
  constructor(message, status = 502, details = {}) { super(message); this.status = status; this.details = details; }
}

// Céntimos -> "12.34" (PayPal trabaja con cadenas decimales). Solo divisas de 2 decimales.
export const formatMinor = minor => (Math.trunc(minor / 100)) + '.' + String(Math.abs(minor % 100)).padStart(2, '0');
export const parseMinor = value => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  return m ? Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0')) : NaN;
};

export function paypalSettings(env = process.env) {
  const mode = env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
  return {
    clientId: env.PAYPAL_CLIENT_ID || '', clientSecret: env.PAYPAL_CLIENT_SECRET || '', webhookId: env.PAYPAL_WEBHOOK_ID || '',
    mode, apiBase: (env.PAYPAL_API_BASE || BASES[mode]).replace(/\/$/, ''), brandName: env.PAYPAL_BRAND_NAME || 'Surf Salvaje'
  };
}

export function createPayPal(settings = paypalSettings(), fetchImpl = globalThis.fetch) {
  const enabled = !!(settings.clientId && settings.clientSecret);
  let token = null, tokenUntil = 0;

  async function call(path, {method = 'GET', body, headers = {}, auth = true} = {}) {
    const h = {Accept: 'application/json', ...headers};
    if (auth) h.Authorization = 'Bearer ' + await accessToken();
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(settings.apiBase + path, {method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000)});
    } catch (e) { throw new PayPalError('paypal_unreachable', 502, {cause: e.message}); }
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {raw: text.slice(0, 200)}; }
    if (!res.ok) throw new PayPalError('paypal_error', res.status, {name: json.name, issue: json.details?.[0]?.issue, debugId: json.debug_id});
    return json;
  }

  async function accessToken() {
    if (token && Date.now() < tokenUntil) return token;
    const basic = Buffer.from(settings.clientId + ':' + settings.clientSecret).toString('base64');
    const json = await call('/v1/oauth2/token', {method: 'POST', auth: false, body: 'grant_type=client_credentials',
      headers: {Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded'}});
    if (!json.access_token) throw new PayPalError('paypal_auth_failed');
    token = json.access_token;
    tokenUntil = Date.now() + Math.max(60, (json.expires_in || 300) - 120) * 1000;
    return token;
  }

  // referenceId = id de nuestra orden: viaja como custom_id/invoice_id y vuelve en capturas,
  // reembolsos y webhooks. Devuelve {id, approveUrl}.
  async function createOrder({referenceId, amountMinor, currency, description, returnUrl, cancelUrl}) {
    const json = await call('/v2/checkout/orders', {method: 'POST', headers: {'PayPal-Request-Id': 'create-' + referenceId}, body: {
      intent: 'CAPTURE',
      purchase_units: [{reference_id: referenceId, custom_id: referenceId, invoice_id: referenceId, description: String(description).slice(0, 127),
        amount: {currency_code: currency, value: formatMinor(amountMinor)}}],
      payment_source: {paypal: {experience_context: {brand_name: settings.brandName, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: returnUrl, cancel_url: cancelUrl}}}
    }});
    const approveUrl = (json.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    if (!json.id || !approveUrl) throw new PayPalError('paypal_bad_order');
    return {id: json.id, approveUrl};
  }

  const getOrder = id => call('/v2/checkout/orders/' + encodeURIComponent(id));

  // Cobra la orden. Si ya estaba cobrada (p. ej. el jugador recargó la página de vuelta),
  // PayPal responde 422 ORDER_ALREADY_CAPTURED: entonces se lee la orden tal como está.
  async function captureOrder(id, referenceId) {
    try {
      return await call('/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {method: 'POST', body: {}, headers: {'PayPal-Request-Id': 'capture-' + referenceId}});
    } catch (e) {
      if (e instanceof PayPalError && e.details.issue === 'ORDER_ALREADY_CAPTURED') return getOrder(id);
      throw e;
    }
  }

  // Comprueba con PayPal que el webhook es auténtico (firma, certificado y webhook_id propio).
  async function verifyWebhook(headers, event) {
    if (!settings.webhookId) return false;
    const need = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
    if (need.some(k => !headers[k])) return false;
    const json = await call('/v1/notifications/verify-webhook-signature', {method: 'POST', body: {
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'],
      webhook_id: settings.webhookId, webhook_event: event
    }});
    return json.verification_status === 'SUCCESS';
  }

  return {enabled, mode: settings.mode, webhookEnabled: enabled && !!settings.webhookId, createOrder, getOrder, captureOrder, verifyWebhook};
}
