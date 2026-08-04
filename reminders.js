// Påminnelse-prenumerationer: besökare som vill ha en push kvällen före
// tömning. Varje adress får ett slumpat topic (hamtning-<id>) på ntfy –
// namnet avslöjar ingenting om adressen, och adressen skickas aldrig i
// notisen. Lagras i en liten JSON-fil; ingen databas behövs.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { reminderFor } = require("./logic.js");
const { fetchSchedule } = require("./adapters.js");

const MAX_SUBSCRIPTIONS = 200;
const MAX_BUILDING_LEN = 200;
const SCHEDULE_TIMEOUT_MS = 15000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
// Kvällen före: skicka tidigast 17 och senast 23, svensk tid.
const SEND_HOUR_FROM = 17;
const APP_URL = "https://hamta.neomeda.eu/";

function stockholmNow() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return { todayStr: `${get("year")}-${get("month")}-${get("day")}`, hour: parseInt(get("hour"), 10) };
}

function createReminderService({ dataFile, providers, notify, alarm, fetchImpl = fetch, log = console }) {
  let subs = [];
  try {
    subs = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") log.error("Kunde inte läsa " + dataFile + ":", String(err));
  }

  // Atomiskt: skriv till tempfil och byt namn, så att en krasch mitt i aldrig
  // lämnar en halvskriven fil efter sig.
  function persist() {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = dataFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(subs, null, 2));
    fs.renameSync(tmp, dataFile);
  }

  // Returnerar topicnamnet, eller null om anmälan inte kan tas emot. Samma
  // adress ger samma topic, så ett hushåll delar prenumeration.
  function subscribe(provider, building) {
    if (!Object.hasOwn(providers, provider)) return null;
    if (typeof building !== "string" || !building.trim() || building.length > MAX_BUILDING_LEN) return null;
    const existing = subs.find(s => s.provider === provider && s.building === building);
    if (existing) return existing.topic;
    if (subs.length >= MAX_SUBSCRIPTIONS) return null;
    const topic = "hamtning-" + crypto.randomBytes(8).toString("hex");
    subs.push({ topic, provider, building, created: new Date().toISOString().slice(0, 10), lastSent: null });
    persist();
    return topic;
  }

  // Går igenom alla prenumerationer och skickar påminnelser för det som töms
  // imorgon. Ett fel för en adress får inte stoppa de övriga.
  async function checkNow({ todayStr } = {}) {
    const today = todayStr || stockholmNow().todayStr;
    let changed = false;
    for (const sub of subs) {
      if (sub.lastSent === today) continue;
      try {
        // Adaptern vet hur just den här kommunens tjänst anropas och ger
        // tillbaka schemat i appens form, oavsett leverantör.
        const data = await fetchSchedule(providers[sub.provider], sub.building, {
          fetchImpl, timeoutMs: SCHEDULE_TIMEOUT_MS
        });
        const reminder = reminderFor(data && (data.RhServices || data.rhServices), today);
        if (!reminder) continue;
        await notify({ topic: sub.topic, title: reminder.title, body: reminder.body, tags: ["wastebasket"], click: APP_URL });
        sub.lastSent = today;
        changed = true;
      } catch (err) {
        log.error(`Påminnelse ${sub.topic}:`, String(err.cause || err));
        // 4xx är bara ett svar (t.ex. borttagen adress); 5xx och nätverksfel
        // är driftfel hos kommunen och värda ett larm.
        if (alarm && !(err.status >= 400 && err.status < 500)) {
          alarm(sub.provider, `${String(err.cause || err)} vid schemahämtning.`);
        }
      }
    }
    if (changed) persist();
  }

  // Testnotisen låter besökaren verifiera sin prenumeration direkt. Bara
  // registrerade topics går att skicka till – annars vore endpointen ett
  // sätt att spamma godtyckliga hamtning-topics.
  async function sendTest(topic) {
    if (!subs.some(s => s.topic === topic)) return false;
    await notify({
      topic,
      title: "Testnotis – påminnelserna fungerar",
      body: "Så här ser en påminnelse ut. Nästa riktiga notis kommer kvällen före tömning.",
      tags: ["wastebasket"],
      click: APP_URL
    });
    return true;
  }

  // Kollar varje halvtimme och agerar bara på kvällen – dedupliceringen via
  // lastSent gör att en omstart mitt i kvällen inte ger dubbletter.
  function start() {
    const tick = () => {
      const { hour } = stockholmNow();
      if (hour >= SEND_HOUR_FROM) checkNow().catch(err => log.error("Påminnelsekontroll:", String(err)));
    };
    tick();
    setInterval(tick, CHECK_INTERVAL_MS).unref();
  }

  return { subscribe, sendTest, checkNow, start };
}

module.exports = { createReminderService };
