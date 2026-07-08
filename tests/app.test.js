import { test } from "node:test";
import assert from "node:assert/strict";
import {
  courseMeta,
  groupCourses,
  normalizeCourse,
  q,
  renderCourseStart,
  scrollToTopForListView,
  qs,
  urlForState,
} from "../public/app.js";

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
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.className = "";
    this.classList = new FakeClassList(this);
    this._textContent = "";
    this.listeners = {};
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  click() {
    for (const listener of this.listeners.click || []) listener();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (selector.startsWith(".") && node.classList.contains(selector.slice(1))) matches.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
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

test("courseMeta benennt die kuratierten Studiengänge und fällt robust zurück", () => {
  assert.equal(courseMeta("TIF25A"), "Technik · Informatik · Jahrgang 2025 · Kurs A");
  assert.equal(courseMeta("WWI25A-AM"), "Wirtschaft · Wirtschaftsinformatik · Jahrgang 2025 · Kurs A · AM");
  assert.equal(courseMeta("WDS25A"), "Wirtschaft · Data Science und Künstliche Intelligenz · Jahrgang 2025 · Kurs A");
  assert.equal(courseMeta("WIN25A"), "Wirtschaft · WIN · Jahrgang 2025 · Kurs A");
});

test("groupCourses gruppiert nur die kuratierten Studiengänge für Auswahl und Startseite", () => {
  const groups = groupCourses(["WDS25A", "WIN25A", "TIF25A", "WWI25A-AM"]);

  assert.deepEqual(groups.map((group) => group.label), [
    "Informatik (TIF)",
    "Wirtschaftsinformatik (WWI)",
    "Data Science und Künstliche Intelligenz (WDS)",
  ]);
  assert.deepEqual(groups.map((group) => group.courses), [["TIF25A"], ["WWI25A-AM"], ["WDS25A"]]);
});

test("qs meldet fehlende DOM-Elemente mit Selektor", () => {
  const root = { querySelector: () => null };

  assert.equal(q("#kursTitle", root), null);
  assert.throws(
    () => qs("#kursTitle", root),
    /Element nicht gefunden: #kursTitle/,
  );
});

test("normalizeCourse akzeptiert fehlende und nicht-string Eingaben robust", () => {
  assert.equal(normalizeCourse(" tif25a "), "TIF25A");
  assert.equal(normalizeCourse(null), "");
  assert.equal(normalizeCourse(123), "123");
});

test("groupCourses nutzt die zentrale Kursnormalisierung", () => {
  const groups = groupCourses([" tif25a ", "TIF25A", null, "wwi25a-am"]);

  assert.deepEqual(groups.map((group) => group.courses), [["TIF25A"], ["WWI25A-AM"]]);
});

test("urlForState erhält fremde Query-Parameter, wenn kein Kurs gewählt ist", () => {
  assert.equal(
    urlForState("/plan", "?utm=test&kurs=TIF25A&ansicht=monat&datum=2026-07-06", {
      kurs: "",
      ansicht: "woche",
      datum: new Date(Date.UTC(2026, 6, 7)),
    }, new Date(Date.UTC(2026, 6, 7))),
    "/plan?utm=test",
  );
});

test("urlForState schreibt Kursparameter und behält fremde Query-Parameter", () => {
  assert.equal(
    urlForState("/plan", "?utm=test", {
      kurs: "TIF25A",
      ansicht: "monat",
      datum: new Date(Date.UTC(2026, 6, 6)),
    }, new Date(Date.UTC(2026, 6, 7))),
    "/plan?utm=test&kurs=TIF25A&ansicht=monat&datum=2026-07-06",
  );
});

test("renderCourseStart zeigt anklickbare Kurs-Kacheln je kuratiertem Kurs", () => withFakeDocument(() => {
  const selected = [];
  const root = renderCourseStart(["TIF25A", "WWI25A-AM", "WDS25A"], (kurs) => selected.push(kurs));
  const cards = root.querySelectorAll(".course-card");

  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((card) => card.textContent), [
    "TIF25A",
    "WWI25A-AM",
    "WDS25A",
  ]);
  assert.equal(root.querySelectorAll(".course-card-program").length, 0);

  cards[1].click();
  assert.deepEqual(selected, ["WWI25A-AM"]);
}));

test("scrollToTopForListView scrollt nur in der Listenansicht nach oben", () => {
  const calls = [];
  const win = { scrollTo: (...args) => calls.push(args) };

  scrollToTopForListView("woche", win);
  scrollToTopForListView("monat", win);
  assert.deepEqual(calls, []);

  scrollToTopForListView("liste", win);
  assert.deepEqual(calls, [[{ top: 0, left: 0, behavior: "auto" }]]);
});
