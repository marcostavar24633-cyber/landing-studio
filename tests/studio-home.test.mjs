// Стартовый экран конструктора.
// Запуск: node --test tests/studio-home.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/landing-studio-app.html", import.meta.url), "utf8");

test("приложение открывается на стартовом экране конструктора", () => {
  for (const id of ["studioHome", "shForm", "shNiche", "shTier", "shProjects", "homeToggle"]) assert.match(src, new RegExp(`id="${id}"`), id);
  assert.match(src, /refreshProjectSelect\(\);homeOpen\(\);/, "экран показывается при запуске");
  assert.match(src, /UDS\.autopilot\(\{niche,tier\},\{registry:udsRegistry\(null\)\}\)/, "сайт по нише собирается в браузере, без AI-сервера");
});

test("стартовый экран не попадает в скачанный сайт и в печать", () => {
  assert.match(src, /clone\.querySelector\("#studioHome"\)\?\.remove\(\);clone\.querySelector\("#homeToggle"\)\?\.remove\(\)/);
  assert.match(src, /@media print\{#studioHome,#homeToggle\{display:none!important\}\}/);
});

test("названия проектов на стартовом экране экранируются", () => {
  const card = src.match(/function renderHome\(\)\{[\s\S]*?\n    \}/)[0];
  assert.match(card, /esc\(p\.name\|\|"Без названия"\)/);
  assert.match(card, /esc\(String\(d\.niche/);
  assert.doesNotMatch(card, /\$\{p\.name/, "имя проекта не вставляется в HTML без экранирования");
});
