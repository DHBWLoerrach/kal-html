import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/", import.meta.url);
const [html, css] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("style.css", root), "utf8"),
]);

test("verwendet die offiziellen DHBW-Markenfarben", () => {
  assert.match(css, /--dhbw-red:\s*#e2001a\b/i);
  assert.match(css, /--dhbw-gray:\s*#5c6971\b/i);
});

test("versteckt hidden-Elemente auch gegen komponentenspezifische display-Regeln", () => {
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/is);
});

test("setzt die Ziffern der großen Kurskennung auf eine gemeinsame Grundlinie", () => {
  assert.match(
    css,
    /\.kurs-hero h1\s*\{[^}]*font-family:\s*['"]Times New Roman['"], Times, serif;[^}]*font-variant-numeric:\s*lining-nums\b/is,
  );
});

test("enthält die vereinbarten kompakten Hero-CSS-Regeln", () => {
  assert.match(
    css,
    /\.kurs-hero\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*baseline;[^}]*gap:\s*clamp\(16px,\s*3vw,\s*36px\);[^}]*flex-wrap:\s*wrap;[^}]*padding:\s*12px 36px;/is,
  );
  assert.match(
    css,
    /\.kurs-hero h1\s*\{[^}]*font-size:\s*clamp\(42px,\s*6vw,\s*68px\);/is,
  );
  assert.match(css, /\.kurs-hero p\s*\{[^}]*margin:\s*0;/is);
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.kurs-hero\s*\{\s*gap:\s*8px 16px;\s*padding:\s*10px 16px;\s*\}/i,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.kurs-hero h1\s*\{\s*font-size:\s*clamp\(38px,\s*14vw,\s*56px\);\s*\}/i,
  );
});

test("zentriert Kurskacheln mit reduziertem vertikalen Padding", () => {
  assert.match(
    css,
    /\.course-card\s*\{[^}]*place-items:\s*center;[^}]*min-height:\s*88px;[^}]*padding:\s*12px 18px;[^}]*text-align:\s*center;/is,
  );
  assert.match(css, /\.course-start\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/is);
  assert.match(css, /\.course-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\);/is);
  assert.match(css, /\.course-card-code\s*\{[^}]*white-space:\s*nowrap;/is);
});
