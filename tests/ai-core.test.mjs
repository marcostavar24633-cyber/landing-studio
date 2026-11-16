// Серверное ядро AI-генерации: вход автопилота, CORS, схема ответа и адаптер Vercel (без обращения к OpenAI).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../server/generate-landing-core.js");
const vercel = require("../api/generate-landing.js");

test("вход: строка старого редактора и объект автопилота", () => {
  assert.deepEqual(core.readInput("кофейня"), { niche: "кофейня", tier: "standard", city: "", brand: "", details: "", customPrompt: "", customPromptMode: "append" });
  const i = core.readInput({ niche: "ювелир", tier: "luxury", city: "Москва", brand: "Аурум", details: "x".repeat(2000) });
  assert.equal(i.tier, "luxury");
  assert.equal(i.details.length, 800);
  assert.equal(core.readInput({ niche: "x", tier: "мега" }).tier, "standard");
  const text = core.buildInput(i);
  assert.match(text, /Город: Москва/);
  assert.match(text, /Класс: люкс/);
  assert.match(text, /Никаких скидок/);
});

test("без ниши и без ключа — понятные ошибки, без запроса к OpenAI", async () => {
  assert.equal((await core({ niche: "" }, {})).status, 400);
  const r = await core({ niche: "кофейня" }, {});
  assert.equal(r.status, 503);
  assert.match(r.body.error, /OPENAI_API_KEY/);
});

test("CORS: только разрешённые адреса", () => {
  assert.equal(core.corsHeaders("https://marcostavar24633-cyber.github.io", {})["Access-Control-Allow-Origin"], "https://marcostavar24633-cyber.github.io");
  assert.deepEqual(core.corsHeaders("https://evil.example", {}), {});
  assert.deepEqual(core.corsHeaders(undefined, {}), {});
  assert.equal(core.corsHeaders("https://my.site", { ALLOWED_ORIGINS: "https://my.site" })["Access-Control-Allow-Origin"], "https://my.site");
});

test("адаптер Vercel отвечает на preflight и передаёт вводные автопилота", async () => {
  const res = () => ({ h: {}, s: 0, b: null, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(b) { this.b = b; return this; }, end() { return this; } });
  const pre = res();
  await vercel({ method: "OPTIONS", headers: { origin: "http://localhost:5180" } }, pre);
  assert.equal(pre.s, 204);
  assert.equal(pre.h["Access-Control-Allow-Origin"], "http://localhost:5180");
  const post = res();
  await vercel({ method: "POST", headers: {}, body: { niche: "кофейня", tier: "premium" } }, post);
  assert.equal(post.s, 503, "без ключа — 503, но запрос разобран");
});

test("инструкции требуют исследования, человеческого языка и честности", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../server/generate-landing-core.js", import.meta.url), "utf8");
  for (const s of ["веб-поиск", "человеческим языком", "Без канцелярита", "Не создавай отзывы", "segments", "objections", "keywords", "imagePrompts", "seoTitle"]) assert.ok(src.includes(s), s);
});

test("свой промт заказчика уходит в генерацию: дополняет или заменяет правила, честность остаётся", () => {
  const mine = "Пиши для аудитории 35+, упор на ручную работу.";
  const add = core.buildInput(core.readInput({ niche: "ювелир", tier: "luxury", customPrompt: mine }));
  assert.match(add, /УКАЗАНИЯ ЗАКАЗЧИКА/);
  assert.match(add, /Класс: люкс/, "в режиме «дополнить» правила класса остаются");
  assert.ok(add.trimEnd().endsWith(mine));
  const rep = core.buildInput(core.readInput({ niche: "ювелир", tier: "luxury", customPrompt: mine, customPromptMode: "replace" }));
  assert.match(rep, /ПРОМТ ЗАКАЗЧИКА — главная инструкция/);
  assert.doesNotMatch(rep, /Класс: люкс/, "в режиме «заменить» правила класса уступают промту");
  assert.match(rep, /не выдумывай отзывы/);
  assert.equal(core.readInput({ niche: "x", customPrompt: "я".repeat(9000) }).customPrompt.length, 8000);
  assert.doesNotMatch(core.buildInput(core.readInput({ niche: "кофейня" })), /ЗАКАЗЧИКА/);
});
