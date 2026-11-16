#!/usr/bin/env node
"use strict";
// Локальный AI-мост Landing Studio: генерация без ключа API.
//
// Запускается на вашем компьютере и отвечает на те же запросы, что облачный /api/generate-landing,
// но тексты пишет Claude Code под вашим аккаунтом Claude (подписка), с поиском в интернете.
// Работает, только пока компьютер включён и это окно открыто.
//
//   node tools/local-ai-bridge.cjs            запустить мост (http://127.0.0.1:8787)
//   node tools/local-ai-bridge.cjs --login    один раз войти в аккаунт Claude
//   node tools/local-ai-bridge.cjs --check    проверить, что Claude Code найден и вход выполнен
//
// Настройки (переменные окружения): PORT, CLAUDE_BIN, BRIDGE_MODEL, BRIDGE_ORIGINS (через запятую), BRIDGE_TIMEOUT_MS.

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const core = require("../server/generate-landing-core.js");

const PORT = Number(process.env.PORT) || 8787;
const HOST = "127.0.0.1"; // только этот компьютер: из сети мост недоступен
const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS) || 6 * 60 * 1000;
const MAX_BODY = 60000;
const DEFAULT_ORIGINS = [
  "https://landing-studio-five.vercel.app",
  "https://marcostavar24633-cyber.github.io",
  "http://localhost:5180", "http://127.0.0.1:5180", "http://localhost:5182", "http://127.0.0.1:5182",
];
const ORIGINS = (process.env.BRIDGE_ORIGINS ? process.env.BRIDGE_ORIGINS.split(",") : DEFAULT_ORIGINS).map(s => s.trim()).filter(Boolean);

/** Ищет Claude Code: CLAUDE_BIN, затем PATH, затем копию внутри приложения Claude для Windows. */
function findClaude() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const onPath = probe.status === 0 && probe.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
  if (onPath) return onPath;
  const found = [];
  const base = path.join(process.env.LOCALAPPDATA || "", "Claude-Data");
  try {
    for (const pkg of fs.readdirSync(base)) {
      const versions = path.join(base, pkg, "claude-code");
      if (!fs.existsSync(versions)) continue;
      for (const version of fs.readdirSync(versions)) {
        for (const build of fs.readdirSync(path.join(versions, version))) {
          const exe = path.join(versions, version, build, "claude.exe");
          if (fs.existsSync(exe)) found.push({ exe, version: version.split(".").map(Number) });
        }
      }
    }
  } catch { /* папки нет — Claude для Windows не установлен */ }
  found.sort((a, b) => { for (let i = 0; i < 3; i++) if ((b.version[i] || 0) !== (a.version[i] || 0)) return (b.version[i] || 0) - (a.version[i] || 0); return 0; });
  return found[0] ? found[0].exe : "";
}

/** Окружение без переменных чужого сеанса Claude: мост использует собственный вход (--login). */
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC)/i.test(k)) env[k] = v;
  return env;
}

function authStatus(bin) {
  const r = spawnSync(bin, ["auth", "status"], { encoding: "utf8", env: cleanEnv(), timeout: 20000 });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  let loggedIn = r.status === 0 && !/not logged in/i.test(text);
  try { const j = JSON.parse(r.stdout); if (typeof j.loggedIn === "boolean") loggedIn = j.loggedIn; } catch { /* текстовый ответ */ }
  return loggedIn;
}

/** Собирает адреса, которые действительно встречались в результатах веб-поиска. */
function collectSeenUrls(event, seen) {
  if (event.type !== "user" || !event.message || !Array.isArray(event.message.content)) return;
  for (const part of event.message.content) {
    if (part.type !== "tool_result") continue;
    const text = typeof part.content === "string" ? part.content : JSON.stringify(part.content || "");
    for (const m of text.matchAll(/https:\/\/[^\s"'<>\\)\]]+/g)) seen.add(m[0].replace(/[.,;]+$/, ""));
  }
}

function runClaude(bin, prompt) {
  return new Promise(resolve => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-bridge-")); // пустая папка: у модели нет доступа к вашим файлам
    const args = [
      "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
      "--system-prompt", core.instructions,
      "--json-schema", JSON.stringify(core.schema),
      "--tools", "WebSearch", "WebFetch",
      "--allowedTools", "WebSearch", "WebFetch",
      "--strict-mcp-config", "--setting-sources", "",
    ];
    if (process.env.BRIDGE_MODEL) args.push("--model", process.env.BRIDGE_MODEL);
    const child = spawn(bin, args, { cwd: workdir, env: cleanEnv(), windowsHide: true });
    const seen = new Set();
    let buffer = "", result = null, stderr = "";
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { const ev = JSON.parse(line); collectSeenUrls(ev, seen); if (ev.type === "result") result = ev; } catch { /* не JSON */ }
      }
    });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", err => { clearTimeout(timer); resolve({ error: `Не удалось запустить Claude Code: ${err.message}` }); });
    child.on("close", () => {
      clearTimeout(timer);
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* временная папка */ }
      if (!result) return resolve({ error: stderr.trim().slice(0, 300) || "Claude Code не вернул ответ (возможно, истекло время ожидания)." });
      resolve({ result, seen });
    });
    child.stdin.end(prompt, "utf8");
  });
}

function parseLanding(result) {
  if (result.structured_output && typeof result.structured_output === "object") return result.structured_output;
  const text = String(result.result || "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function generate(bin, input) {
  const i = core.readInput(input);
  if (!i.niche) return { status: 400, body: { error: "Укажите нишу бизнеса." } };
  const { result, seen, error } = await runClaude(bin, core.buildInput(i));
  if (error) return { status: 502, body: { error } };
  if (result.is_error) {
    const msg = String(result.result || "");
    if (/not logged in|\/login/i.test(msg)) return { status: 503, body: { error: "Локальный мост не вошёл в аккаунт Claude. Закройте мост и запустите вход: node tools/local-ai-bridge.cjs --login" } };
    if (/limit|quota|rate/i.test(msg)) return { status: 429, body: { error: "Достигнут лимит вашей подписки Claude. Попробуйте позже." } };
    return { status: 502, body: { error: `Claude не смог подготовить сайт: ${msg.slice(0, 200) || "неизвестная ошибка"}` } };
  }
  const landing = parseLanding(result);
  if (!landing || typeof landing.title !== "string") return { status: 502, body: { error: "Claude вернул неполный ответ. Повторите запрос." } };
  // Источники — только адреса, которые реально встретились в результатах поиска, а не названные моделью по памяти.
  const sources = (Array.isArray(landing.researchSources) ? landing.researchSources : [])
    .filter(s => s && typeof s.url === "string" && /^https:\/\//i.test(s.url) && [...seen].some(u => u.startsWith(s.url.replace(/\/+$/, "")) || s.url.startsWith(u)))
    .map(s => ({ title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : s.url, url: s.url }));
  landing.researchSources = [...new Map(sources.map(s => [s.url, s])).values()].slice(0, 8);
  landing.tier = i.tier;
  return { status: 200, body: { landing, via: "local-bridge" } };
}

function corsHeaders(origin) {
  if (!origin || !ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin",
    // Сайт на https обращается к адресу этого компьютера: браузеру нужно явное разрешение.
    "Access-Control-Allow-Private-Network": "true",
  };
}

function createServer(bin, generateFn = generate) {
  let busy = false;
  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeaders(origin);
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors }); res.end(JSON.stringify(body)); };
    // Запросы со страниц не из списка отклоняются: чужой сайт не сможет тратить вашу подписку.
    if (origin && !ORIGINS.includes(origin)) return send(403, { error: "Этот сайт не входит в список разрешённых для локального моста." });
    const url = (req.url || "").split("?")[0];
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "GET" && (url === "/health" || url === "/api/generate-landing")) return send(200, { status: "ok", bridge: "landing-studio-local", busy });
    if (req.method !== "POST" || url !== "/api/generate-landing") return send(404, { error: "Неизвестный адрес." });
    if (busy) return send(429, { error: "Мост уже готовит другой сайт. Дождитесь окончания." });
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { send(413, { error: "Слишком большой запрос." }); req.destroy(); } else chunks.push(c); });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(400, { error: "Запрос должен быть в формате JSON." }); }
      busy = true;
      const started = Date.now();
      console.log(`[${new Date().toLocaleTimeString()}] Готовлю сайт: ${String(input && input.niche || "").slice(0, 80)}`);
      try {
        const out = await generateFn(bin, input);
        console.log(`[${new Date().toLocaleTimeString()}] ${out.status === 200 ? "Готово" : "Ошибка: " + out.body.error} (${Math.round((Date.now() - started) / 1000)} с)`);
        send(out.status, out.body);
      } catch (err) {
        console.error(err);
        send(500, { error: "Внутренняя ошибка локального моста." });
      } finally { busy = false; }
    });
  });
}

function main() {
  const bin = findClaude();
  const arg = process.argv[2];
  if (!bin) {
    console.error("Claude Code не найден. Установите приложение Claude для Windows или Claude Code и повторите.\nМожно указать путь вручную в переменной CLAUDE_BIN.");
    process.exit(1);
  }
  if (arg === "--login") {
    const r = spawnSync(bin, ["auth", "login"], { stdio: "inherit", env: cleanEnv() });
    process.exit(r.status || 0);
  }
  const loggedIn = authStatus(bin);
  if (arg === "--check") {
    console.log(`Claude Code: ${bin}\nВход в аккаунт: ${loggedIn ? "выполнен" : "НЕ выполнен — запустите с ключом --login"}`);
    process.exit(loggedIn ? 0 : 2);
  }
  if (!loggedIn) console.warn("Внимание: вход в аккаунт Claude не выполнен. Запустите: node tools/local-ai-bridge.cjs --login\n");
  createServer(bin).listen(PORT, HOST, () => {
    console.log(`Локальный AI-мост Landing Studio работает: http://${HOST}:${PORT}`);
    console.log("Не закрывайте это окно, пока пользуетесь генерацией. Остановить: Ctrl+C.");
    console.log(`Разрешённые сайты: ${ORIGINS.join(", ")}`);
  });
}

if (require.main === module) main();
module.exports = { createServer, corsHeaders, parseLanding, collectSeenUrls, findClaude, cleanEnv, ORIGINS };
