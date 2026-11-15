// Cloudflare Pages Function: POST /api/responsive-check
import { loadPage, loadStyles, analyzeResponsive, errorResponse, jsonResponse } from "../../lib/site-audit.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const page = await loadPage(body?.url);
    const styles = await loadStyles(page.html, page.finalUrl);
    const result = analyzeResponsive(page.html, styles.css);
    return jsonResponse({ url: page.finalUrl.toString(), httpStatus: page.httpStatus, ...result, stylesheetsFound: styles.found, stylesheetsChecked: styles.loaded, checkedAt: new Date().toISOString(), notice: "Статический анализ HTML/CSS. Не измеряет фактическое переполнение, визуальную компоновку или поведение в реальном браузере." });
  } catch (error) {
    return errorResponse(error, "Не удалось проверить адаптивность.");
  }
}
