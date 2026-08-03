// Per-IP-spärr med fast fönster, utan beroenden. Skyddet riktar sig mot
// naiva curl-loopar och skript som hamrar proxyn – distribuerade angrepp
// stoppas i stället av Cloudflare framför sajten.
function createRateLimiter({ limit, windowMs = 60000, now = Date.now, maxEntries = 10000 } = {}) {
  const windows = new Map();

  function allow(ip) {
    const t = now();
    const w = windows.get(ip);
    if (w && t - w.start < windowMs) {
      w.count++;
      return w.count <= limit;
    }
    if (windows.size >= maxEntries) {
      for (const [key, old] of windows) {
        if (t - old.start >= windowMs) windows.delete(key);
      }
      // Fortfarande fullt av färska nycklar? Då pågår nyckelrotation –
      // neka nya nycklar (fail closed) hellre än att minnet växer obegränsat.
      if (windows.size >= maxEntries) return false;
    }
    windows.set(ip, { start: t, count: 1 });
    return true;
  }

  allow.size = () => windows.size;
  return allow;
}

// Nyckeln för spärren. Endast det SISTA X-Forwarded-For-ledet är pålitligt:
// det skrivs av vår egen nginx och är nginx faktiska motpart (Cloudflare-
// edgen, eller den som går direkt mot origin-IP:t). Klientskrivna led –
// inklusive CF-Connecting-IP – kan förfalskas av den som går förbi
// Cloudflare och används därför inte. Priset är att besökare bakom samma
// Cloudflare-edge delar hink; gränserna är satta med marginal för det.
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",").pop().trim();
  return req.socket.remoteAddress;
}

module.exports = { createRateLimiter, clientIp };
