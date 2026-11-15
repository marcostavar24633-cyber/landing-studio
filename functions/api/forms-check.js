// Cloudflare Pages Function: POST /api/forms-check
import { loadPage, analyzeForms, errorResponse, jsonResponse } from "../../lib/site-audit.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const page = await loadPage(body?.url);
    const result = analyzeForms(page.html, page.finalUrl);
    return jsonResponse({ url: page.finalUrl.toString(), httpStatus: page.httpStatus, ...result, checkedAt: new Date().toISOString(), notice: "Проверен только HTML. Реальная доставка заявок не тестировалась; сообщения не отправлялись. Динамические формы могут быть не обнаружены." });
  } catch (error) {
    return errorResponse(error, "Не удалось проверить формы.");
  }
}
