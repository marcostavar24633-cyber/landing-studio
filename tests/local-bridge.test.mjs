// Локальный AI-мост: генерация без ключа API через Claude Code на компьютере владельца.
// Запуск: node --test tests/local-bridge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const bridge = require("../tools/local-ai-bridge.cjs");
const core = require("../server/generate-landing-core.js");

async function withServer(generateFn, run) {
  const server = bridge.createServer("fake-claude", generateFn);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise(r => server.close(r)); }
}
const ALLOWED = "https://landing-studio-five.vercel.app";

test("мост отвечает на проверку и отдаёт результат генерации разрешённому сайту", async () => {
  let received;
  await withServer(async (bin, input) => { received = input; return { status: 200, body: { landing: { title: "ok" } } }; }, async base => {
    const health = await fetch(base + "/health", { headers: { Origin: ALLOWED } });
    assert.equal((await health.json()).bridge, "landing-studio-local");
    assert.equal(health.headers.get("access-control-allow-origin"), ALLOWED);
    const res = await fetch(base + "/api/generate-landing", { method: "POST", headers: { Origin: ALLOWED, "Content-Type": "application/json" }, body: JSON.stringify({ niche: "кофейня", tier: "premium" }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).landing.title, "ok");
    assert.equal(received.niche, "кофейня");
  });
});

test("чужой сайт не может пользоваться мостом", async () => {
  let called = false;
  await withServer(async () => { called = true; return { status: 200, body: {} }; }, async base => {
    const res = await fetch(base + "/api/generate-landing", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(called, false);
  });
});

test("предварительный запрос браузера получает разрешение на обращение к этому компьютеру", async () => {
  await withServer(async () => ({ status: 200, body: {} }), async base => {
    const res = await fetch(base + "/api/generate-landing", { method: "OPTIONS", headers: { Origin: ALLOWED, "Access-Control-Request-Method": "POST" } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-private-network"), "true");
  });
});

test("слишком большой запрос и неверный JSON отклоняются", async () => {
  await withServer(async () => ({ status: 200, body: {} }), async base => {
    const bad = await fetch(base + "/api/generate-landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{не json" });
    assert.equal(bad.status, 400);
    const big = await fetch(base + "/api/generate-landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ niche: "x".repeat(70000) }) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
  });
});

test("разбор ответа Claude и проверка источников", () => {
  assert.deepEqual(bridge.parseLanding({ structured_output: { title: "a" } }), { title: "a" });
  assert.deepEqual(bridge.parseLanding({ result: 'Вот ответ: {"title":"b"} готово' }), { title: "b" });
  assert.equal(bridge.parseLanding({ result: "без json" }), null);
  const seen = new Set();
  bridge.collectSeenUrls({ type: "user", message: { content: [{ type: "tool_result", content: "Найдено: https://example.com/page, и ещё http://old.example" }] } }, seen);
  assert.deepEqual([...seen], ["https://example.com/page"]);
});

test("мост не передаёт Claude переменные чужого сеанса и использует общие правила сервера", () => {
  process.env.CLAUDE_TEST_VAR = "1"; process.env.ANTHROPIC_TEST_VAR = "1";
  const env = bridge.cleanEnv();
  delete process.env.CLAUDE_TEST_VAR; delete process.env.ANTHROPIC_TEST_VAR;
  assert.ok(!Object.keys(env).some(k => /^(CLAUDE|ANTHROPIC)/i.test(k)));
  assert.equal(typeof core.instructions, "string");
  assert.equal(core.schema.type, "object");
});

test("редактор сначала ищет локальный мост, затем облачный сервер", () => {
  const src = readFileSync(new URL("../src/landing-studio-app.html", import.meta.url), "utf8");
  assert.match(src, /const AI_BRIDGE="http:\/\/127\.0\.0\.1:8787"/);
  assert.match(src, /const endpoint=await aiEndpoint\(\)/);
  assert.match(src, /return "\/api\/generate-landing";/);
});
