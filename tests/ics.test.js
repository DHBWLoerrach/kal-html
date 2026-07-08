import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICS } from "../public/ics.js";
import { wallDate } from "./helpers.js";

const wrap = (vevent) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${vevent}\r\nEND:VCALENDAR\r\n`;

test("parst ein einfaches VEVENT mit UTC-Zeiten", () => {
  const [ev] = parseICS(wrap(
    "BEGIN:VEVENT\r\n" +
    "SUMMARY:Analysis Herr Suderland\r\n" +
    "DTSTART:20260513T070000Z\r\n" +
    "DTEND:20260513T101500Z\r\n" +
    "LOCATION:A336\r\n" +
    "END:VEVENT"
  ));
  assert.equal(ev.title, "Analysis Herr Suderland");
  // 07:00Z = 09:00 Berliner Wandzeit (CEST)
  assert.equal(ev.start.getTime(), wallDate(2026, 4, 13, 9).getTime());
  assert.equal(ev.end.getTime(), wallDate(2026, 4, 13, 12, 15).getTime());
  assert.equal(ev.location, "A336");
  assert.equal(ev.allDay, false);
});

test("entfaltet RFC-5545-gefaltete Zeilen", () => {
  const [ev] = parseICS(wrap(
    "BEGIN:VEVENT\r\n" +
    "SUMMARY:Anwendungsprojekt Informa\r\n tik\r\n" +
    "DTSTART:20260511T070000Z\r\n" +
    "DTEND:20260511T101500Z\r\n" +
    "END:VEVENT"
  ));
  assert.equal(ev.title, "Anwendungsprojekt Informatik");
});

test("entescaped Sonderzeichen in Textwerten", () => {
  const [ev] = parseICS(wrap(
    "BEGIN:VEVENT\r\n" +
    "SUMMARY:Mathe\\, Teil 1\\; Übung\r\n" +
    "DTSTART:20260511T070000Z\r\n" +
    "DTEND:20260511T080000Z\r\n" +
    "DESCRIPTION:Zeile1\\nZeile2\r\n" +
    "END:VEVENT"
  ));
  assert.equal(ev.title, "Mathe, Teil 1; Übung");
  assert.equal(ev.description, "Zeile1\nZeile2");
});

test("erkennt ganztägige Termine (VALUE=DATE, inklusives DTEND wie im DHBW-Feed)", () => {
  const [ev] = parseICS(wrap(
    "BEGIN:VEVENT\r\n" +
    "SUMMARY:Fronleichnam\r\n" +
    "DTSTART;VALUE=DATE:20260604\r\n" +
    "DTEND;VALUE=DATE:20260604\r\n" +
    "END:VEVENT"
  ));
  assert.equal(ev.allDay, true);
  assert.equal(ev.start.getTime(), wallDate(2026, 5, 4).getTime());
  assert.equal(ev.end.getTime(), wallDate(2026, 5, 4).getTime());
});

test("stellt UTC-Zeiten als Europe/Berlin-Wandzeit dar, unabhängig von der Gerätezeitzone", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // Sommerzeit: 07:00Z → 09:00 in Berlin (CEST)
    const [sommer] = parseICS(wrap(
      "BEGIN:VEVENT\r\nSUMMARY:Analysis\r\nDTSTART:20260513T070000Z\r\nDTEND:20260513T101500Z\r\nEND:VEVENT"
    ));
    assert.equal(sommer.start.getUTCHours(), 9);
    assert.equal(sommer.start.getUTCDate(), 13);
    assert.equal(sommer.end.getUTCHours(), 12);
    assert.equal(sommer.end.getUTCMinutes(), 15);
    // Winterzeit: 08:00Z → 09:00 in Berlin (CET)
    const [winter] = parseICS(wrap(
      "BEGIN:VEVENT\r\nSUMMARY:Mathe\r\nDTSTART:20260113T080000Z\r\nDTEND:20260113T093000Z\r\nEND:VEVENT"
    ));
    assert.equal(winter.start.getUTCHours(), 9);
    // Tageswechsel: 23:00Z am 13. → 00:00 am 14. in Berlin (CET)
    const [mitternacht] = parseICS(wrap(
      "BEGIN:VEVENT\r\nSUMMARY:Übergang\r\nDTSTART:20260113T230000Z\r\nDTEND:20260114T000000Z\r\nEND:VEVENT"
    ));
    assert.equal(mitternacht.start.getUTCDate(), 14);
    assert.equal(mitternacht.start.getUTCHours(), 0);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("bewahrt Berliner Wandzeiten an DST-Grenzen der Gerätezeitzone", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const [ev] = parseICS(wrap(
      "BEGIN:VEVENT\r\nSUMMARY:DST-Lücke\r\nDTSTART:20260308T013000Z\r\nDTEND:20260308T023000Z\r\nEND:VEVENT"
    ));
    assert.equal(ev.start.getUTCHours(), 2);
    assert.equal(ev.end.getUTCHours(), 3);
    assert.equal(ev.end - ev.start, 60 * 60 * 1000);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("sortiert Events chronologisch und ignoriert unvollständige", () => {
  const events = parseICS(wrap(
    "BEGIN:VEVENT\r\nSUMMARY:Spät\r\nDTSTART:20260512T100000Z\r\nDTEND:20260512T110000Z\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Kaputt ohne Zeiten\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nSUMMARY:Früh\r\nDTSTART:20260511T070000Z\r\nDTEND:20260511T080000Z\r\nEND:VEVENT"
  ));
  assert.deepEqual(events.map((e) => e.title), ["Früh", "Spät"]);
});
