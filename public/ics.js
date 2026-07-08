// Minimaler ICS-Parser für die DHBW-Feeds: flache VEVENTs, UTC-Zeiten, keine RRULEs.
// UTC-Zeiten werden beim Parsen in Europe/Berlin-Wandzeit umgerechnet, damit der
// Stundenplan unabhängig von der Gerätezeitzone die Hochschulzeiten zeigt.

const berlinParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

// Liefert ein Date, dessen UTC-Komponenten der Berliner Wandzeit des
// übergebenen Zeitpunkts entsprechen. UTC dient hier als neutrale
// Kalenderrepräsentation, damit die Gerätezeitzone die Werte nicht verändert.
// Bewusste Modellgrenze: Differenzen zweier solcher Werte sind Wandzeit-,
// keine Echtzeit-Dauern — für Termine über Berlins DST-Umstellung hinweg
// (nachts am letzten März-/Oktober-Sonntag) wichen sie um eine Stunde ab.
// Im Vorlesungsfeed gibt es solche Termine nicht.
export function toBerlinTime(date) {
  const p = {};
  for (const part of berlinParts.formatToParts(date)) p[part.type] = part.value;
  return new Date(Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

export function parseICS(text) {
  // RFC-5545: gefaltete Zeilen (Fortsetzung beginnt mit Leerzeichen/Tab) entfalten
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");

  const events = [];
  let props = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      props = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (props) {
        const ev = toEvent(props);
        if (ev.start && ev.end) events.push(ev);
      }
      props = null;
      continue;
    }
    if (!props) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0].toUpperCase();
    props[name] = line.slice(colon + 1);
  }

  return events.sort((a, b) => a.start - b.start);
}

function toEvent(p) {
  const start = parseDate(p.DTSTART);
  return {
    title: unescapeText(p.SUMMARY || "").trim() || "(ohne Titel)",
    start,
    end: parseDate(p.DTEND),
    location: unescapeText(p.LOCATION || "").trim(),
    description: unescapeText(p.DESCRIPTION || "").trim(),
    allDay: Boolean(p.DTSTART && !p.DTSTART.includes("T")),
    uid: p.UID || "",
  };
}

function parseDate(value) {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", utc] = m;
  return utc
    ? toBerlinTime(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)))
    : new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

function unescapeText(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
