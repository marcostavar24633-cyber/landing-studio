// Optional Vercel adapter. The same core is also used by Cloudflare Pages Functions.
const generateLanding = require("../server/generate-landing-core.js");

module.exports = async function handler(req, res) {
  // CORS — для автопилота Unique Design Studio (адреса — в ALLOWED_ORIGINS).
  for (const [k, v] of Object.entries(generateLanding.corsHeaders(req.headers?.origin, process.env))) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6-astra" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Разрешены только GET и POST запросы." });
  }
  // Старый редактор присылает { niche }, автопилот студии — { niche, tier, city, brand, details }.
  const result = await generateLanding(req.body || {}, process.env);
  return res.status(result.status).json(result.body);
};
