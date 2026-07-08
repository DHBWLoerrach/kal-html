import { test } from "node:test";
import assert from "node:assert/strict";
import { updateTimeIndicators } from "../public/views.js";
import { wallDate } from "./helpers.js";

class FakeClassList {
  constructor(...names) {
    this.names = new Set(names);
  }

  contains(name) {
    return this.names.has(name);
  }

  add(name) {
    this.names.add(name);
  }

  toggle(name, force) {
    if (force) this.names.add(name);
    else this.names.delete(name);
  }
}

class FakeNode {
  constructor(className = "") {
    this.classList = new FakeClassList(...className.split(" ").filter(Boolean));
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.ownerDocument = {
      createElement: () => new FakeNode(),
    };
  }

  appendChild(child) {
    child.remove();
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
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

function weekDay(date, { startMinute = 8 * 60, totalMinutes = 10 * 60 } = {}) {
  const day = new FakeNode("week-day");
  day.dataset.date = date;
  const body = new FakeNode("day-body");
  body.dataset.startMinute = String(startMinute);
  body.dataset.totalMinutes = String(totalMinutes);
  day.appendChild(body);
  return { day, body };
}

test("aktualisiert Heute-Markierung und verschiebt die Jetzt-Linie in-place", () => {
  const root = new FakeNode();
  const yesterday = weekDay("2026-06-10");
  const today = weekDay("2026-06-11");
  yesterday.day.classList.toggle("is-today", true);
  const line = new FakeNode("now-line");
  yesterday.body.appendChild(line);
  root.appendChild(yesterday.day);
  root.appendChild(today.day);

  updateTimeIndicators(root, wallDate(2026, 5, 11, 9, 30));

  assert.equal(yesterday.day.classList.contains("is-today"), false);
  assert.equal(today.day.classList.contains("is-today"), true);
  assert.equal(today.body.querySelector(".now-line"), line);
  assert.ok(Math.abs(Number.parseFloat(line.style.top) - 99) < 1e-9);

  updateTimeIndicators(root, wallDate(2026, 5, 11, 19));
  assert.equal(root.querySelector(".now-line"), null);
});

test("erzeugt eine Jetzt-Linie, wenn der heutige Tag im Zeitraster liegt", () => {
  const root = new FakeNode();
  const today = weekDay("2026-06-11");
  root.appendChild(today.day);

  updateTimeIndicators(root, wallDate(2026, 5, 11, 8, 15));

  const line = today.body.querySelector(".now-line");
  assert.ok(line);
  assert.equal(line.classList.contains("now-line"), true);
  assert.equal(line.style.top, "16.5px");
});
