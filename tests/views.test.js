import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startOfDay,
  startOfWeek,
  addDays,
  eventsOnDay,
  listGroups,
  parseISODate,
  renderWeek,
  renderMonth,
  renderList,
} from "../public/views.js";
import { wallDate } from "./helpers.js";

class FakeClassList {
  constructor(node) {
    this.node = node;
  }

  contains(name) {
    return this.node.className.split(/\s+/).includes(name);
  }

  add(name) {
    if (!this.contains(name)) this.node.className = `${this.node.className} ${name}`.trim();
  }

  toggle(name, force) {
    if (force) this.add(name);
    else this.node.className = this.node.className
      .split(/\s+/)
      .filter((part) => part && part !== name)
      .join(" ");
  }
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.className = "";
    this.classList = new FakeClassList(this);
    this._textContent = "";
    this.listeners = {};
    this.attributes = {};
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  appendChild(child) {
    child.remove();
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    child.remove();
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    const index = before ? this.children.indexOf(before) : -1;
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  click() {
    for (const listener of this.listeners.click || []) listener();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (selector === "[data-date]" && node.dataset.date) matches.push(node);
      if (selector.startsWith(".") && node.classList.contains(selector.slice(1))) matches.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }
}

function withFakeDocument(callback) {
  const previous = globalThis.document;
  const fakeDocument = {
    createElement(tagName) {
      return new FakeNode(tagName, fakeDocument);
    },
  };
  globalThis.document = fakeDocument;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test("startOfWeek liefert Montag, auch von Sonntag aus", () => {
  // Mi, 10.06.2026 → Mo, 08.06.
  assert.equal(startOfWeek(wallDate(2026, 5, 10, 15, 30)).getTime(), wallDate(2026, 5, 8).getTime());
  // So, 14.06.2026 gehört noch zur Woche ab Mo, 08.06.
  assert.equal(startOfWeek(wallDate(2026, 5, 14)).getTime(), wallDate(2026, 5, 8).getTime());
});

test("addDays über Monatsgrenzen", () => {
  assert.equal(addDays(wallDate(2026, 5, 29), 7).getTime(), wallDate(2026, 6, 6).getTime());
});

test("startOfDay verwirft die Uhrzeit", () => {
  assert.equal(startOfDay(wallDate(2026, 5, 10, 23, 59)).getTime(), wallDate(2026, 5, 10).getTime());
});

test("parseISODate akzeptiert nur existierende Kalendertage", () => {
  assert.equal(parseISODate("2026-02-28")?.getTime(), wallDate(2026, 1, 28).getTime());
  assert.equal(parseISODate("2024-02-29")?.getTime(), wallDate(2024, 1, 29).getTime());
  for (const invalid of ["", "2026-2-01", "2026-02-29", "2026-02-31", "2026-00-10", "2026-13-01"]) {
    assert.equal(parseISODate(invalid), null);
  }
});

test("mehrtägiger Ganztagstermin erscheint an jedem Tag (DTEND ist im DHBW-Feed inklusiv)", () => {
  // Wie „Klausurwoche" im TEL25A-Feed: Mo 06.07.–Fr 10.07.2026
  const klausurwoche = { title: "Klausurwoche", allDay: true, start: wallDate(2026, 6, 6), end: wallDate(2026, 6, 10) };
  const vorlesung = { title: "Vorlesung", allDay: false, start: wallDate(2026, 6, 6, 9), end: wallDate(2026, 6, 6, 12) };
  const events = [klausurwoche, vorlesung];

  assert.deepEqual(eventsOnDay(events, wallDate(2026, 6, 6)).map((e) => e.title), ["Klausurwoche", "Vorlesung"]);
  assert.deepEqual(eventsOnDay(events, wallDate(2026, 6, 8)).map((e) => e.title), ["Klausurwoche"]);
  assert.deepEqual(eventsOnDay(events, wallDate(2026, 6, 10)).map((e) => e.title), ["Klausurwoche"]);
  assert.deepEqual(eventsOnDay(events, wallDate(2026, 6, 11)), []);
  assert.deepEqual(eventsOnDay(events, wallDate(2026, 6, 5)), []);
});

test("listGroups gruppiert Termine chronologisch nach Tag", () => {
  const mo1 = { title: "Mo früh", allDay: false, start: wallDate(2026, 6, 6, 9), end: wallDate(2026, 6, 6, 12) };
  const mo2 = { title: "Mo spät", allDay: false, start: wallDate(2026, 6, 6, 13), end: wallDate(2026, 6, 6, 16) };
  const di = { title: "Di", allDay: false, start: wallDate(2026, 6, 7, 9), end: wallDate(2026, 6, 7, 12) };
  const groups = listGroups([mo1, mo2, di], wallDate(2026, 6, 6));

  assert.deepEqual(groups.map((g) => g.day.getTime()), [wallDate(2026, 6, 6).getTime(), wallDate(2026, 6, 7).getTime()]);
  assert.deepEqual(groups[0].events.map((e) => e.title), ["Mo früh", "Mo spät"]);
  assert.deepEqual(groups[1].events.map((e) => e.title), ["Di"]);
});

test("listGroups sortiert laufende Mehrtagestermine unter den Anker-Tag ein", () => {
  // Klausurwoche Mo 06.07.–Fr 10.07.; Liste ab Mi 08.07. darf nicht mit „Montag" beginnen
  const klausurwoche = { title: "Klausurwoche", allDay: true, start: wallDate(2026, 6, 6), end: wallDate(2026, 6, 10) };
  const vorlesung = { title: "Vorlesung", allDay: false, start: wallDate(2026, 6, 8, 9), end: wallDate(2026, 6, 8, 12) };
  const groups = listGroups([klausurwoche, vorlesung], wallDate(2026, 6, 8));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].day.getTime(), wallDate(2026, 6, 8).getTime());
  assert.deepEqual(groups[0].events.map((e) => e.title), ["Klausurwoche", "Vorlesung"]);
});

test("eintägige Termine erscheinen nur am Starttag", () => {
  const tag = { title: "Fronleichnam", allDay: true, start: wallDate(2026, 5, 4), end: wallDate(2026, 5, 4) };
  assert.equal(eventsOnDay([tag], wallDate(2026, 5, 4)).length, 1);
  assert.equal(eventsOnDay([tag], wallDate(2026, 5, 5)).length, 0);
});

test("renderWeek zeigt Terminbeschreibungen in Terminblöcken", () => withFakeDocument(() => {
  const ev = {
    title: "Analysis",
    description: "Bitte Laptop mitbringen.",
    location: "A336",
    allDay: false,
    start: wallDate(2026, 6, 6, 9),
    end: wallDate(2026, 6, 6, 12),
  };

  const root = renderWeek([ev], wallDate(2026, 6, 6), wallDate(2026, 6, 1), () => {});

  const description = root.querySelector(".ev-description");
  assert.ok(description);
  assert.equal(description.textContent, "Bitte Laptop mitbringen.");
}));

test("renderWeek kennzeichnet Tagesköpfe als Wechsel zur Listenansicht", () => withFakeDocument(() => {
  const root = renderWeek([], wallDate(2026, 6, 6), wallDate(2026, 6, 1), () => {});
  const dayHead = root.querySelectorAll(".day-head")
    .find((node) => !node.classList.contains("day-head--spacer"));

  assert.equal(dayHead.attributes["aria-label"], "Mo., 06.07.: Listenansicht öffnen");
}));

test("renderMonth zeigt Termindetails nach Klick auf einen Termin-Chip", () => withFakeDocument(() => {
  const ev = {
    title: "Analysis",
    description: "Bitte Laptop mitbringen.",
    location: "A336",
    allDay: false,
    start: wallDate(2026, 6, 6, 9),
    end: wallDate(2026, 6, 6, 12),
  };

  const root = renderMonth([ev], wallDate(2026, 6, 1), wallDate(2026, 6, 1), () => {});
  assert.equal(root.querySelector(".month-daynum").attributes["aria-label"], "Woche für 29.06. öffnen");
  assert.equal(root.querySelector(".month-chip").attributes["aria-label"], "Details zu Analysis anzeigen");
  root.querySelector(".month-chip").click();

  const detail = root.querySelector(".month-detail");
  assert.ok(detail);
  assert.equal(detail.style.gridColumn, "1 / -1");
  assert.equal(detail.style["--detail-start"], "1");
  assert.equal(detail.style["--detail-span"], "3");
  assert.equal(detail.querySelector(".ev-description").textContent, "Bitte Laptop mitbringen.");
  assert.equal(detail.querySelector(".ev-location").textContent, "A336");
}));

test("renderMonth zeigt einen Wochen-Cue pro Kalenderzeile statt pro Tageszahl", () => withFakeDocument(() => {
  const root = renderMonth([], wallDate(2026, 6, 1), wallDate(2026, 6, 1), () => {});

  assert.equal(root.querySelectorAll(".month-week-cue").length, 5);
  assert.equal(root.querySelector(".month-week-cue").attributes["aria-hidden"], "true");
  assert.equal(root.querySelector(".month-cell").dataset.week, "0");
  assert.ok(root.querySelector(".month-cell").classList.contains("month-cell--week-start"));
}));

test("renderMonth richtet Termindetails am rechten Rand innerhalb des Monatsrasters aus", () => withFakeDocument(() => {
  const ev = {
    title: "Sonntagstermin",
    description: "Randfall",
    location: "A336",
    allDay: false,
    start: wallDate(2026, 6, 12, 9),
    end: wallDate(2026, 6, 12, 10),
  };

  const root = renderMonth([ev], wallDate(2026, 6, 1), wallDate(2026, 6, 1), () => {});
  root.querySelector(".month-chip").click();

  const detail = root.querySelector(".month-detail");
  assert.equal(detail.style.gridColumn, "1 / -1");
  assert.equal(detail.style["--detail-start"], "5");
  assert.equal(detail.style["--detail-span"], "3");
}));

test("renderList zeigt Terminbeschreibungen in Listenzeilen", () => withFakeDocument(() => {
  const ev = {
    title: "Analysis",
    description: "Bitte Laptop mitbringen.",
    location: "A336",
    allDay: false,
    start: wallDate(2026, 6, 6, 9),
    end: wallDate(2026, 6, 6, 12),
  };

  const root = renderList([ev], wallDate(2026, 6, 6));

  const description = root.querySelector(".ev-description");
  assert.ok(description);
  assert.equal(description.textContent, "Bitte Laptop mitbringen.");
}));

test("renderList navigiert per Tageskopf und Terminzeile zur Woche des Listentags", () => withFakeDocument(() => {
  const ev = {
    title: "Analysis",
    description: "",
    location: "",
    allDay: false,
    start: wallDate(2026, 6, 6, 9),
    end: wallDate(2026, 6, 6, 12),
  };
  let clicked = null;

  const root = renderList([ev], wallDate(2026, 6, 6), (day) => {
    clicked = day;
  });

  root.querySelector(".list-dayhead-button").click();
  assert.equal(clicked.getTime(), wallDate(2026, 6, 6).getTime());

  clicked = null;
  root.querySelector(".list-row-action").click();
  assert.equal(clicked.getTime(), wallDate(2026, 6, 6).getTime());
}));

test("renderList verschachtelt keine Button-Rolle um Online-Raum-Links", () => withFakeDocument(() => {
  const ev = {
    title: "Online",
    description: "",
    location: "https://example.test/room",
    allDay: false,
    start: wallDate(2026, 6, 6, 9),
    end: wallDate(2026, 6, 6, 12),
  };

  const root = renderList([ev], wallDate(2026, 6, 6), () => {});
  const row = root.querySelector(".list-row");

  assert.equal(row.attributes.role, undefined);
  assert.equal(row.tabIndex, undefined);
  assert.ok(root.querySelector(".ev-location--online"));
  assert.ok(root.querySelector(".list-row-action"));
}));
