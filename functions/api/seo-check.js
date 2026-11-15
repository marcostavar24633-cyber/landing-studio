function esc(value) { return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function extract(html, pattern) { const match = html.match(pattern); return match ? (match[1] || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : ""; }
export async function onRequestPost(context) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  try {
    const body = await context.request.json();
    const raw = String(body?.url || "");
    let url;
    try { url = new URL(raw); } catch { return new Response(JSON.stringify({ error: "Некорректный URL" }), { status: 400, headers }); }
    const host = url.hostname.toLowerCase();
    const allowed = url.protocol === "https:" && (host.endsWith(".pages.dev") || host.endsWith(".github.io"));
    if (!allowed) return new Response(JSON.stringify({ error: "Пока поддерживаются только HTTPS-сайты pages.dev и github.io." }), { status: 400, headers });
    const response = await fetch(url.toString(), { redirect: "follow", signal: AbortSignal.timeout(10000), headers: { "user-agent": "WebProjectControlCenter/1.0 SEO-audit" } });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return new Response(JSON.stringify({ error: "Адрес не вернул HTML-страницу.", httpStatus: response.status }), { status: 422, headers });
    const html = (await response.text()).slice(0, 1500000);
    const title = extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = extract(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || extract(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
    const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => extract(m[0], /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
    const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html) || /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i.exec(html);
    const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    const robots = /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i.exec(html);
    const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
    const checks = [
      { key:"title", label:"Title", status:title ? (title.length <= 60 ? "ok" : "warn") : "fail", value:title || "Не найден" },
      { key:"description", label:"Meta description", status:description ? (description.length <= 160 ? "ok" : "warn") : "fail", value:description || "Не найден" },
      { key:"h1", label:"H1", status:h1.length === 1 ? "ok" : h1.length ? "warn" : "fail", value:h1.length ? h1.join(" | ") : "Не найден" },
      { key:"canonical", label:"Canonical", status:canonical ? "ok" : "warn", value:canonical?.[1] || "Не найден" },
      { key:"viewport", label:"Viewport", status:viewport ? "ok" : "fail", value:viewport ? "Настроен" : "Не найден" },
      { key:"robots", label:"Robots meta", status:robots ? (/noindex/i.test(robots[1]) ? "warn" : "ok") : "ok", value:robots?.[1] || "Не задан (индексация не запрещена метатегом)" },
      { key:"og", label:"Open Graph title", status:ogTitle ? "ok" : "warn", value:ogTitle ? "Есть" : "Не найден" }
    ];
    let robotsTxt = "Не проверен", sitemap = "Не проверен";
    try { const r = await fetch(new URL("/robots.txt", url), { signal: AbortSignal.timeout(5000) }); robotsTxt = r.ok ? "Доступен" : "HTTP " + r.status; } catch { robotsTxt = "Недоступен"; }
    try { const r = await fetch(new URL("/sitemap.xml", url), { signal: AbortSignal.timeout(5000) }); sitemap = r.ok ? "Доступен" : "HTTP " + r.status; } catch { sitemap = "Недоступен"; }
    return new Response(JSON.stringify({ url: response.url, httpStatus: response.status, title, description, h1, checks, robotsTxt, sitemap, checkedAt: new Date().toISOString() }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.name === "TimeoutError" ? "Превышено время ожидания сайта." : "Не удалось выполнить SEO-проверку." }), { status: 502, headers });
  }
}
