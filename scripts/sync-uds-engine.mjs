#!/usr/bin/env node
// Собирает движок Unique Design Studio (src/engine) в один браузерный файл vendor/uds-engine.js.
// Глобальное имя — window.UDS. Запуск:
//   node scripts/sync-uds-engine.mjs [путь к репозиторию unique-design-studio]
// По умолчанию берётся соседняя папка ../unique-design-studio.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const udsDir = resolve(process.argv[2] || process.env.UDS_DIR || join(root, "..", "unique-design-studio"));
const entry = join(udsDir, "src", "engine", "index.js");
if (!existsSync(entry)) {
  console.error(`Не найден движок UDS: ${entry}\nУкажите путь: node scripts/sync-uds-engine.mjs <папка unique-design-studio>`);
  process.exit(1);
}

let commit = "unknown";
try { commit = execFileSync("git", ["-C", udsDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* не git-папка */ }

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
// Относительный путь и cwd = папка UDS: на Windows npx.cmd запускается через оболочку, а пути с пробелами она бы разбила.
const bundle = execFileSync(npx, [
  "--yes", "esbuild@0.24.2", "src/engine/index.js",
  "--bundle", "--format=iife", "--global-name=UDS", "--minify", "--target=es2019", "--legal-comments=none", "--charset=utf8",
], { cwd: udsDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" });

const header = `/* Unique Design Studio engine — https://github.com/marcostavar24633-cyber/unique-design-studio @ ${commit}\n` +
  `   Сгенерировано scripts/sync-uds-engine.mjs. Не редактировать вручную. */\n`;
const out = join(root, "vendor", "uds-engine.js");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, header + bundle.replace(/\r\n/g, "\n"));
console.log(`vendor/uds-engine.js обновлён (UDS @ ${commit}, ${Math.round(bundle.length / 1024)} КБ)`);
