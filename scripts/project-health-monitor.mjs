#!/usr/bin/env node
// Сводный монитор проектов из projects.json.
// Для каждого проекта отдельно считает: проверку качества (CI), публикацию (CI),
// доступность сайта и аудит SEO / адаптивности / форм / безопасности.
// Критичные сигналы (публикация, доступность) завершают запуск ошибкой;
// замечания качества и аудита — только предупреждения и Issues.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditSite, SECTION_LABELS } from "../lib/site-audit.js";
import { splitStatuses, latestByWorkflow, classifyWorkflow, runState, resolveSiteUrl, overallStatus, QUALITY_LABELS, DEPLOY_LABELS } from "../lib/workflow-status.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF_WORKFLOW = ".github/workflows/project-health-monitor.yml";
const ICON = { success: "🟢", failure: "🔴", running: "🟡", cancelled: "⚪", neutral: "⚪", none: "⚪", ok: "🟢", warn: "🟡", fail: "🔴", good: "🟢", bad: "🔴" };
const KIND_TITLE = { deploy: "Публикация", quality: "Качество", service: "CI" };

export async function run({ fetchImpl = fetch, env = process.env, registry, log = console.log } = {}) {
  registry ||= JSON.parse(fs.readFileSync(path.join(ROOT, "projects.json"), "utf8"));
  const owner = registry.owner;
  const [issueOwner, issueRepo] = String(env.GITHUB_REPOSITORY || `${owner}/landing-studio`).split("/");
  const dryRun = env.MONITOR_DRY_RUN === "1" || !env.GITHUB_TOKEN;

  async function gh(apiPath, { method = "GET", body } = {}) {
    const response = await fetchImpl("https://api.github.com" + apiPath, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Landing-Studio-Project-Monitor",
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status} (${method} ${apiPath.split("?")[0]})`);
    return response.json();
  }

  // Открытые уведомления монитора — один раз на весь запуск.
  let openIssues = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const batch = await gh(`/repos/${issueOwner}/${issueRepo}/issues?state=open&per_page=100&page=${page}`);
      openIssues.push(...batch.filter(issue => !issue.pull_request));
      if (batch.length < 100) break;
    }
  } catch (error) {
    log(`::warning::Не удалось получить список Issues: ${error.message}`);
  }

  const issueActions = [];
  async function syncIssue({ marker, title, body, failing, okComment }) {
    const existing = openIssues.find(issue => issue.body?.includes(marker));
    if (failing) {
      issueActions.push({ action: existing ? "update" : "create", title });
      if (dryRun) return;
      if (existing) await gh(`/repos/${issueOwner}/${issueRepo}/issues/${existing.number}`, { method: "PATCH", body: { title, body, state: "open" } });
      else await gh(`/repos/${issueOwner}/${issueRepo}/issues`, { method: "POST", body: { title, body } });
    } else if (existing) {
      issueActions.push({ action: "close", title: existing.title });
      if (dryRun) return;
      await gh(`/repos/${issueOwner}/${issueRepo}/issues/${existing.number}/comments`, { method: "POST", body: { body: okComment } });
      await gh(`/repos/${issueOwner}/${issueRepo}/issues/${existing.number}`, { method: "PATCH", body: { state: "closed" } });
    }
  }

  const projects = await Promise.all(registry.projects.map(async project => {
    const fullName = `${owner}/${project.repo}`;
    const item = { project, fullName };
    try {
      const [meta, payload] = await Promise.all([
        gh(`/repos/${fullName}`),
        gh(`/repos/${fullName}/actions/runs?per_page=100`)
      ]);
      const defaultBranch = project.branch || meta.default_branch || "main";
      const runs = (payload.workflow_runs || []).filter(r => !(fullName === `${issueOwner}/${issueRepo}` && r.path === SELF_WORKFLOW));
      Object.assign(item, { defaultBranch, statuses: splitStatuses(runs, defaultBranch), mainWorkflows: latestByWorkflow(runs.filter(r => r.head_branch === defaultBranch)) });
      const site = resolveSiteUrl(project, meta, owner);
      item.siteUrl = site.url;
      item.siteSource = site.source;
      if (site.url) item.audit = await auditSite(site.url, { fetchImpl, allowAnyHost: true });
    } catch (error) {
      item.error = error.message;
    }
    item.overall = overallStatus({
      error: item.error,
      deployState: item.statuses?.deploy.state,
      qualityState: item.statuses?.quality.state,
      site: item.siteUrl ? item.audit?.availability : null,
      audit: item.audit
    });
    return item;
  }));

  // Issues: по одному на упавший workflow основной ветки и на недоступный сайт.
  for (const item of projects) {
    if (item.error) continue;
    const projectMarker = `<!-- monitored-project:${item.fullName} -->`;
    for (const latest of item.mainWorkflows) {
      const state = runState(latest);
      if (state !== "failure" && state !== "success") continue;
      const kind = classifyWorkflow(latest);
      const workflowName = latest.name || `workflow ${latest.workflow_id || "unknown"}`;
      const marker = `<!-- monitored-workflow:${item.fullName}:${latest.workflow_id || workflowName} -->`;
      try {
        await syncIssue({
          marker,
          failing: state === "failure",
          title: `[${KIND_TITLE[kind]}] ${item.fullName} — ${workflowName}`,
          body: [
            kind === "deploy" ? "Монитор обнаружил ошибку **публикации**: сайт может быть не обновлён." : kind === "quality" ? "Монитор обнаружил непройденную **проверку качества**. На публикацию сайта это само по себе не влияет." : "Монитор обнаружил неуспешный служебный запуск GitHub Actions.",
            "",
            `- Репозиторий: [${item.fullName}](https://github.com/${item.fullName})`,
            `- Тип: ${KIND_TITLE[kind]}`,
            `- Ветка: ${latest.head_branch || item.defaultBranch}`,
            `- Workflow: ${workflowName}`,
            `- Результат: ${latest.conclusion}`,
            `- Завершён: ${latest.updated_at}`,
            `- Запуск: [Открыть GitHub Actions](${latest.html_url})`,
            "",
            "Issue обновляется при каждом новом неуспешном запуске этого workflow и закрывается после успешного запуска.",
            "",
            projectMarker,
            marker
          ].join("\n"),
          okComment: `Обнаружен успешный запуск [${workflowName}](${latest.html_url}). Уведомление закрыто автоматически.`
        });
      } catch (error) { log(`::warning::${item.fullName}: не удалось обновить Issue — ${error.message}`); }
    }
    if (item.siteUrl && item.audit) {
      const availability = item.audit.availability;
      const down = availability.status === "unreachable" || availability.status === "http_error";
      try {
        if (down || availability.status === "online") await syncIssue({
          marker: `<!-- monitored-site:${item.fullName} -->`,
          failing: down,
          title: `[Сайт] ${item.fullName} — недоступен`,
          body: [
            "Монитор не смог открыть опубликованный сайт.",
            "",
            `- Адрес: ${item.siteUrl}`,
            `- Результат: ${availability.httpStatus ? "HTTP " + availability.httpStatus : availability.error || availability.status}`,
            `- Проверено: ${item.audit.checkedAt}`,
            "",
            "Issue закрывается автоматически, когда сайт снова отвечает.",
            "",
            projectMarker,
            `<!-- monitored-site:${item.fullName} -->`
          ].join("\n"),
          okComment: `Сайт ${item.siteUrl} снова доступен (HTTP ${availability.httpStatus}). Уведомление закрыто автоматически.`
        });
      } catch (error) { log(`::warning::${item.fullName}: не удалось обновить Issue сайта — ${error.message}`); }
    }
  }

  const critical = [], warnings = [];
  for (const item of projects) {
    if (item.error) { critical.push(`${item.fullName}: ${item.error}`); continue; }
    if (item.statuses.deploy.state === "failure") critical.push(`${item.fullName}: ошибка публикации (${item.statuses.deploy.run.name})`);
    const availability = item.audit?.availability;
    if (availability && (availability.status === "unreachable" || availability.status === "http_error")) critical.push(`${item.fullName}: сайт недоступен (${item.siteUrl})`);
    if (item.statuses.quality.state === "failure") warnings.push(`${item.fullName}: проверка качества не пройдена (${item.statuses.quality.run.name})`);
    for (const [key, section] of Object.entries(item.audit?.sections || {})) {
      const failed = section.checks.filter(check => check.status === "fail").map(check => check.label);
      if (failed.length) (key === "security" ? critical : warnings).push(`${item.fullName}: ${SECTION_LABELS[key]} — ${failed.join(", ")}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      projects: projects.length,
      deployed: projects.filter(p => p.statuses?.deploy.state === "success").length,
      deployFailures: projects.filter(p => p.statuses?.deploy.state === "failure").length,
      qualityFailures: projects.filter(p => p.statuses?.quality.state === "failure").length,
      sitesKnown: projects.filter(p => p.siteUrl).length,
      sitesOnline: projects.filter(p => p.audit?.availability.status === "online").length
    },
    critical, warnings, issueActions,
    projects: projects.map(p => ({
      repo: p.fullName, name: p.project.name, error: p.error || null, overall: p.overall,
      quality: p.statuses ? { state: p.statuses.quality.state, workflow: p.statuses.quality.run?.name || null, url: p.statuses.quality.run?.html_url || null } : null,
      deploy: p.statuses ? { state: p.statuses.deploy.state, workflow: p.statuses.deploy.run?.name || null, url: p.statuses.deploy.run?.html_url || null } : null,
      site: p.siteUrl ? { url: p.siteUrl, source: p.siteSource, ...p.audit?.availability } : null,
      audit: p.audit?.sections || null
    }))
  };

  const markdown = renderMarkdown(projects, report);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  if (env.MONITOR_REPORT) fs.writeFileSync(env.MONITOR_REPORT, JSON.stringify(report, null, 2));
  for (const line of warnings) log(`::warning::${line}`);
  for (const line of critical) log(`::error::${line}`);
  return { report, markdown, failed: critical.length > 0 };
}

function cell(text) { return String(text).replace(/\|/g, "\\|").replace(/\n/g, " "); }

function renderMarkdown(projects, report) {
  const t = report.totals;
  const sectionCell = section => section ? `${ICON[section.status]} ${section.ok}/${section.ok + section.warn + section.fail}` : "—";
  const rows = projects.map(p => {
    if (p.error) return `| ${cell(p.project.name)} | — | — | — | — | — | — | — | 🔴 ${cell(p.error)} |`;
    const q = p.statuses.quality, d = p.statuses.deploy, a = p.audit?.availability;
    const link = (group, labels) => `${ICON[group.state]} ${group.run ? `[${labels[group.state]}](${group.run.html_url})` : labels[group.state]}`;
    const site = !p.siteUrl ? "⚪ URL не найден" : a?.status === "online" ? `🟢 [HTTP ${a.httpStatus}](${p.siteUrl}) · ${a.durationMs} мс` : `🔴 [${cell(a?.httpStatus ? "HTTP " + a.httpStatus : a?.error || "нет ответа")}](${p.siteUrl})`;
    const s = p.audit?.sections;
    return `| ${cell(p.project.name)} | ${link(q, QUALITY_LABELS)} | ${link(d, DEPLOY_LABELS)} | ${site} | ${sectionCell(s?.seo)} | ${sectionCell(s?.responsive)} | ${sectionCell(s?.forms)} | ${sectionCell(s?.security)} | ${ICON[p.overall.level]} ${cell(p.overall.label)} |`;
  });
  const list = (title, items) => items.length ? `\n### ${title}\n\n${items.map(x => `- ${x}`).join("\n")}\n` : "";
  return [
    "## Сводный мониторинг проектов",
    "",
    `Проектов: **${t.projects}** · опубликовано успешно: **${t.deployed}** · ошибок публикации: **${t.deployFailures}** · замечаний качества: **${t.qualityFailures}** · сайтов доступно: **${t.sitesOnline}/${t.sitesKnown}**`,
    "",
    "| Проект | Качество | Публикация | Сайт | SEO | Адаптивность | Формы | Безопасность | Итог |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    list("Критично", report.critical),
    list("Требует внимания", report.warnings),
    "",
    "Качество и публикация считаются раздельно по последним запускам workflow основной ветки. Числа в колонках аудита — пройдено проверок из общего числа; это статический анализ главной страницы, а не Lighthouse.",
    ""
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(result => {
    console.log(`Проверено проектов: ${result.report.totals.projects}; критичных сигналов: ${result.report.critical.length}; предупреждений: ${result.report.warnings.length}.`);
    if (result.failed) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
