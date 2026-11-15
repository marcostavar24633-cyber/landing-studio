// Optional Vercel adapter. The same core is also used by Cloudflare Pages Functions.
const generateLanding = require("./generate-landing-core.js");

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6-astra" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Разрешены только GET и POST запросы." });
  }
  const result = await generateLanding(req.body?.niche, process.env);
  return res.status(result.status).json(result.body);
};
