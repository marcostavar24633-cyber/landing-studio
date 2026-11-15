// Cloudflare Pages Function: POST /api/site-check — быстрая проверка доступности списка адресов.
import { isAllowedUrl, jsonResponse } from "../../lib/site-audit.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const urls = Array.isArray(body?.urls) ? body.urls.slice(0, 20) : [];
    const results = await Promise.all(urls.map(async (raw) => {
      let url;
      try { url = new URL(String(raw)); } catch { return { url: String(raw), status: "invalid" }; }
      if (!isAllowedUrl(url)) return { url: url.origin, status: "not_allowed" };
      const started = Date.now();
      try {
        let response = await fetch(url.toString(), { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
        if (response.status === 405 || response.status === 501) response = await fetch(url.toString(), { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
        return { url: url.origin, status: response.ok ? "online" : "http_error", httpStatus: response.status, durationMs: Date.now() - started };
      } catch (error) {
        return { url: url.origin, status: "unreachable", error: error?.name === "TimeoutError" ? "timeout" : "network_error", durationMs: Date.now() - started };
      }
    }));
    return jsonResponse({ results, checkedAt: new Date().toISOString() });
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
}
