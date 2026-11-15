// Cloudflare Pages Function: POST /api/site-audit — полный аудит одного сайта
// (доступность, SEO, адаптивность, формы, безопасность) для сводной таблицы панели.
import { auditSite, jsonResponse } from "../../lib/site-audit.js";

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return jsonResponse({ error: "Некорректный JSON запроса." }, 400); }
  return jsonResponse(await auditSite(body?.url));
}
