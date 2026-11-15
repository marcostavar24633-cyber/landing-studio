// Cloudflare Pages Function: POST /api/seo-check
import { loadPage, analyzeSeo, checkIndexFiles, errorResponse, jsonResponse } from "../../lib/site-audit.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const page = await loadPage(body?.url);
    const seo = analyzeSeo(page.html);
    const index = await checkIndexFiles(page.finalUrl);
    return jsonResponse({ url: page.finalUrl.toString(), httpStatus: page.httpStatus, ...seo, ...index, checkedAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error, "Не удалось выполнить SEO-проверку.");
  }
}
