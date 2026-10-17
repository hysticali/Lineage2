const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function accessConfig(options = {}) {
  const mode = options.mode || 'local';
  if (!['local', 'private'].includes(mode)) throw new Error('AUTH_MODE must be local or private');
  const host = options.host || '127.0.0.1';
  if (mode === 'local' && !LOOPBACK.has(host)) throw new Error('Local mode can bind only to loopback. Configure private mode before using another host.');
  let origin = null;
  const secureCookies = options.secureCookies !== false;
  if (mode === 'private') {
    let url;
    try { url = new URL(options.origin); } catch { throw new Error('Private mode requires PUBLIC_ORIGIN'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN must be a plain HTTP(S) origin');
    if (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) throw new Error('Private hosting requires an HTTPS public origin');
    if (!secureCookies && !LOOPBACK.has(url.hostname)) throw new Error('Insecure session cookies are allowed only for loopback development');
    origin = url.origin;
  }
  if (options.setupToken && (typeof options.setupToken !== 'string' || options.setupToken.length < 32)) throw new Error('SETUP_TOKEN must contain at least 32 characters');
  return { mode, host, origin, secureCookies, setupToken: options.setupToken || null, trustProxy: options.trustProxy === true };
}
function serverConfig(env = process.env) {
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  return { port, ...accessConfig({ mode: env.AUTH_MODE || 'local', host: env.HOST || '127.0.0.1', origin: env.PUBLIC_ORIGIN, secureCookies: env.SESSION_COOKIE_SECURE !== 'false', setupToken: env.SETUP_TOKEN, trustProxy: env.TRUST_PROXY === 'loopback' }) };
}
module.exports = { LOOPBACK, accessConfig, serverConfig };
