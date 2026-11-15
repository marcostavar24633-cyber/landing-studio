// Интеграция движка Unique Design Studio в Landing Studio.
// Запуск: node --test tests/uds-integration.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = rel => readFileSync(new URL(rel, root), "utf8");

function loadEngine() {
  const ctx = { console };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("vendor/uds-engine.js") + "\n;window.UDS = UDS;", ctx);
  return ctx.UDS;
}

function builtApp() {
  const files = readdirSync(new URL("app-chunks/", root)).filter(n => /^\d{2}\.txt$/.test(n)).sort();
  const html = gunzipSync(Buffer.from(files.map(n => read("app-chunks/" + n)).join(""), "base64")).toString("utf8");
  return { files, html };
}

test("бандл движка подключён и открывает API window.UDS", () => {
  const src = read("vendor/uds-engine.js");
  assert.match(src, /^\/\* Unique Design Studio engine — https:\/\/github\.com\/marcostavar24633-cyber\/unique-design-studio @ \w+/);
  const UDS = loadEngine();
  for (const fn of ["generate", "buildConcept", "registryEntry", "upsertRegistry", "renderSite", "auditSite"]) assert.equal(typeof UDS[fn], "function", fn);
  assert.equal(Object.keys(UDS.ARCHETYPES).length, 10);
});

test("проект в формате Landing Studio получает архитектуру из перечня редактора", () => {
  const UDS = loadEngine();
  const legacy = ["catalog", "editorial", "immersive", "service", "modular"];
  const niches = ["магазин телескопов", "свадебный фотограф", "кофейня", "ремонт квартир", "съедобные букеты", "юрист"];
  let registry = [];
  for (const niche of niches) {
    const project = { id: niche, brand: niche, niche, title: "Заголовок", cta: "Связаться", services: [["Услуга", "Описание"]], contacts: { email: "a@example.com" } };
    const r = UDS.generate(project, { registry });
    registry = r.registry;
    assert.ok(legacy.includes(UDS.ARCHETYPES[r.concept.designDNA.primaryArchetype].legacy), niche);
    assert.match(r.html, /^<!doctype html>/);
  }
  // Семейство, выбранное в редакторе, ограничивает выбор движка.
  const fixed = UDS.generate({ brand: "x", niche: "кофейня", designArchitecture: "catalog" });
  assert.equal(UDS.ARCHETYPES[fixed.concept.designDNA.primaryArchetype].legacy, "catalog");
});

test("соседние проекты одной ниши получают разные первые экраны", () => {
  const UDS = loadEngine();
  let registry = [];
  const heroes = [];
  for (let i = 0; i < 3; i++) {
    const r = UDS.generate({ id: "coffee-" + i, brand: "Кофейня", niche: "кофейня" }, { registry });
    registry = r.registry;
    heroes.push(r.concept.uniquenessCheck.fingerprint);
  }
  for (let i = 1; i < heroes.length; i++) {
    const [a, b] = [heroes[i - 1], heroes[i]];
    assert.ok(!(a.archetype === b.archetype && a.placement === b.placement && a.typeCharacter === b.typeCharacter), "проект " + i);
  }
});

test("собранное приложение содержит встроенный движок и ровно один </body>", () => {
  const { files, html } = builtApp();
  assert.match(html, /<script data-uds-engine>\/\* Unique Design Studio engine/);
  assert.doesNotMatch(html, /<script data-uds-engine src=/, "внешняя ссылка на движок должна быть заменена встраиванием");
  assert.equal(html.toLowerCase().split("</body>").length - 1, 1);
  const engine = html.match(/<script data-uds-engine>([\s\S]*?)<\/script>/)[1];
  assert.ok(engine.length > 50000);
  assert.doesNotThrow(() => new Function(engine));
  const loader = read("index.html");
  assert.equal(Number(loader.match(/Array\.from\(\{length:(\d+)\}/)[1]), files.length, "число чанков в загрузчике");
});

test("исходник приложения и чанки синхронизированы", () => {
  const src = read("src/landing-studio-app.html");
  const { html } = builtApp();
  const withoutEngine = html.replace(/<script data-uds-engine>[\s\S]*?<\/script>/, "");
  assert.equal(withoutEngine, src.replace(/<script data-uds-engine src="[^"]*"><\/script>/, ""), "запустите node scripts/build-app-chunks.cjs");
});

test("загрузчик вставляет AI-помощника один раз", () => {
  const loader = read("index.html");
  assert.equal((loader.match(/html=html\.replace\("<\/body>"/g) || []).length, 1);
  assert.equal((loader.match(/document\.write\(html\)/g) || []).length, 1);
  assert.match(loader, /function lsaUds\(/);
});

test("редактор использует движок, а прежние правила остаются запасным вариантом", () => {
  const src = read("src/landing-studio-app.html");
  assert.match(src, /udsLegacyArchitecture\(uds\)\|\|inferArchitecture\(data\.niche\)/);
  assert.match(src, /id="udsGroup"/);
  assert.match(src, /autoColors/, "тёмная схема и золотой акцент по умолчанию не должны считаться выбором пользователя");
});
