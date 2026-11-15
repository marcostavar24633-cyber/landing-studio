// WEB PROJECT CONTROL CENTER PRO — логика панели.
// Статусы качества и публикации считаются раздельно (lib/workflow-status.js);
// аудит сайтов выполняют Cloudflare Pages Functions (/api/site-audit и /api/*-check).
import { splitStatuses, expandCombinedRuns, classifyWorkflow, runState, resolveSiteUrl, overallStatus, QUALITY_LABELS, DEPLOY_LABELS } from "./lib/workflow-status.js";

const state = { owner: "", projects: [], items: [], runs: [], checking: false, last: null };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const time = s => s ? new Date(s).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
const SECTIONS = { seo: "SEO", responsive: "Адаптивность", forms: "Формы", security: "Безопасность" };
const KIND_LABELS = { deploy: "Публикация", quality: "Качество", service: "Служебный" };
const STATE_CLASS = { success: "good", failure: "bad", running: "warn", cancelled: "warn", neutral: "", none: "" };
const CHECK_CLASS = { ok: "good", warn: "warn", fail: "bad" };

async function api(path) {
  const r = await fetch("https://api.github.com" + path, { headers: { Accept: "application/vnd.github+json" } });
  if (r.status === 403 || r.status === 429) throw new Error("Лимит GitHub API исчерпан (60 запросов в час без авторизации). Повтори позже.");
  if (!r.ok) throw new Error("GitHub API " + r.status);
  return r.json();
}

async function postJson(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let data = null;
  try { data = await response.json(); } catch { /* не JSON: функция недоступна */ }
  if (!data) throw new Error("Сервис проверок недоступен. Панель должна быть открыта с Cloudflare Pages, где работают функции /api.");
  if (!response.ok) throw new Error(data.error || "Ошибка проверки");
  return data;
}

// ---------- Отрисовка ----------

/** Плашка статуса группы workflow (качество или публикация) со ссылкой на журнал. */
function groupPill(group, labels, caption) {
  if (!group) return '<span class="pill warn">Нет данных</span>';
  const text = (caption ? "<small>" + caption + "</small>" : "") + esc(labels[group.state]);
  const title = group.run ? esc(group.run.name + " · ветка " + group.run.head_branch + " · " + time(group.run.updated_at)) : "Подходящих workflow не найдено";
  const cls = "pill " + STATE_CLASS[group.state];
  return group.run ? '<a class="' + cls + '" title="' + title + '" href="' + esc(group.run.html_url) + '" target="_blank" rel="noopener">' + text + "</a>" : '<span class="' + cls + '" title="' + title + '">' + text + "</span>";
}

function siteInfo(item) {
  if (!item.siteUrl) return { cls: "", text: "URL не найден" };
  const s = item.site;
  if (!s || s.status === "check_failed") return { cls: "warn", text: "Не проверен" };
  if (s.status === "online") return { cls: "good", text: "Доступен · HTTP " + s.httpStatus };
  if (s.status === "not_allowed") return { cls: "warn", text: "Домен вне списка проверки" };
  if (s.status === "http_error") return { cls: "bad", text: "Ошибка HTTP " + s.httpStatus };
  return { cls: "bad", text: "Недоступен" };
}

function sectionCell(section) {
  if (!section) return '<span class="sub">—</span>';
  const total = section.ok + section.warn + section.fail;
  return '<span class="pill ' + CHECK_CLASS[section.status] + '">' + section.ok + "/" + total + "</span>";
}

function card(item) {
  const p = item.project, site = siteInfo(item), r = item.statuses?.latest, sections = item.audit?.sections;
  const audit = sections ? Object.entries(SECTIONS).map(([key, label]) => '<span class="pill ' + CHECK_CLASS[sections[key].status] + '"><small>' + label + "</small>" + sections[key].ok + "/" + (sections[key].ok + sections[key].warn + sections[key].fail) + "</span>").join(" ") : "";
  return '<article class="project"><div class="phead"><div><div class="pname">' + esc(p.name) + '</div><div class="slug">' + esc(state.owner + "/" + p.repo) + '</div></div><div class="pills">' +
    (item.error ? '<span class="pill warn">Нет данных</span>' : groupPill(item.statuses.quality, QUALITY_LABELS, "Качество") + groupPill(item.statuses.deploy, DEPLOY_LABELS, "Публикация")) +
    '</div></div><div class="pmeta"><span>Ветка: ' + esc(item.defaultBranch || p.branch || "main") + "</span><span>Последний запуск: " + time(r?.updated_at) + '</span><span class="pill ' + site.cls + '">' + esc(site.text) + "</span></div>" +
    (audit ? '<div class="pmeta">' + audit + "</div>" : "") +
    '<div class="pmeta"><span class="pill ' + item.overall.level + '">' + esc(item.overall.label) + "</span><span>" + esc(item.overall.reason) + '</span></div><div class="pmeta">' +
    (item.siteUrl ? '<a class="plink" href="' + esc(item.siteUrl) + '" target="_blank" rel="noopener">Открыть сайт ↗</a>' : "<span>Адрес сайта не найден: укажи url в projects.json или homepage в репозитории</span>") +
    ' <a class="plink" href="https://github.com/' + esc(state.owner + "/" + p.repo) + '" target="_blank" rel="noopener">GitHub ↗</a></div><div class="pactions">' +
    (r?.html_url ? '<a href="' + esc(r.html_url) + '" target="_blank" rel="noopener">Журнал Actions</a>' : "") +
    '<a href="https://github.com/' + esc(state.owner + "/" + p.repo) + '/actions" target="_blank" rel="noopener">Все сборки</a></div></article>';
}

function summaryRow(x) {
  if (x.error) return "<tr><td>" + esc(x.project.name) + '</td><td colspan="7" class="sub">' + esc(x.error) + '</td><td><span class="pill warn">Нет данных</span></td></tr>';
  const site = siteInfo(x), s = x.audit?.sections;
  return "<tr><td>" + esc(x.project.name) + "</td><td>" + groupPill(x.statuses.quality, QUALITY_LABELS, "") + "</td><td>" + groupPill(x.statuses.deploy, DEPLOY_LABELS, "") +
    '</td><td><span class="pill ' + site.cls + '">' + esc(site.text) + "</span></td><td>" + sectionCell(s?.seo) + "</td><td>" + sectionCell(s?.responsive) + "</td><td>" + sectionCell(s?.forms) + "</td><td>" + sectionCell(s?.security) +
    '</td><td><span class="pill ' + x.overall.level + '">' + esc(x.overall.label) + '</span><span class="reason">' + esc(x.overall.reason) + "</span></td></tr>";
}

/** Таблица «по всем проектам» на вкладке одного раздела аудита. */
function sectionTable(key) {
  const rows = state.items.map(x => {
    const section = x.audit?.sections?.[key];
    if (!section) return "<tr><td>" + esc(x.project.name) + '</td><td colspan="4" class="sub">' + esc(x.siteUrl ? siteInfo(x).text : "Адрес сайта не найден") + "</td></tr>";
    const problems = section.checks.filter(c => c.status !== "ok" && c.status !== "info").map(c => (c.status === "fail" ? "✕ " : "") + c.label);
    return "<tr><td>" + esc(x.project.name) + '</td><td><span class="pill ' + CHECK_CLASS[section.status] + '">' + (section.status === "ok" ? "OK" : section.status === "fail" ? "Проблема" : "Внимание") + "</span></td><td>" + section.ok + " из " + (section.ok + section.warn + section.fail) +
      '</td><td class="problems">' + (problems.length ? esc(problems.join(" · ")) : "Замечаний нет") + '</td><td><button class="linkbtn" data-detail="' + key + '" data-url="' + esc(x.siteUrl) + '">Подробнее</button></td></tr>';
  }).join("");
  $(key + "All").innerHTML = rows || '<tr><td colspan="5">Нажми «Проверить все».</td></tr>';
  document.querySelector('[data-chips="' + key + '"]').innerHTML = state.items.filter(x => x.siteUrl).map(x => '<button data-detail="' + key + '" data-url="' + esc(x.siteUrl) + '">' + esc(x.project.name) + "</button>").join("");
}

function render() {
  const list = state.items, total = state.projects.length;
  const deployed = list.filter(x => x.statuses?.deploy.state === "success").length;
  const deployFailed = list.filter(x => x.statuses?.deploy.state === "failure").length;
  const qualityFailed = list.filter(x => x.statuses?.quality.state === "failure").length;
  $("qualitySummary").innerHTML = list.map(summaryRow).join("") || '<tr><td colspan="9">Нет данных</td></tr>';
  $("mGood").textContent = deployed + "/" + total;
  $("mBad").textContent = deployFailed;
  $("mQuality").textContent = qualityFailed;
  $("mSites").textContent = list.filter(x => x.site?.status === "online").length + "/" + list.filter(x => x.siteUrl).length;
  renderCards("overviewProjects", $("searchOverview").value);
  renderCards("allProjects", $("searchProjects").value);
  $("runsTable").innerHTML = state.runs.map(x => {
    const s = runState(x);
    const label = s === "success" ? "Успешно" : s === "failure" ? "Ошибка" : s === "running" ? "Выполняется" : s === "cancelled" ? "Отменён" : x.conclusion === "skipped" ? "Пропущен" : (x.conclusion || "Неизвестно");
    return "<tr><td>" + esc(x.project) + "</td><td>" + esc(x.name) + "</td><td>" + KIND_LABELS[classifyWorkflow(x)] + "</td><td>" + esc(x.head_branch) + '</td><td><span class="pill ' + STATE_CLASS[s] + '">' + esc(label) + "</span></td><td>" + time(x.updated_at) + '</td><td><a target="_blank" rel="noopener" href="' + esc(x.html_url) + '">Открыть ↗</a></td></tr>';
  }).join("") || '<tr><td colspan="7">Нет запусков или проверка ещё не выполнена.</td></tr>';
  Object.keys(SECTIONS).forEach(sectionTable);
}

function renderCards(target, query) {
  const q = String(query || "").toLowerCase();
  $(target).innerHTML = state.items.filter(x => (x.project.name + " " + x.project.repo).toLowerCase().includes(q)).map(card).join("") || '<div class="empty">Нет данных</div>';
}

// ---------- Сбор данных ----------

async function loadRegistry() {
  if (state.projects.length) return;
  const response = await fetch("./projects.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить реестр проектов projects.json (HTTP " + response.status + ")");
  const registry = await response.json();
  state.owner = registry.owner;
  state.projects = registry.projects;
}

async function checkProject(project) {
  const item = { project };
  try {
    const [meta, runs] = await Promise.all([
      api("/repos/" + state.owner + "/" + project.repo),
      api("/repos/" + state.owner + "/" + project.repo + "/actions/runs?per_page=50")
    ]);
    item.defaultBranch = project.branch || meta.default_branch || "main";
    // Совмещённые workflow («quality & deploy») делятся по заданиям и шагам.
    const expanded = await expandCombinedRuns(runs.workflow_runs || [], item.defaultBranch, async r => (await api("/repos/" + state.owner + "/" + project.repo + "/actions/runs/" + r.id + "/jobs?per_page=100")).jobs || []);
    item.statuses = splitStatuses(expanded, item.defaultBranch);
    item.siteUrl = resolveSiteUrl(project, meta, state.owner).url;
  } catch (error) {
    item.error = error.message;
    item.siteUrl = project.url || "";
  }
  if (item.siteUrl) {
    try {
      item.audit = await postJson("/api/site-audit", { url: item.siteUrl });
      item.site = item.audit.availability;
    } catch (error) {
      console.warn("Site audit failed", project.repo, error);
      item.site = { status: "check_failed" };
    }
  }
  item.overall = overallStatus({ error: item.error, deployState: item.statuses?.deploy.state, qualityState: item.statuses?.quality.state, site: item.siteUrl ? item.site : null, audit: item.audit });
  return item;
}

async function refresh() {
  if (state.checking) return;
  state.checking = true;
  $("refresh").disabled = true;
  $("refresh").textContent = "Проверяю…";
  $("globalStatus").innerHTML = '<i class="dot"></i>Получение данных GitHub и проверка сайтов';
  try {
    await loadRegistry();
    state.items = await Promise.all(state.projects.map(checkProject));
    state.runs = state.items.flatMap(x => (x.statuses?.workflows || []).map(r => ({ ...r, project: x.project.name })));
    state.last = new Date();
    const ok = state.items.filter(x => !x.error).length;
    const critical = state.items.filter(x => x.overall.level === "bad").length;
    const apiError = state.items.find(x => x.error)?.error;
    $("globalStatus").innerHTML = '<i class="dot ' + (critical ? "bad" : ok === state.projects.length ? "good" : "") + '"></i>Проверено ' + ok + "/" + state.projects.length + " репозиториев • " + time(state.last.toISOString()) + (apiError ? " • " + esc(apiError) : "");
    render();
    saveHistory({
      at: state.last.toISOString(), total: ok,
      good: state.items.filter(x => x.statuses?.deploy.state === "success").length,
      bad: state.items.filter(x => x.statuses?.deploy.state === "failure").length,
      quality: state.items.filter(x => x.statuses?.quality.state === "failure").length,
      sites: state.items.filter(x => x.site?.status === "online").length + "/" + state.items.filter(x => x.siteUrl).length
    });
  } catch (error) {
    $("globalStatus").innerHTML = '<i class="dot bad"></i>' + esc(error.message);
  } finally {
    state.checking = false;
    $("refresh").disabled = false;
    $("refresh").textContent = "↻ Проверить все";
  }
}

// ---------- История ----------

function historyRows(h) {
  return h.slice(0, 50).map(x => "<tr><td>" + time(x.at) + "</td><td>" + esc(x.total) + "</td><td>" + esc(x.good) + "</td><td>" + esc(x.bad) + "</td><td>" + esc(x.quality ?? "—") + "</td><td>" + esc(x.sites ?? "—") + "</td></tr>").join("");
}
function readHistory() { try { const h = JSON.parse(localStorage.getItem("wpc_history") || "[]"); return Array.isArray(h) ? h : []; } catch { return []; } }
function saveHistory(entry) {
  const h = [entry, ...readHistory()].slice(0, 50);
  try { localStorage.setItem("wpc_history", JSON.stringify(h)); } catch { /* хранилище недоступно */ }
  $("historyTable").innerHTML = historyRows(h);
}
function loadHistory() { const h = readHistory(); if (h.length) $("historyTable").innerHTML = historyRows(h); }

// ---------- Подробные проверки по адресу ----------

const meta = data => '<div class="pmeta">Проверен: ' + esc(data.url) + " · HTTP " + esc(data.httpStatus) + " · " + time(data.checkedAt) + "</div>";
function checksTable(checks, head, failLabel = "Проблема") {
  const rows = checks.map(x => "<tr><td>" + esc(x.label) + '</td><td><span class="pill ' + (CHECK_CLASS[x.status] || "") + '">' + (x.status === "ok" ? "OK" : x.status === "fail" ? failLabel : "Внимание") + "</span></td><td>" + esc(x.value) + "</td></tr>").join("");
  return '<div class="tablewrap"><table><thead><tr><th>' + head + "</th><th>Статус</th><th>Результат</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
}

const DETAILS = {
  seo: {
    endpoint: "/api/seo-check", button: "runSeo", label: "Проверить SEO", wait: "Загружаю страницу и анализирую SEO-сигналы…",
    render: data => meta(data) + checksTable(data.checks, "Параметр") + '<div class="pmeta" style="margin-top:12px"><span>robots.txt: ' + esc(data.robotsTxt) + "</span><span>sitemap.xml: " + esc(data.sitemap) + "</span></div>"
  },
  responsive: {
    endpoint: "/api/responsive-check", button: "runResponsive", label: "Проверить адаптивность", wait: "Загружаю HTML и CSS…",
    render: data => meta(data) + checksTable(data.checks, "Проверка") + '<p class="sub">CSS-файлов найдено: ' + esc(data.stylesheetsFound) + " · проверено: " + esc(data.stylesheetsChecked) + " · медиазапросов: " + esc(data.mediaQueries) + " · изображений: " + esc(data.images) + '</p><div class="notice">' + esc(data.notice) + "</div>"
  },
  forms: {
    endpoint: "/api/forms-check", button: "runForms", label: "Проверить формы", wait: "Анализирую формы и контакты…",
    render: data => {
      const forms = data.forms.map(f => '<div class="check"><strong>Форма ' + esc(f.index) + " · " + esc(f.method.toUpperCase()) + "</strong><p>Адрес отправки: " + esc(f.endpoint) + "</p><p>Поля: " + (f.fields.length ? f.fields.map(x => esc(x.name || x.type) + (x.required ? " *" : "")).join(", ") : "Не обнаружены") + "</p></div>").join("");
      const issues = data.issues.length ? '<div class="notice">' + data.issues.map(esc).join("<br>") + "</div>" : '<p class="sub">Явные замечания по HTML-структуре не найдены.</p>';
      return meta(data) + checksTable(data.checks, "Проверка") + '<div class="checks" style="margin-top:14px">' + forms + "</div>" + issues + '<div class="notice">' + esc(data.notice) + "</div>";
    }
  },
  security: {
    endpoint: "/api/security-check", button: "runSecurity", label: "Проверить безопасность", wait: "Проверяю HTTPS, заголовки и HTML…",
    render: data => {
      const headerRows = data.headers.map(x => "<tr><td>" + esc(x.label) + '</td><td><span class="pill ' + (x.status === "ok" ? "good" : "warn") + '">' + (x.status === "ok" ? "Есть" : "Не установлен") + "</span></td><td>" + esc(x.value) + "</td></tr>").join("");
      const secrets = data.secretFindings.length ? data.secretFindings.map(x => esc(x.label) + ": " + esc(x.count)).join("; ") : "Совпадений известных шаблонов не найдено";
      return meta(data) + checksTable(data.checks, "Проверка", "Риск") + '<h3 style="font-size:14px;margin:18px 0 8px">Заголовки безопасности</h3><div class="tablewrap"><table><thead><tr><th>Заголовок</th><th>Статус</th><th>Значение</th></tr></thead><tbody>' + headerRows + '</tbody></table></div><p class="sub">Похожие на секреты строки: ' + secrets + "</p>" + (data.mixedContentExamples.length ? '<div class="notice">HTTP-ресурсы: ' + data.mixedContentExamples.map(esc).join("; ") + "</div>" : "") + '<div class="notice">' + esc(data.scope) + "</div>";
    }
  }
};

async function runDetail(key) {
  const config = DETAILS[key], url = $(key + "Url").value.trim(), out = $(key + "Result"), button = $(config.button);
  if (!url) { out.innerHTML = '<div class="notice">Укажи адрес сайта.</div>'; return; }
  button.disabled = true;
  button.textContent = "Проверяю…";
  out.innerHTML = '<div class="empty">' + config.wait + "</div>";
  try { out.innerHTML = config.render(await postJson(config.endpoint, { url })); }
  catch (error) { out.innerHTML = '<div class="notice">' + esc(error.message) + "</div>"; }
  finally { button.disabled = false; button.textContent = config.label; }
}

// ---------- События ----------

const titles = {
  overview: ["Обзор проектов", "Единая картина состояния сайтов и публикаций"],
  projects: ["Все проекты", "Реестр подключённых сайтов и репозиториев"],
  deployments: ["Сборка и публикация", "Статусы GitHub Actions по типам workflow"],
  seo: ["SEO и качество", "Технический аудит главных страниц"],
  responsive: ["Адаптивность и интерфейс", "Статический анализ HTML и CSS"],
  forms: ["Формы и заявки", "Каналы приёма обращений"],
  security: ["Безопасность", "HTTPS, заголовки и публичный HTML"],
  history: ["История проверок", "Журнал запусков проверки в этом браузере"]
};

$("nav").addEventListener("click", e => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", x === b));
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === b.dataset.view));
  $("viewTitle").textContent = titles[b.dataset.view][0];
  $("viewSub").textContent = titles[b.dataset.view][1];
});
$("refresh").addEventListener("click", refresh);
for (const key of Object.keys(DETAILS)) {
  $(DETAILS[key].button).addEventListener("click", () => runDetail(key));
  $(key + "Url").addEventListener("keydown", e => { if (e.key === "Enter") runDetail(key); });
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-detail]");
  if (!b) return;
  $(b.dataset.detail + "Url").value = b.dataset.url;
  runDetail(b.dataset.detail);
  $(b.dataset.detail + "Result").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("searchProjects").addEventListener("input", () => renderCards("allProjects", $("searchProjects").value));
$("searchOverview").addEventListener("input", () => renderCards("overviewProjects", $("searchOverview").value));
loadHistory();
refresh();
