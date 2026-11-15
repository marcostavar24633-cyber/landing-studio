// Общее ядро проверок сайта: доступность, SEO, адаптивность, формы, безопасность.
// Используется Cloudflare Pages Functions (/api/*) и часовым монитором в GitHub Actions.
// Все проверки — статический анализ HTTP-ответа и HTML главной страницы.

/** Разрешённые хостинги. Свой домен добавляется сюда отдельной строкой. */
export const ALLOWED_HOST_SUFFIXES = [
  "pages.dev", "github.io", "vercel.app", "netlify.app",
  "xn--80acmogcvipsi.xn--p1ai" // слопайбукет.рф — свой домен проекта Slopay Buket
];
export const ALLOWED_HOSTS_TEXT = "pages.dev, github.io, vercel.app, netlify.app и свои домены проектов из реестра";
const USER_AGENT = "WebProjectControlCenter/1.0 (+site-audit)";
const MAX_HTML = 1500000;

export class AuditError extends Error {
  constructor(message, status = 502, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export function isAllowedUrl(url) {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && ALLOWED_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith("." + suffix));
}

/** Разбор и проверка адреса. Бросает AuditError(400). */
export function parseAllowedUrl(raw, { allowAnyHost = false } = {}) {
  let url;
  try { url = new URL(String(raw || "")); } catch { throw new AuditError("Некорректный URL", 400); }
  if (!allowAnyHost && !isAllowedUrl(url)) throw new AuditError(`Поддерживаются только HTTPS-сайты ${ALLOWED_HOSTS_TEXT}.`, 400);
  return url;
}

/** Загрузка главной страницы. Проверяет итоговый адрес после редиректов. */
export async function loadPage(raw, { fetchImpl = fetch, timeout = 10000, allowAnyHost = false, requireHtml = true } = {}) {
  const url = parseAllowedUrl(raw, { allowAnyHost });
  const started = Date.now();
  let response;
  try {
    response = await fetchImpl(url.toString(), { redirect: "follow", signal: AbortSignal.timeout(timeout), headers: { "user-agent": USER_AGENT } });
  } catch (error) {
    throw new AuditError(error?.name === "TimeoutError" ? "Превышено время ожидания сайта." : "Сайт не отвечает.", 502, { unreachable: true, reason: error?.name === "TimeoutError" ? "timeout" : "network_error", durationMs: Date.now() - started });
  }
  const finalUrl = new URL(response.url || url.toString());
  if (!allowAnyHost && !isAllowedUrl(finalUrl)) throw new AuditError("Сайт перенаправляет на домен " + finalUrl.hostname + ", которого нет в списке разрешённых.", 422, { redirectedTo: finalUrl.hostname });
  const contentType = response.headers.get("content-type") || "";
  if (requireHtml && !contentType.includes("text/html")) throw new AuditError("Адрес не вернул HTML-страницу.", 422, { httpStatus: response.status });
  const html = (await response.text()).slice(0, MAX_HTML);
  return { url, finalUrl, response, headers: response.headers, httpStatus: response.status, ok: response.ok, html, durationMs: Date.now() - started };
}

/** Сводка по списку проверок: худший статус и счётчики. */
export function summarize(checks) {
  const count = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) if (check.status in count) count[check.status]++;
  return { status: count.fail ? "fail" : count.warn ? "warn" : "ok", ...count };
}

// ---------- SEO ----------

function textOf(html, pattern) {
  const match = html.match(pattern);
  return match ? (match[1] || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}

export function analyzeSeo(html) {
  const title = textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = textOf(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || textOf(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html) || /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i.exec(html);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const robots = /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const lang = /<html\b[^>]*\blang\s*=\s*["']?([A-Za-z-]+)/i.exec(html);
  const checks = [
    { key: "title", label: "Title", status: title ? (title.length <= 60 ? "ok" : "warn") : "fail", value: title || "Не найден" },
    { key: "description", label: "Meta description", status: description ? (description.length <= 160 ? "ok" : "warn") : "fail", value: description || "Не найден" },
    { key: "h1", label: "H1", status: h1.length === 1 ? "ok" : h1.length ? "warn" : "fail", value: h1.length ? h1.join(" | ") : "Не найден" },
    { key: "canonical", label: "Canonical", status: canonical ? "ok" : "warn", value: canonical?.[1] || "Не найден" },
    { key: "viewport", label: "Viewport", status: viewport ? "ok" : "fail", value: viewport ? "Настроен" : "Не найден" },
    { key: "robots", label: "Robots meta", status: robots ? (/noindex/i.test(robots[1]) ? "warn" : "ok") : "ok", value: robots?.[1] || "Не задан (индексация не запрещена метатегом)" },
    { key: "og", label: "Open Graph title", status: ogTitle ? "ok" : "warn", value: ogTitle ? "Есть" : "Не найден" },
    { key: "lang", label: "Язык страницы (lang)", status: lang ? "ok" : "warn", value: lang?.[1] || "Атрибут lang не указан" }
  ];
  return { title, description, h1, checks };
}

async function probe(target, fetchImpl) {
  try {
    const r = await fetchImpl(target.toString(), { signal: AbortSignal.timeout(5000), headers: { "user-agent": USER_AGENT } });
    return r.ok ? "Доступен" : "HTTP " + r.status;
  } catch { return "Недоступен"; }
}

/**
 * robots.txt действует только в корне хоста; sitemap.xml ищется рядом с сайтом
 * (важно для GitHub Pages вида user.github.io/project/), затем в корне.
 */
export async function checkIndexFiles(finalUrl, fetchImpl = fetch) {
  const robotsTxt = await probe(new URL("/robots.txt", finalUrl), fetchImpl);
  let sitemap = await probe(new URL("sitemap.xml", finalUrl), fetchImpl);
  const rootSitemap = new URL("/sitemap.xml", finalUrl);
  if (sitemap !== "Доступен" && rootSitemap.toString() !== new URL("sitemap.xml", finalUrl).toString()) {
    const atRoot = await probe(rootSitemap, fetchImpl);
    if (atRoot === "Доступен") sitemap = atRoot;
  }
  return { robotsTxt, sitemap };
}

// ---------- Адаптивность ----------

export async function loadStyles(html, finalUrl, fetchImpl = fetch) {
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  const files = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).filter(x => /rel=["']?stylesheet["']?/i.test(x)).map(x => /href=["']([^"']+)["']/i.exec(x)?.[1]).filter(Boolean);
  const styles = [...inline];
  let loaded = 0;
  for (const href of files.slice(0, 8)) {
    try {
      const cssUrl = new URL(href, finalUrl);
      if (cssUrl.origin !== finalUrl.origin) continue;
      const r = await fetchImpl(cssUrl.toString(), { signal: AbortSignal.timeout(5000), headers: { "user-agent": USER_AGENT } });
      if (r.ok) { styles.push((await r.text()).slice(0, 300000)); loaded++; }
    } catch { /* стиль недоступен — пропускаем */ }
  }
  return { css: styles.join("\n"), found: files.length, loaded };
}

export function analyzeResponsive(html, css) {
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const imagesWithAlt = imageTags.filter(x => /\balt\s*=/i.test(x)).length;
  const media = (css.match(/@media\s*[^{]*\(/gi) || []).length;
  const imgResponsive = /img[^{}]*\{[^}]*(?:max-)?width\s*:\s*100%/is.test(css);
  const fixedWidth = [...css.matchAll(/(?:^|[;{\s])(?:width|min-width)\s*:\s*(\d{4,})px/gi)].map(m => m[0].replace(/^[;{\s]+/, "")).slice(0, 6);
  const checks = [
    { label: "Viewport для мобильных устройств", status: viewport ? "ok" : "fail", value: viewport ? "Мета-тег viewport найден" : "Мета-тег viewport отсутствует" },
    { label: "Медиазапросы CSS", status: media > 0 ? "ok" : "warn", value: media ? ("Найдено: " + media) : "Медиазапросы не обнаружены в проверенных стилях" },
    { label: "Адаптивность изображений", status: imgResponsive || imageTags.length === 0 ? "ok" : "warn", value: imgResponsive ? "Найдено правило max-width/width для img" : imageTags.length ? "Общее правило для img не обнаружено" : "Изображения img не используются" },
    { label: "Потенциально большие фиксированные ширины", status: fixedWidth.length ? "warn" : "ok", value: fixedWidth.length ? fixedWidth.join(", ") : "Не обнаружены простые шаблоны ширины от 1000px" },
    { label: "Атрибуты alt у изображений", status: imageTags.length === 0 || imagesWithAlt === imageTags.length ? "ok" : "warn", value: imageTags.length ? imagesWithAlt + " из " + imageTags.length + " изображений имеют alt" : "Изображения img не найдены" }
  ];
  return { checks, mediaQueries: media, images: imageTags.length, imagesWithAlt };
}

// ---------- Формы ----------

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

export function analyzeForms(html, base) {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)].slice(0, 30).map((match, index) => {
    const source = match[0], opening = /<form\b[^>]*>/i.exec(source)?.[0] || "<form>", action = attr(opening, "action"), method = (attr(opening, "method") || "get").toLowerCase();
    const fields = [...source.matchAll(/<(input|textarea|select)\b[^>]*>/gi)].map(m => {
      const tag = m[0], type = (attr(tag, "type") || m[1]).toLowerCase(), id = attr(tag, "id");
      return { type, name: attr(tag, "name"), required: /\brequired(?:\s|=|\/?>)/i.test(tag), hasLabel: !!id && new RegExp("<label\\b[^>]*\\bfor\\s*=\\s*['\"]" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "['\"][^>]*>", "i").test(source) };
    }).filter(field => !["hidden", "submit", "button"].includes(field.type));
    let endpoint = "";
    try { endpoint = action ? new URL(action, base).toString() : base.toString(); } catch { endpoint = "invalid"; }
    const hasSubmit = /<button\b(?![^>]*type\s*=\s*['"]?(?:button|reset))[^>]*>|<input\b[^>]*type\s*=\s*['"]?submit/i.test(source);
    return { index: index + 1, method, action: action || "(не указан; отправка на текущую страницу)", endpoint, fields, hasSubmit, hasConsent: /consent|privacy|соглас|персональн/i.test(source) };
  });
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>/gi)].map(m => m[1]);
  const tel = anchors.filter(x => /^tel:/i.test(x)).length, email = anchors.filter(x => /^mailto:/i.test(x)).length, messengers = anchors.filter(x => /wa\.me|api\.whatsapp\.com|t\.me|telegram\.me|viber:|vk\.me|max\.ru/i.test(x)).length;
  const issues = [];
  for (const f of forms) {
    if (!f.fields.length) issues.push("Форма " + f.index + ": поля не обнаружены или форма создаётся JavaScript.");
    if (!f.hasSubmit) issues.push("Форма " + f.index + ": кнопка отправки не найдена в HTML.");
    if (f.fields.length && !f.fields.some(x => x.required)) issues.push("Форма " + f.index + ": нет обязательных полей.");
    if (!f.hasConsent) issues.push("Форма " + f.index + ": не обнаружен признак согласия/политики.");
    if (f.method === "get" && f.fields.length) issues.push("Форма " + f.index + ": используется GET — проверьте передачу персональных данных в URL.");
    if (f.endpoint === "invalid") issues.push("Форма " + f.index + ": некорректный action.");
    if (f.endpoint.startsWith("http:")) issues.push("Форма " + f.index + ": отправка по незащищённому HTTP.");
  }
  const contacts = tel + email + messengers;
  const insecure = forms.some(f => f.endpoint.startsWith("http:") || f.endpoint === "invalid");
  // Канал связи обязателен; отдельные каналы (телефон, почта, мессенджер) взаимозаменяемы.
  const channel = (n, label) => ({ label, status: n || contacts || forms.length ? "ok" : "warn", value: "Найдено: " + n });
  const checks = [
    // Предупреждение, а не ошибка: форма или кнопки связи могут создаваться скриптом и не попасть в HTML.
    { label: "Способ связи", status: forms.length || contacts ? "ok" : "warn", value: forms.length || contacts ? "Форм: " + forms.length + ", контактных ссылок: " + contacts : "В HTML нет ни формы, ни ссылок tel/mailto/мессенджеров (возможно, создаются скриптом)" },
    { label: "Формы на странице", status: forms.length || contacts ? "ok" : "warn", value: "Найдено: " + forms.length },
    { label: "Адрес отправки", status: insecure ? "fail" : "ok", value: insecure ? "Есть форма с HTTP или некорректным action" : forms.length ? "Все формы отправляются по HTTPS" : "Форм нет" },
    { label: "Обязательные поля", status: !forms.length || forms.some(f => f.fields.some(x => x.required)) ? "ok" : "warn", value: forms.reduce((n, f) => n + f.fields.filter(x => x.required).length, 0) + " обязательных полей" },
    { label: "Кнопки отправки", status: forms.every(f => f.hasSubmit) ? "ok" : "warn", value: forms.filter(f => f.hasSubmit).length + " из " + forms.length + " форм" },
    { label: "Согласие / политика", status: forms.every(f => f.hasConsent) ? "ok" : "warn", value: forms.filter(f => f.hasConsent).length + " из " + forms.length + " форм" },
    channel(tel, "Телефонные ссылки"),
    channel(email, "Email-ссылки"),
    channel(messengers, "Ссылки мессенджеров")
  ];
  return { forms, checks, issues, contacts: { tel, email, messengers } };
}

// ---------- Безопасность ----------

const SECRET_PATTERNS = [
  { label: "Похоже на OpenAI API key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: "Похоже на GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { label: "Похоже на AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "Похоже на токен Telegram-бота", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{32,}\b/g },
  { label: "Похоже на приватный ключ", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

export function analyzeSecurity(html, headers, finalUrl) {
  const metaCsp = /<meta[^>]+http-equiv=["']?content-security-policy["']?/i.test(html);
  const headerChecks = [
    ["Strict-Transport-Security", "HSTS", true],
    ["Content-Security-Policy", "CSP", true],
    ["X-Content-Type-Options", "X-Content-Type-Options", true],
    ["Referrer-Policy", "Referrer-Policy", true],
    ["Permissions-Policy", "Permissions-Policy", false]
  ].map(([key, label, important]) => {
    const value = headers.get(key);
    if (!value && key === "Content-Security-Policy" && metaCsp) return { label, status: "ok", value: "Задан через meta http-equiv" };
    return { label, status: value ? "ok" : important ? "warn" : "info", value: value || "Не установлен" };
  });
  const mixed = [...html.matchAll(/<(?:script|img|iframe|link|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi)].map(m => m[1]);
  const findings = [];
  for (const item of SECRET_PATTERNS) { const count = (html.match(item.re) || []).length; if (count) findings.push({ label: item.label, count }); }
  const https = finalUrl.protocol === "https:";
  const blankLinks = [...html.matchAll(/<a\b[^>]*target\s*=\s*["']?_blank[^>]*>/gi)].map(m => m[0]);
  const unsafeBlank = blankLinks.filter(tag => !/\brel\s*=\s*["'][^"']*(?:noopener|noreferrer)/i.test(tag)).length;
  const checks = [
    { label: "HTTPS", status: https ? "ok" : "fail", value: https ? "Страница загружена по HTTPS" : "Итоговый URL не HTTPS" },
    { label: "HTTP security headers", status: headerChecks.some(x => x.status === "warn") ? "warn" : "ok", value: headerChecks.filter(x => x.status === "ok").length + " из 5 заголовков присутствуют" },
    { label: "Смешанный HTTP-контент", status: mixed.length ? "warn" : "ok", value: mixed.length ? "Найдено HTTP-ресурсов: " + mixed.length : "HTTP-ресурсы (скрипты, стили, медиа) не обнаружены" },
    { label: "Ссылки target=_blank", status: unsafeBlank ? "warn" : "ok", value: unsafeBlank ? unsafeBlank + " без rel=noopener" : "Все внешние окна открываются с noopener" },
    { label: "Публичные секреты в HTML", status: findings.length ? "fail" : "ok", value: findings.length ? "Найдены строки, похожие на секреты — значения скрыты" : "Известные шаблоны ключей не обнаружены" }
  ];
  return { checks, headers: headerChecks, mixedContentCount: mixed.length, mixedContentExamples: mixed.slice(0, 5).map(x => x.slice(0, 180)), secretFindings: findings };
}

// ---------- Полный аудит одного сайта ----------

export const SECTION_LABELS = { seo: "SEO", responsive: "Адаптивность", forms: "Формы", security: "Безопасность" };

/**
 * Полная проверка сайта одним вызовом. Никогда не бросает исключение:
 * недоступный сайт возвращается как availability.status !== "online".
 */
export async function auditSite(raw, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const checkedAt = new Date().toISOString();
  let page;
  try {
    page = await loadPage(raw, { ...options, fetchImpl, requireHtml: false });
  } catch (error) {
    const status = error?.extra?.unreachable ? "unreachable" : error?.status === 400 || error?.extra?.redirectedTo ? "not_allowed" : "error";
    return { url: String(raw || ""), availability: { status, error: error?.message || "Ошибка проверки", durationMs: error?.extra?.durationMs ?? null }, sections: null, checkedAt };
  }
  const availability = { status: page.ok ? "online" : "http_error", httpStatus: page.httpStatus, durationMs: page.durationMs };
  const result = { url: page.finalUrl.toString(), availability, sections: null, checkedAt };
  if (!page.ok || !(page.headers.get("content-type") || "").includes("text/html")) return result;

  const seo = analyzeSeo(page.html);
  const index = await checkIndexFiles(page.finalUrl, fetchImpl);
  seo.checks.push(
    { key: "robotsTxt", label: "robots.txt", status: index.robotsTxt === "Доступен" ? "ok" : "warn", value: index.robotsTxt },
    { key: "sitemap", label: "sitemap.xml", status: index.sitemap === "Доступен" ? "ok" : "warn", value: index.sitemap }
  );
  const styles = await loadStyles(page.html, page.finalUrl, fetchImpl);
  const responsive = analyzeResponsive(page.html, styles.css);
  const forms = analyzeForms(page.html, page.finalUrl);
  const security = analyzeSecurity(page.html, page.headers, page.finalUrl);
  const section = (data, extra = {}) => ({ ...summarize(data.checks), checks: data.checks, ...extra });
  result.sections = {
    seo: section(seo, { title: seo.title }),
    responsive: section(responsive),
    forms: section(forms, { formsFound: forms.forms.length, issues: forms.issues }),
    security: section(security, { secretFindings: security.secretFindings })
  };
  return result;
}

/** Ответ JSON для Cloudflare Pages Functions. */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** Единая обработка ошибок в функциях /api/*. */
export function errorResponse(error, fallback) {
  if (error instanceof AuditError) return jsonResponse({ error: error.message, ...(error.extra?.httpStatus ? { httpStatus: error.extra.httpStatus } : {}) }, error.status);
  return jsonResponse({ error: fallback }, 502);
}
