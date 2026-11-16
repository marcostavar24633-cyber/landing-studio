// Cloudflare Pages Function: /api/generate-landing
import generateLanding from "../../server/generate-landing-core.js";

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
  });
}
// CORS — для автопилота Unique Design Studio (адреса — в ALLOWED_ORIGINS).
const cors = (request, env) => generateLanding.corsHeaders(request.headers.get("Origin"), env);

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: cors(request, env) });
}

export async function onRequestGet({ request, env }) {
  return json({ status: "ok", configured: Boolean(env.AI?.run || env.OPENAI_API_KEY), provider: env.AI?.run ? "cloudflare-workers-ai" : env.OPENAI_API_KEY ? "openai" : null, model: env.AI?.run ? (env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast") : (env.OPENAI_MODEL || "gpt-6-astra") }, 200, cors(request, env));
}

export async function onRequestPost({ request, env }) {
  const headers = cors(request, env);
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > 60000) return json({ error: "Слишком большой запрос." }, 413, headers);
    payload = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "Некорректный JSON запроса." }, 400, headers);
  }
  // Старый редактор присылает { niche }, автопилот студии — { niche, tier, city, brand, details }.
  const result = await generateLanding(payload || {}, env);
  return json(result.body, result.status, headers);
}
