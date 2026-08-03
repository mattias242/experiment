// Push-notiser via den egna ntfy-instansen (notify.neomeda.eu). Varje notis
// skickas till sitt eget topic och till firehosen neomeda-all, där titeln
// prefixas med appnamnet eftersom den blandas med andra avsändare.
// Tokenet är write-only och läses ur NTFY_TOKEN – saknas det blir allt en
// tyst no-op så att lokal utveckling och tester inte rör servern.
const NTFY_BASE = "https://notify.neomeda.eu";
const FIREHOSE_TOPIC = "neomeda-all";
const APP_NAME = "Hämtschema";
const APP_SLUG = "hamtning";
const NTFY_TIMEOUT_MS = 3000;

// HTTP-headers får bara innehålla ASCII. Titlar med å/ä/ö måste därför
// RFC 2047-kodas, annars tappas eller förvanskas tecknen på vägen.
function encodeTitle(title) {
  if (/^[\x20-\x7e]*$/.test(title)) return title;
  return "=?UTF-8?B?" + Buffer.from(title, "utf8").toString("base64") + "?=";
}

// Fabrik av samma skäl som i server.js: testerna byter ut fetch och loggen.
function createNotifier({ fetchImpl = fetch, token = process.env.NTFY_TOKEN, log = console } = {}) {
  if (!token) {
    log.warn("NTFY_TOKEN saknas – push-notiser är avstängda");
    return async () => {};
  }

  async function post(topic, headers, body) {
    try {
      const res = await fetchImpl(`${NTFY_BASE}/${topic}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(NTFY_TIMEOUT_MS)
      });
      if (!res.ok) log.error(`ntfy ${topic}: HTTP ${res.status} – ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      log.error(`ntfy ${topic}:`, String(err.cause || err));
    }
  }

  // Best effort: fel loggas men kastas aldrig vidare – en notis som inte går
  // fram får inte fälla verksamhetslogiken, och felar ena topicet ska det
  // andra ändå få sitt.
  return async function notify({ topic, title, body, tags = [], priority = "default", click }) {
    const base = { "Authorization": `Bearer ${token}`, "Priority": priority };
    if (click) base["Click"] = click;
    const own = { ...base, "Title": encodeTitle(title), "Tags": tags.join(",") };
    const fire = {
      ...base,
      "Title": encodeTitle(`${APP_NAME} · ${title}`),
      "Tags": [APP_SLUG, ...tags].join(",")
    };
    await Promise.allSettled([post(topic, own, body), post(FIREHOSE_TOPIC, fire, body)]);
  };
}

function stockholmToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}

// Driftlarm när en kommun-tjänst felar: en notis till apptopicet, men högst
// en per kommun och dygn – ett API som ligger nere en hel kväll ska ge ett
// larm, inte hundra.
function createUpstreamAlarm({ notify, today = stockholmToday } = {}) {
  const alarmedDay = new Map();
  return async function report(provider, detail) {
    const day = today();
    if (alarmedDay.get(provider) === day) return;
    alarmedDay.set(provider, day);
    await notify({
      topic: APP_SLUG,
      title: `Kommun-tjänsten ${provider} felar`,
      body: `${String(detail).slice(0, 200)} Fler fel för ${provider} dämpas till imorgon.`,
      tags: ["rotating_light"]
    });
  };
}

module.exports = { encodeTitle, createNotifier, createUpstreamAlarm };
