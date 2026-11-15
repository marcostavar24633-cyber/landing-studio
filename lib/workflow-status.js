// Общая логика статусов GitHub Actions для панели (браузер) и монитора (Node).
// Главное правило: «проверка качества» и «публикация» — два независимых сигнала.
// Упавший линтер не означает, что сайт не опубликован, и наоборот.

// Слова ищутся целиком: «latest» не должно считаться «test», «checkout» — «check».
const QUALITY_RE = /(?<![a-z])(?:quality|tests?|lint(?:er|ing)?|audit|checks?|validat(?:e|ion)|monitor|health|lighthouse|a11y|ci|qa|e2e)(?![a-z])/i;
const DEPLOY_RE = /(?<![a-z])(?:pages[-\s]build|deploy(?:ment|s)?|publish|release|gh-pages|pages)(?![a-z])/i;

/** Тип workflow: "quality" | "deploy" | "service". Качество имеет приоритет над публикацией. */
export function classifyWorkflow(run) {
  const text = `${run?.name || ""} ${run?.path || ""}`;
  if (QUALITY_RE.test(text)) return "quality";
  if (DEPLOY_RE.test(text)) return "deploy";
  return "service";
}

/** Состояние запуска: "success" | "failure" | "running" | "cancelled" | "neutral" | "none". */
export function runState(run) {
  if (!run) return "none";
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "startup_failure") return "failure";
  if (run.conclusion === "cancelled") return "cancelled";
  return "neutral";
}

/** Последний запуск каждого workflow (по времени обновления). */
export function latestByWorkflow(runs) {
  const sorted = [...(runs || [])].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const map = new Map();
  for (const run of sorted) {
    const key = String(run.workflow_id || run.name || run.id);
    if (!map.has(key)) map.set(key, run);
  }
  return [...map.values()];
}

// Худшее состояние группы: ошибка важнее «выполняется», «выполняется» важнее успеха.
const SEVERITY = { failure: 5, running: 4, cancelled: 3, success: 2, neutral: 1, none: 0 };

function pickGroup(latest, kind) {
  const runs = latest.filter(run => classifyWorkflow(run) === kind);
  let worst = null;
  for (const run of runs) {
    if (!worst || SEVERITY[runState(run)] > SEVERITY[runState(worst)]) worst = run;
  }
  return { run: worst, state: runState(worst), runs };
}

/**
 * Раздельные статусы проекта.
 * Сначала берутся запуски основной ветки; если по типу их нет — последние запуски любых веток.
 */
export function splitStatuses(runs, defaultBranch) {
  const all = latestByWorkflow(runs);
  const main = latestByWorkflow((runs || []).filter(run => !defaultBranch || run.head_branch === defaultBranch));
  const result = {};
  for (const kind of ["quality", "deploy"]) {
    const primary = pickGroup(main, kind);
    result[kind] = primary.run ? { ...primary, fallbackBranch: false } : { ...pickGroup(all, kind), fallbackBranch: true };
  }
  result.workflows = all;
  result.latest = all[0] || null;
  return result;
}

export const QUALITY_LABELS = { success: "Успешно", failure: "Есть замечания", running: "Выполняется", cancelled: "Отменён", neutral: "Пропущен", none: "Нет проверок" };
export const DEPLOY_LABELS = { success: "Опубликовано", failure: "Ошибка публикации", running: "Публикуется", cancelled: "Отменена", neutral: "Пропущена", none: "Нет данных" };

/** Адрес сайта: явный из реестра → homepage репозитория → GitHub Pages. */
export function resolveSiteUrl(project, meta, owner) {
  if (project?.url) return { url: project.url, source: "реестр" };
  const homepage = String(meta?.homepage || "").trim();
  if (/^https:\/\//i.test(homepage)) return { url: homepage, source: "homepage репозитория" };
  if (meta?.has_pages) return { url: `https://${String(owner).toLowerCase()}.github.io/${project.repo}/`, source: "GitHub Pages" };
  return { url: "", source: "" };
}

/**
 * Итог по проекту. Публикация и доступность сайта — критичные сигналы,
 * качество и аудит — предупреждения.
 */
export function overallStatus({ error, deployState, qualityState, site, audit }) {
  if (error) return { level: "warn", label: "Нет данных", reason: error };
  if (deployState === "failure") return { level: "bad", label: "Критично", reason: "Ошибка публикации" };
  if (site && (site.status === "unreachable" || site.status === "http_error")) return { level: "bad", label: "Критично", reason: "Сайт недоступен" };
  if (audit?.sections?.security?.status === "fail") return { level: "bad", label: "Критично", reason: "Риск безопасности" };
  const failed = audit ? Object.entries(audit.sections || {}).filter(([, s]) => s.status === "fail").map(([k]) => k) : [];
  if (qualityState === "failure") return { level: "warn", label: "Требует внимания", reason: "Проверка качества не пройдена" };
  if (failed.length) return { level: "warn", label: "Требует внимания", reason: "Проблемы аудита: " + failed.join(", ") };
  if (!site) return { level: "warn", label: "Неполные данные", reason: "Адрес сайта не найден" };
  if (site.status !== "online") return { level: "warn", label: "Неполные данные", reason: "Сайт не удалось проверить" };
  if (deployState === "none") return { level: "warn", label: "Неполные данные", reason: "Нет запусков публикации" };
  if (deployState === "running") return { level: "warn", label: "Публикуется", reason: "Публикация выполняется" };
  return { level: "good", label: "Рабочий статус", reason: "Публикация успешна, сайт доступен" };
}
