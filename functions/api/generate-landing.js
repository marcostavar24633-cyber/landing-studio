// Cloudflare Pages Function: /api/generate-landing
import generateLanding from "../../api/generate-landing-core.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ env }) {
  return json({ status: "ok", configured: Boolean(env.OPENAI_API_KEY), model: env.OPENAI_MODEL || "gpt-6-astra" });
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "Слишком большой запрос." }, 413);
    payload = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "Некорректный JSON запроса." }, 400);
  }
  const result = await generateLanding(payload?.niche, env);
  return json(result.body, result.status);
}
