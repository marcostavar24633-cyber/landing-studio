// Тесты Control Center: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditSite, analyzeSeo, analyzeForms, analyzeSecurity, analyzeResponsive, isAllowedUrl, parseAllowedUrl, summarize, AuditError } from "../lib/site-audit.js";
import { classifyWorkflow, splitStatuses, runState, resolveSiteUrl, overallStatus } from "../lib/workflow-status.js";
import { run as runMonitor } from "../scripts/project-health-monitor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GOOD_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Кофейня Пенка</title><meta name="description" content="Кофе рядом с домом"><link rel="canonical" href="https://x.github.io/penka/">
<meta property="og:title" content="Пенка"><meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<link rel="stylesheet" href="style.css"></head><body><h1>Пенка</h1><img src="a.jpg" alt="Кофе">
<a href="tel:+70000000000">Позвонить</a><a href="https://t.me/penka" target="_blank" rel="noopener">Telegram</a>
<form action="https://formspree.io/f/x" method="post"><label for="n">Имя</label><input id="n" name="name" required>
<label><input type="checkbox" name="consent" required> Согласие на обработку персональных данных</label><button>Отправить</button></form></body></html>`;
const BAD_HTML = `<html><head></head><body><h1>A</h1><h1>B</h1><img src="http://cdn.example/a.jpg"><script>const k="ghp_abcdefghijklmnopqrstuvwxyz0123";</script></body></html>`;

function response(body, { status = 200, headers = {}, url } = {}) {
  const r = new Response(body, { status, headers });
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
}

/** Поддельная сеть: сайты и GitHub API. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = String(input), method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    for (const [pattern, handler] of routes) {
      if (pattern instanceof RegExp ? pattern.test(url) : url === pattern) {
        const result = typeof handler === "function" ? handler({ url, method }) : handler;
        if (result instanceof Error) throw result;
        return result instanceof Response ? result : response(JSON.stringify(result), { headers: { "content-type": "application/json" }, url });
      }
    }
    return response("not found", { status: 404, url });
  };
  impl.calls = calls;
  return impl;
}

const html = (body, extra = {}) => ({ url }) => response(body, { headers: { "content-type": "text/html; charset=utf-8", ...extra }, url });

test("классификация workflow: качество отделено от публикации", () => {
  assert.equal(classifyWorkflow({ name: "pages-build-deployment", path: "dynamic/pages/pages-build-deployment" }), "deploy");
  assert.equal(classifyWorkflow({ name: "Deploy to Cloudflare Pages" }), "deploy");
  assert.equal(classifyWorkflow({ name: "Quality checks before deploy" }), "quality");
  assert.equal(classifyWorkflow({ name: "Lighthouse", path: ".github/workflows/lighthouse.yml" }), "quality");
  assert.equal(classifyWorkflow({ name: "Project health monitor" }), "quality");
  assert.equal(classifyWorkflow({ name: "Deploy latest", path: ".github/workflows/deploy-latest.yml" }), "deploy", "latest — не test");
  assert.equal(classifyWorkflow({ name: "Publish site", path: ".github/workflows/static.yml" }), "deploy");
  assert.equal(classifyWorkflow({ name: "CI", path: ".github/workflows/ci.yml" }), "quality");
  assert.equal(classifyWorkflow({ name: "Landing Studio app source and chunk build", path: ".github/workflows/landing-studio-source-build.yml" }), "service");
  assert.equal(classifyWorkflow({ name: "Install Landing Studio archive", path: ".github/workflows/unpack-landing-studio.yml" }), "service");
});

test("раздельные статусы: упавшее качество не портит публикацию", () => {
  const runs = [
    { id: 1, workflow_id: 10, name: "pages-build-deployment", head_branch: "main", status: "completed", conclusion: "success", updated_at: "2026-11-15T10:00:00Z" },
    { id: 2, workflow_id: 20, name: "Quality", head_branch: "main", status: "completed", conclusion: "failure", updated_at: "2026-11-15T11:00:00Z" },
    { id: 3, workflow_id: 10, name: "pages-build-deployment", head_branch: "main", status: "completed", conclusion: "failure", updated_at: "2026-11-14T10:00:00Z" },
    { id: 4, workflow_id: 30, name: "Deploy preview", head_branch: "feature/x", status: "completed", conclusion: "failure", updated_at: "2026-11-15T12:00:00Z" }
  ];
  const s = splitStatuses(runs, "main");
  assert.equal(s.deploy.state, "success", "берётся последний запуск публикации в main, а не старый и не из другой ветки");
  assert.equal(s.quality.state, "failure");
  assert.equal(s.workflows.length, 3);
  assert.equal(overallStatus({ deployState: "success", qualityState: "failure", site: { status: "online" } }).label, "Требует внимания");
  assert.equal(overallStatus({ deployState: "failure", qualityState: "success", site: { status: "online" } }).label, "Критично");
  assert.equal(overallStatus({ deployState: "success", qualityState: "success", site: { status: "unreachable" } }).label, "Критично");
  assert.equal(overallStatus({ deployState: "success", qualityState: "none", site: { status: "online" } }).label, "Рабочий статус");
  assert.equal(overallStatus({ deployState: "success", qualityState: "none", site: { status: "check_failed" } }).label, "Неполные данные");
  assert.equal(overallStatus({ deployState: "success", qualityState: "none", site: null }).label, "Неполные данные");
});

test("статусы: нет запусков в основной ветке — берётся другая ветка; отмена не ошибка", () => {
  const s = splitStatuses([{ id: 1, workflow_id: 1, name: "Deploy", head_branch: "dev", status: "completed", conclusion: "cancelled", updated_at: "2026-11-15T10:00:00Z" }], "main");
  assert.equal(s.deploy.state, "cancelled");
  assert.equal(s.deploy.fallbackBranch, true);
  assert.equal(s.quality.state, "none");
  assert.equal(runState({ status: "in_progress" }), "running");
  assert.equal(runState({ status: "completed", conclusion: "timed_out" }), "failure");
});

test("адрес сайта: реестр → homepage → GitHub Pages", () => {
  assert.equal(resolveSiteUrl({ repo: "raki", url: "https://a.github.io/raki/" }, { homepage: "https://b.vercel.app" }, "A").url, "https://a.github.io/raki/");
  assert.equal(resolveSiteUrl({ repo: "ls" }, { homepage: "https://b.vercel.app", has_pages: true }, "A").url, "https://b.vercel.app");
  assert.equal(resolveSiteUrl({ repo: "Penka" }, { homepage: "", has_pages: true }, "Owner-X").url, "https://owner-x.github.io/Penka/");
  assert.equal(resolveSiteUrl({ repo: "hair" }, { homepage: null, has_pages: false }, "A").url, "");
});

test("допустимые адреса проверки", () => {
  for (const ok of ["https://a.pages.dev", "https://u.github.io/x/", "https://x.vercel.app", "https://x.netlify.app"]) assert.equal(isAllowedUrl(new URL(ok)), true, ok);
  for (const bad of ["http://u.github.io", "https://example.com", "https://evilgithub.io", "https://github.io.evil.com", "https://127.0.0.1", "https://localhost"]) assert.equal(isAllowedUrl(new URL(bad)), false, bad);
  assert.throws(() => parseAllowedUrl("not a url"), AuditError);
  assert.throws(() => parseAllowedUrl("https://example.com"), /Поддерживаются только/);
});

test("SEO: хорошая и плохая страница", () => {
  assert.equal(summarize(analyzeSeo(GOOD_HTML).checks).status, "ok");
  const bad = analyzeSeo(BAD_HTML);
  const byKey = Object.fromEntries(bad.checks.map(c => [c.key, c.status]));
  assert.deepEqual([byKey.title, byKey.description, byKey.h1, byKey.viewport, byKey.lang], ["fail", "fail", "warn", "fail", "warn"]);
});

test("адаптивность: viewport, медиазапросы, фиксированная ширина", () => {
  const good = analyzeResponsive(GOOD_HTML, "img{max-width:100%}@media (max-width:700px){.a{display:none}}@media screen and (min-width:900px){.b{max-width:1200px}}");
  assert.equal(summarize(good.checks).status, "ok");
  assert.equal(good.mediaQueries, 2);
  const bad = analyzeResponsive(BAD_HTML, ".wrap{width:1280px}");
  assert.equal(bad.checks[0].status, "fail");
  assert.equal(bad.checks[3].status, "warn");
  assert.equal(bad.checks[4].status, "warn");
});

test("формы: поля, согласие, отсутствие связи", () => {
  const good = analyzeForms(GOOD_HTML, new URL("https://x.github.io/penka/"));
  assert.equal(good.forms.length, 1);
  assert.equal(good.forms[0].hasSubmit, true);
  assert.equal(good.forms[0].hasConsent, true);
  assert.equal(good.forms[0].fields.length, 2);
  assert.deepEqual(good.issues, []);
  assert.equal(summarize(good.checks).status, "ok");
  assert.equal(summarize(analyzeForms(BAD_HTML, new URL("https://x.github.io/")).checks).status, "fail");
  const insecure = analyzeForms('<form action="http://x.example/send" method="post"><input name="phone" required><button type="submit">ok</button></form>', new URL("https://x.github.io/"));
  assert.equal(insecure.checks.find(c => c.label === "Адрес отправки").status, "fail");
});

test("безопасность: секреты скрыты, смешанный контент, CSP через meta", () => {
  const good = analyzeSecurity(GOOD_HTML, new Headers({ "strict-transport-security": "max-age=1", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" }), new URL("https://x.github.io/"));
  assert.equal(summarize(good.checks).status, "ok");
  const bad = analyzeSecurity(BAD_HTML, new Headers(), new URL("https://x.github.io/"));
  assert.equal(summarize(bad.checks).status, "fail");
  assert.equal(bad.secretFindings[0].count, 1);
  assert.equal(JSON.stringify(bad).includes("ghp_"), false, "значение секрета не должно попадать в отчёт");
  assert.equal(bad.mixedContentCount, 1);
});

test("полный аудит сайта: онлайн, HTTP-ошибка, нет ответа, чужой домен", async () => {
  const fetchImpl = fakeFetch([
    ["https://u.github.io/good/", html(GOOD_HTML, { "strict-transport-security": "max-age=1", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" })],
    ["https://u.github.io/good/style.css", () => response("img{max-width:100%}@media (max-width:600px){a{b:c}}")],
    ["https://u.github.io/robots.txt", () => response("User-agent: *")],
    ["https://u.github.io/good/sitemap.xml", () => response("<urlset/>")],
    ["https://u.github.io/missing/", () => response("nope", { status: 404, headers: { "content-type": "text/html" }, url: "https://u.github.io/missing/" })],
    ["https://u.github.io/down/", () => new TypeError("fetch failed")]
  ]);
  const good = await auditSite("https://u.github.io/good/", { fetchImpl });
  assert.equal(good.availability.status, "online");
  assert.deepEqual(Object.fromEntries(Object.entries(good.sections).map(([k, v]) => [k, v.status])), { seo: "ok", responsive: "ok", forms: "ok", security: "ok" });
  const missing = await auditSite("https://u.github.io/missing/", { fetchImpl });
  assert.equal(missing.availability.status, "http_error");
  assert.equal(missing.availability.httpStatus, 404);
  assert.equal(missing.sections, null);
  assert.equal((await auditSite("https://u.github.io/down/", { fetchImpl })).availability.status, "unreachable");
  assert.equal((await auditSite("https://example.com/", { fetchImpl })).availability.status, "not_allowed");
  assert.equal(fetchImpl.calls.some(c => c.url.includes("example.com")), false, "запрещённый домен не запрашивается");
});

test("монитор: раздельные Issues, критичность только у публикации и сайта", async () => {
  const run = (id, wf, name, conclusion, extra = {}) => ({ id, workflow_id: wf, name, path: `.github/workflows/${wf}.yml`, head_branch: "main", status: "completed", conclusion, updated_at: `2026-11-15T1${id}:00:00Z`, html_url: `https://github.com/o/r/actions/runs/${id}`, ...extra });
  const registry = { owner: "o", projects: [{ repo: "alpha", name: "ALPHA" }, { repo: "beta", name: "BETA" }, { repo: "gamma", name: "GAMMA" }, { repo: "delta", name: "DELTA" }] };
  const openIssues = [
    { number: 7, title: "[CI] o/alpha — pages-build-deployment", body: "<!-- monitored-project:o/alpha -->\n<!-- monitored-workflow:o/alpha:1 -->" },
    { number: 8, title: "[Сайт] o/alpha — недоступен", body: "<!-- monitored-site:o/alpha -->" }
  ];
  const fetchImpl = fakeFetch([
    [/\/repos\/o\/landing-studio\/issues\?/, openIssues],
    [/\/repos\/o\/landing-studio\/issues/, { ok: true }],
    ["https://api.github.com/repos/o/alpha", { default_branch: "main", homepage: "", has_pages: true }],
    [/\/repos\/o\/alpha\/actions\/runs/, { workflow_runs: [run(1, 1, "pages-build-deployment", "success"), run(2, 2, "Quality", "failure")] }],
    ["https://api.github.com/repos/o/beta", { default_branch: "main", homepage: "https://beta.vercel.app", has_pages: false }],
    [/\/repos\/o\/beta\/actions\/runs/, { workflow_runs: [run(3, 3, "Deploy", "failure")] }],
    ["https://api.github.com/repos/o/gamma", { default_branch: "main", homepage: "", has_pages: true }],
    [/\/repos\/o\/gamma\/actions\/runs/, { workflow_runs: [run(4, 4, "pages-build-deployment", "success")] }],
    ["https://api.github.com/repos/o/delta", () => response("{}", { status: 404 })],
    ["https://o.github.io/alpha/", html(GOOD_HTML, { "strict-transport-security": "max-age=1", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" })],
    ["https://o.github.io/alpha/style.css", () => response("img{max-width:100%}@media (max-width:600px){a{b:c}}")],
    ["https://o.github.io/robots.txt", () => response("ok")],
    ["https://o.github.io/alpha/sitemap.xml", () => response("ok")],
    ["https://beta.vercel.app", html(GOOD_HTML)],
    ["https://beta.vercel.app/", html(GOOD_HTML)],
    ["https://o.github.io/gamma/", () => response("gone", { status: 404, headers: { "content-type": "text/html" }, url: "https://o.github.io/gamma/" })]
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-"));
  const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/landing-studio", GITHUB_STEP_SUMMARY: path.join(dir, "summary.md"), MONITOR_REPORT: path.join(dir, "report.json") };
  const { report, markdown, failed } = await runMonitor({ fetchImpl, env, registry, log: () => {} });

  assert.equal(failed, true);
  const alpha = report.projects[0], beta = report.projects[1], gamma = report.projects[2], delta = report.projects[3];
  assert.deepEqual([alpha.quality.state, alpha.deploy.state, alpha.site.status, alpha.overall.label], ["failure", "success", "online", "Требует внимания"]);
  assert.deepEqual([beta.deploy.state, beta.quality.state, beta.overall.label], ["failure", "none", "Критично"]);
  assert.deepEqual([gamma.deploy.state, gamma.site.status, gamma.overall.label], ["success", "http_error", "Критично"]);
  assert.ok(delta.error);
  assert.equal(report.critical.length, 3, "публикация beta, сайт gamma, ошибка API delta");
  assert.equal(report.warnings.length, 1, "качество alpha — только предупреждение");
  assert.deepEqual(report.totals, { projects: 4, deployed: 2, deployFailures: 1, qualityFailures: 1, sitesKnown: 3, sitesOnline: 2 });

  const actions = report.issueActions.map(a => a.action + ": " + a.title).sort();
  assert.deepEqual(actions, [
    "close: [CI] o/alpha — pages-build-deployment",
    "close: [Сайт] o/alpha — недоступен",
    "create: [Качество] o/alpha — Quality",
    "create: [Публикация] o/beta — Deploy",
    "create: [Сайт] o/gamma — недоступен"
  ]);
  const writes = fetchImpl.calls.filter(c => c.method !== "GET" && c.url.includes("api.github.com"));
  assert.equal(writes.filter(c => c.method === "POST" && c.url.endsWith("/issues")).length, 3);
  assert.equal(writes.filter(c => c.method === "PATCH" && c.body.state === "closed").length, 2);
  assert.ok(writes.every(c => c.url.includes("/repos/o/landing-studio/")), "запись только в репозиторий монитора");
  assert.match(markdown, /\| ALPHA \| 🔴 \[Есть замечания\]/);
  assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), /Сводный мониторинг проектов/);
  assert.equal(JSON.parse(fs.readFileSync(env.MONITOR_REPORT, "utf8")).projects.length, 4);
});

test("монитор без токена ничего не записывает", async () => {
  const fetchImpl = fakeFetch([
    [/issues\?/, []],
    ["https://api.github.com/repos/o/a", { default_branch: "main", has_pages: false }],
    [/actions\/runs/, { workflow_runs: [{ id: 1, workflow_id: 1, name: "Deploy", head_branch: "main", status: "completed", conclusion: "failure", updated_at: "2026-11-15T10:00:00Z", html_url: "u" }] }]
  ]);
  const { report } = await runMonitor({ fetchImpl, env: {}, registry: { owner: "o", projects: [{ repo: "a", name: "A" }] }, log: () => {} });
  assert.equal(report.issueActions.length, 1);
  assert.equal(fetchImpl.calls.filter(c => c.method !== "GET").length, 0);
});

test("реестр: 9 уникальных проектов, сборка панели полная", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "projects.json"), "utf8"));
  assert.equal(registry.projects.length, 9);
  assert.equal(new Set(registry.projects.map(p => p.repo.toLowerCase())).size, 9);
  for (const p of registry.projects) { assert.ok(p.repo && p.name); if (p.url) assert.ok(isAllowedUrl(new URL(p.url)), p.url); }

  execFileSync("bash", [path.join(ROOT, "scripts/build-cloudflare-pages.sh")], { stdio: "pipe" });
  const dist = path.join(ROOT, "dist");
  for (const file of ["index.html", "control-center.js", "lib/workflow-status.js", "projects.json", "_routes.json"]) assert.ok(fs.existsSync(path.join(dist, file)), file);
  const page = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const script = fs.readFileSync(path.join(dist, "control-center.js"), "utf8");
  // Каждый id, к которому обращается скрипт, есть в разметке.
  const ids = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const m of script.matchAll(/\$\("([A-Za-z]+)"\)/g)) assert.ok(ids.has(m[1]), "нет элемента #" + m[1]);
  for (const key of ["seo", "responsive", "forms", "security"]) for (const suffix of ["Url", "Result", "All"]) assert.ok(ids.has(key + suffix), key + suffix);
  for (const m of script.matchAll(/from "(\.\/[^"]+)"/g)) assert.ok(fs.existsSync(path.join(dist, m[1])), "нет модуля " + m[1]);
  // Синтаксис модулей панели и функций Cloudflare.
  const check = file => execFileSync(process.execPath, ["--input-type=module", "--check"], { input: fs.readFileSync(file, "utf8"), stdio: ["pipe", "pipe", "pipe"] });
  check(path.join(ROOT, "src/control-center.js"));
  for (const name of fs.readdirSync(path.join(ROOT, "functions/api"))) check(path.join(ROOT, "functions/api", name));
});
