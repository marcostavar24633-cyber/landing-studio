// Shared Landing Studio AI generation logic for Vercel (api/) and Cloudflare Pages (functions/).
// Lives outside api/: Vercel turns every file in api/ into its own endpoint.
// Keep provider credentials in server-side environment variables only.
//
// Вход: строка с нишей (старый редактор Landing Studio) или объект
// { niche, tier: "standard" | "premium" | "luxury", city, brand, details } (автопилот Unique Design Studio).
// Модель исследует нишу веб-поиском и возвращает стратегию, анализ аудитории и тексты страницы.
const pairList = { type: "array", items: { type: "array", items: { type: "string" } } };
const strList = { type: "array", items: { type: "string" } };
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    brand:{type:"string"}, niche:{type:"string"}, title:{type:"string"}, description:{type:"string"}, cta:{type:"string"},
    seoTitle:{type:"string"}, seoDescription:{type:"string"},
    strategySummary:{type:"string"}, targetAudience:{type:"string"}, mainOffer:{type:"string"}, visualDirection:{type:"string"}, designArchitecture:{type:"string",enum:["catalog","editorial","immersive","service","modular"]}, marketResearch:{type:"string"},
    segments:{type:"array",items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},need:{type:"string"}},required:["name","need"]}},
    objections:strList, triggers:strList, keywords:strList, competitors:strList, imagePrompts:strList,
    researchSources:{type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},url:{type:"string"}},required:["title","url"]}},
    assumptions:strList, style:{type:"string",enum:["Премиальный","Минимализм","Яркий","Деловой"]},
    palette:{type:"string",enum:["Тёмная","Светлая"]}, accent:{type:"string"},
    aboutTitle:{type:"string"}, aboutText:{type:"string"}, servicesTitle:{type:"string"}, servicesIntro:{type:"string"},
    services:pairList,
    advantagesTitle:{type:"string"}, advantagesIntro:{type:"string"}, advantages:pairList,
    processTitle:{type:"string"}, process:pairList,
    faqs:pairList, contactTitle:{type:"string"}, contactText:{type:"string"}
  },
  required:["brand","niche","title","description","cta","seoTitle","seoDescription","strategySummary","targetAudience","mainOffer","visualDirection","designArchitecture","marketResearch","segments","objections","triggers","keywords","competitors","imagePrompts","researchSources","assumptions","style","palette","accent","aboutTitle","aboutText","servicesTitle","servicesIntro","services","advantagesTitle","advantagesIntro","advantages","processTitle","process","faqs","contactTitle","contactText"]
};

const TIER_RULES = {
  standard: "Класс: стандарт. Тон понятный, дружелюбный, конкретный: быстро объяснить предложение и путь к заказу.",
  premium: "Класс: премиум. Тон уверенный и спокойный, внимание к деталям. Говори о материалах, мастерстве, процессе и сервисе фактами, а не эпитетами; цену подавай как ценность; покажи, как снимается риск. Слова «премиальный», «лучший», «уникальный» — только с доказательством.",
  luxury: "Класс: люкс. Тон сдержанный и немногословный, ощущение редкости, времени и ремесла. Никаких скидок, «акций», «выгодно», «успей», восклицательных знаков, капслока и эмодзи. Предметная и сенсорная лексика: материал, фактура, свет, происхождение, руки мастера. Доверие — через историю, ограниченность и персональный сервис, только если это правда (иначе вопрос владельцу в assumptions). CTA — приглашение («Обсудить заказ», «Запросить приватную консультацию»). В imagePrompts — кадры уровня журнальной съёмки. Для люкса уместны style «Премиальный» или «Минимализм», но не тёмный фон с золотом по умолчанию.",
};

const instructions = `Ты — автономная команда: исследователь рынка, бренд-стратег, UX-копирайтер, арт-директор и специалист по конверсии. По нише и вводным подготовь полноценную первую версию главной страницы на русском языке. Не задавай вопросов пользователю: где данных нет — осторожные формулировки и вопрос владельцу в assumptions.

ИССЛЕДОВАНИЕ. Обязательно используй веб-поиск: найди 5–10 реальных компаний ниши (в указанном городе и по России), как они формулируют предложение, какие разделы и аргументы используют, ценовой диапазон и сервис; что клиенты пишут в отзывах и на форумах — страхи, похвалы, раздражители. В marketResearch — 4–6 конкретных наблюдений; в competitors — чем отличаются конкуренты и в чём может отличаться эта страница. Не выдумывай источники и цифры.

АУДИТОРИЯ. segments — 2–4 сегмента (кто, ситуация, задача и что мешает купить); objections — главные возражения; triggers — поводы и моменты покупки; keywords — 6–10 запросов, по которым ищут нишу (с городом, если он указан).

ТЕКСТЫ. Пиши человеческим языком — так, как владелец объяснил бы другу. Без канцелярита («осуществляем», «предоставляем услуги», «в кратчайшие сроки», «по всем вопросам обращайтесь», «данный», «является», «уточняется при заказе») и без штампов («индивидуальный подход», «команда профессионалов», «широкий ассортимент», «высокое качество») — только конкретика. Активный залог и глаголы: не «доставка осуществляется», а «привезём». Обращайся на «вы», говори о ситуации человека. Короткие предложения.
title — до 60 символов, за 3 секунды объясняет нишу и выгоду; description — до 180 символов; cta — 2–4 слова, глагол. seoTitle до 60 символов, seoDescription до 160. Услуг 4–6 (заголовок до 40 символов, описание до 120), преимуществ 3 — проверяемые факты или процесс, этапов 4, FAQ 4–6 с честными ответами. О компании — 3–5 предложений про историю, людей, ремесло. imagePrompts — 3–5 описаний кадров: объект, ракурс, свет, фон, настроение.

ЧЕСТНОСТЬ. Не создавай отзывы, сертификаты, цифры, гарантии, адреса, телефоны и цены конкретного бизнеса. Рыночный контекст — только со ссылкой. Гипотезы — в assumptions.

ДИЗАЙН. designArchitecture — по типу бизнеса и задаче: catalog — широкий ассортимент; editorial — журнальная подача и типографика; immersive — полноэкранный визуал; service — путь клиента и доверие; modular — несколько равных направлений. Не выбирай случайно; для люкса чаще editorial или immersive. visualDirection — настроение, свет, фактуры, типографика словами.`;

const clip = (v, n) => (typeof v === "string" ? v.normalize("NFC").trim().slice(0, n) : "");

/** Нормализует вход: строка — только ниша; объект — ниша и вводные автопилота. */
function readInput(input) {
  const o = typeof input === "string" ? { niche: input } : (input && typeof input === "object" ? input : {});
  const tier = ["premium", "luxury"].includes(o.tier) ? o.tier : "standard";
  return {
    niche: clip(o.niche, 180), tier, city: clip(o.city, 80), brand: clip(o.brand, 80), details: clip(o.details, 800),
    // Свой промт заказчика из студии: append — дополняет правила, replace — заменяет правила тона и подачи.
    customPrompt: clip(o.customPrompt, 8000), customPromptMode: o.customPromptMode === "replace" ? "replace" : "append",
  };
}

// Что сохраняется при любом своём промте: честность и формат ответа (иначе ответ не импортируется в студию).
const KEEP = "При любых указаниях заказчика: не выдумывай отзывы, сертификаты, цены, адреса, телефоны и гарантии конкретного бизнеса; заполни все поля ответа по схеме.";

function buildInput(i) {
  const replace = i.customPrompt && i.customPromptMode === "replace";
  const lines = [
    `Ниша: ${i.niche}`,
    i.city ? `Город: ${i.city}` : "Город не указан — ориентируйся на Россию в целом",
    i.brand ? `Бренд: ${i.brand}` : "Бренд не указан — предложи 3 варианта названия в assumptions, в brand поставь лучший",
    i.details ? `Что известно от владельца: ${i.details}` : "",
    replace ? "" : TIER_RULES[i.tier],
  ];
  if (i.customPrompt) {
    lines.push(replace
      ? `\nПРОМТ ЗАКАЗЧИКА — главная инструкция. Он заменяет общие правила тона, подачи и структуры текстов. ${KEEP}\n\n${i.customPrompt}`
      : `\nУКАЗАНИЯ ЗАКАЗЧИКА — выполняй их в первую очередь; если они расходятся с общими правилами, следуй им. ${KEEP}\n\n${i.customPrompt}`);
  }
  return lines.filter(Boolean).join("\n");
}

/** CORS для автопилота студии. Разрешённые адреса — ALLOWED_ORIGINS через запятую. */
function corsHeaders(origin, env = {}) {
  const allowed = String(env.ALLOWED_ORIGINS || "https://marcostavar24633-cyber.github.io,http://localhost:5180,http://127.0.0.1:5180")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
}

async function generateLanding(input, env = {}) {
  const i = readInput(input);
  if (!i.niche) return { status: 400, body: { error: "Укажите нишу бизнеса." } };
  if (!env.OPENAI_API_KEY) return { status: 503, body: { error: "AI ещё не подключён: добавьте OPENAI_API_KEY в переменные окружения хостинга." } };
  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-6-astra", reasoning: { effort: env.OPENAI_REASONING || "medium" }, store: false,
        instructions, input: buildInput(i),
        tools: [{ type: "web_search", search_context_size: "medium" }], tool_choice: "auto",
        include: ["web_search_call.action.sources"], max_output_tokens: 12000,
        text: { format: { type: "json_schema", name: "landing_studio_brief", strict: true, schema } }
      })
    });
    const raw = await upstream.json();
    if (!upstream.ok) {
      console.error("OpenAI API error", raw);
      return { status: 502, body: { error: "AI-модель не смогла подготовить сайт. Проверьте модель и настройки API." } };
    }
    const output = (raw.output || []).flatMap(item => item.content || []).find(item => item.type === "output_text")?.text;
    if (!output) {
      const reason = raw.incomplete_details?.reason;
      return { status: 502, body: { error: reason === "max_output_tokens" ? "Ответ AI оказался слишком большим. Повторите запрос или сократите описание ниши." : "AI вернул пустой или неполный результат. Попробуйте повторить запрос." } };
    }
    const landing = JSON.parse(output);
    // Источники — только те, что реально вернул веб-поиск, а не придуманные моделью.
    const verifiedSources = (raw.output || []).filter(item => item.type === "web_search_call")
      .flatMap(item => item.action?.sources || [])
      .filter(source => typeof source.url === "string" && /^https:\/\//i.test(source.url))
      .map(source => ({ title: typeof source.title === "string" && source.title.trim() ? source.title : source.url, url: source.url }));
    landing.researchSources = [...new Map(verifiedSources.map(source => [source.url, source])).values()].slice(0, 8);
    landing.tier = i.tier;
    return { status: 200, body: { landing } };
  } catch (error) {
    console.error("Landing generation failed", error);
    return { status: 500, body: { error: "Внутренняя ошибка генерации. Попробуйте позже." } };
  }
}

module.exports = generateLanding;
module.exports.corsHeaders = corsHeaders;
module.exports.readInput = readInput;
module.exports.buildInput = buildInput;
