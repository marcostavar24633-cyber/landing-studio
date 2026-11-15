export async function onRequestPost(context) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  try {
    const body = await context.request.json();
    const urls = Array.isArray(body?.urls) ? body.urls.slice(0, 20) : [];
    const results = await Promise.all(urls.map(async (raw) => {
      let url;
      try { url = new URL(String(raw)); } catch { return { url: String(raw), status: "invalid" }; }
      const host = url.hostname.toLowerCase();
      const allowed = url.protocol === "https:" && (host.endsWith(".pages.dev") || host === "pages.dev" || host.endsWith(".github.io") || host === "github.io");
      if (!allowed) return { url: url.origin, status: "not_allowed" };
      const started = Date.now();
      try {
        let response = await fetch(url.toString(), { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
        if (response.status === 405 || response.status === 501) response = await fetch(url.toString(), { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
        return { url: url.origin, status: response.ok ? "online" : "http_error", httpStatus: response.status, durationMs: Date.now() - started };
      } catch (error) {
        return { url: url.origin, status: "unreachable", error: error?.name === "TimeoutError" ? "timeout" : "network_error", durationMs: Date.now() - started };
      }
    }));
    return new Response(JSON.stringify({ results, checkedAt: new Date().toISOString() }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers });
  }
}
