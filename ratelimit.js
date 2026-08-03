// Per-IP-spärr med fast fönster, utan beroenden. Skyddet riktar sig mot
// naiva curl-loopar och skript som hamrar proxyn – distribuerade angrepp
// stoppas i stället av Cloudflare framför sajten.
function createRateLimiter({ limit, windowMs = 60000, now = Date.now, maxEntries = 10000 } = {}) {
  const windows = new Map();

  function allow(ip) {
    const t = now();
    // Rensa utlöpta fönster när listan blivit stor, så att minnet är
    // begränsat även om någon roterar avsändaradresser.
    if (windows.size >= maxEntries) {
      for (const [key, w] of windows) {
        if (t - w.start >= windowMs) windows.delete(key);
      }
    }
    const w = windows.get(ip);
    if (!w || t - w.start >= windowMs) {
      windows.set(ip, { start: t, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= limit;
  }

  allow.size = () => windows.size;
  return allow;
}

// Klientens IP bakom Cloudflare + DSM-nginx. Headrarna är pålitliga just för
// att containern bara nås via den kedjan; CF-Connecting-IP är alltid den
// riktiga klienten, nginx-appendade X-Forwarded-For är näst bäst.
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return cf;
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress;
}

module.exports = { createRateLimiter, clientIp };
