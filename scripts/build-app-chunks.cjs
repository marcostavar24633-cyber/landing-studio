#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const sourcePath = path.join("src", "landing-studio-app.html");
const indexPath = "index.html";
const chunksDir = "app-chunks";
const chunkSize = 2000;

if (!fs.existsSync(sourcePath)) throw new Error("Missing editable source: " + sourcePath);
if (!fs.existsSync(indexPath)) throw new Error("Missing loader: " + indexPath);

let html = fs.readFileSync(sourcePath, "utf8");
if (!html.trim() || !html.includes("<html")) throw new Error("Source does not look like a complete HTML document.");

// Движок Unique Design Studio встраивается в приложение: загрузчик пишет HTML через document.write,
// и внешний файл по относительному пути из src/ там бы не нашёлся.
const enginePath = path.join("vendor", "uds-engine.js");
const engineTag = /<script data-uds-engine src="[^"]*"><\/script>/;
if (engineTag.test(html)) {
  if (!fs.existsSync(enginePath)) throw new Error("Missing " + enginePath + ": run node scripts/sync-uds-engine.mjs");
  // Закрывающие теги внутри строк движка экранируются: </script> закрыл бы тег раньше времени,
  // а загрузчик index.html вставляет AI-помощника перед первым </body> в документе.
  const engine = fs.readFileSync(enginePath, "utf8").replace(/<\/(script|body|html|head)/gi, "<\\/$1");
  new Function(engine); // экранирование не должно ломать синтаксис
  html = html.replace(engineTag, () => "<script data-uds-engine>" + engine + "</script>");
  const firstBody = html.toLowerCase().indexOf("</body>");
  if (firstBody !== html.toLowerCase().lastIndexOf("</body>")) throw new Error("App HTML must contain exactly one </body> after inlining the UDS engine.");
}

const base64 = zlib.gzipSync(Buffer.from(html, "utf8"), { level: 9 }).toString("base64");
const count = Math.ceil(base64.length / chunkSize);
fs.mkdirSync(chunksDir, { recursive: true });

for (const name of fs.readdirSync(chunksDir)) {
  if (/^\d{2}\.txt$/.test(name)) fs.unlinkSync(path.join(chunksDir, name));
}
for (let i = 0; i < count; i++) {
  const name = String(i).padStart(2, "0") + ".txt";
  fs.writeFileSync(path.join(chunksDir, name), base64.slice(i * chunkSize, (i + 1) * chunkSize), "utf8");
}

let loader = fs.readFileSync(indexPath, "utf8");
const match = loader.match(/Array\.from\(\{length:(\d+)\}/);
if (!match) throw new Error("Could not find the app-chunk count in index.html.");
loader = loader.replace(match[0], "Array.from({length:" + count + "}");
fs.writeFileSync(indexPath, loader, "utf8");

const roundTrip = zlib.gunzipSync(Buffer.from(
  Array.from({ length: count }, (_, i) =>
    fs.readFileSync(path.join(chunksDir, String(i).padStart(2, "0") + ".txt"), "utf8")
  ).join(""),
  "base64"
)).toString("utf8");

if (roundTrip !== html) throw new Error("Compressed chunks failed round-trip validation.");
console.log("Built " + count + " chunks; source=" + html.length + " chars; gzip-base64=" + base64.length + " chars.");
