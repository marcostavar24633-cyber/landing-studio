// Cloudflare Pages Function: POST /api/security-check
import { loadPage, analyzeSecurity, errorResponse, jsonResponse } from "../../lib/site-audit.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const page = await loadPage(body?.url, { requireHtml: false });
    const result = analyzeSecurity(page.html, page.headers, page.finalUrl);
    return jsonResponse({ url: page.finalUrl.toString(), httpStatus: page.httpStatus, ...result, checkedAt: new Date().toISOString(), scope: "Проверены HTTP-ответ и HTML главной страницы. Не проверены TLS-цепочка, исходный GitHub-репозиторий, npm-зависимости, workflow permissions и скрытые API-ответы. Совпадение шаблона секрета требует ручной проверки; значения не раскрываются." });
  } catch (error) {
    return errorResponse(error, "Не удалось выполнить проверку безопасности.");
  }
}
