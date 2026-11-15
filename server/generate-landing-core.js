// Shared Landing Studio AI generation logic for Vercel (api/) and Cloudflare Pages (functions/).
// Lives outside api/: Vercel turns every file in api/ into its own endpoint.
// Keep provider credentials in server-side environment variables only.
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    brand:{type:"string"}, niche:{type:"string"}, title:{type:"string"}, description:{type:"string"}, cta:{type:"string"},
    strategySummary:{type:"string"}, targetAudience:{type:"string"}, mainOffer:{type:"string"}, visualDirection:{type:"string"}, designArchitecture:{type:"string",enum:["catalog","editorial","immersive","service","modular"]}, marketResearch:{type:"string"},
    researchSources:{type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},url:{type:"string"}},required:["title","url"]}},
    assumptions:{type:"array",items:{type:"string"}}, style:{type:"string",enum:["Премиальный","Минимализм","Яркий","Деловой"]},
    palette:{type:"string",enum:["Тёмная","Светлая"]}, accent:{type:"string"},
    aboutTitle:{type:"string"}, aboutText:{type:"string"}, servicesTitle:{type:"string"}, servicesIntro:{type:"string"},
    services:{type:"array",items:{type:"array",items:{type:"string"}}},
    advantagesTitle:{type:"string"}, advantagesIntro:{type:"string"}, advantages:{type:"array",items:{type:"array",items:{type:"string"}}},
    processTitle:{type:"string"}, process:{type:"array",items:{type:"array",items:{type:"string"}}},
    faqs:{type:"array",items:{type:"array",items:{type:"string"}}}, contactTitle:{type:"string"}, contactText:{type:"string"}
  },
  required:["brand","niche","title","description","cta","strategySummary","targetAudience","mainOffer","visualDirection","designArchitecture","marketResearch","researchSources","assumptions","style","palette","accent","aboutTitle","aboutText","servicesTitle","servicesIntro","services","advantagesTitle","advantagesIntro","advantages","processTitle","process","faqs","contactTitle","contactText"]
};

const instructions = `Ты — автономная команда: маркетолог, исследователь аудитории, UX/UI-дизайнер, UX-копирайтер и специалист по конверсии. По одной нише подготовь полноценную первую версию одностраничного сайта на русском языке. Самостоятельно разрешай неопределённость: не задавай уточняющих вопросов пользователю. Если география, бренд, цены или особенности неизвестны, не выдумывай факты — используй нейтральные формулировки, укажи гипотезы в assumptions. Не создавай фальшивые отзывы, сертификаты, цифры, гарантии, адреса, телефоны или конкретные цены. Предложи реалистичную аудиторию, её задачи и потребности, понятный оффер, структуру сайта, тексты карточек услуг, преимущества как рекомендации к подтверждению, этапы работы и FAQ. Используй доступный веб-поиск, чтобы изучить публичные предложения и типовые подходы конкурентов в этой нише. Сформулируй краткие рыночные наблюдения в marketResearch и добавь до 5 реально использованных публичных источников в researchSources (title и полный https URL). Не выдавай гипотезы за факты и не выдумывай источники. Подбери цвет и стиль, соответствующие нише и ожидаемой аудитории. Обязательно выбери designArchitecture из enum: catalog — товарный каталог и продуктовый первый экран; editorial — журнальная/редакционная композиция с типографикой и крупным визуальным блоком; immersive — полноэкранная визуальная сцена с текстом поверх изображения; service — структурированная сервисная композиция с акцентом на доверие и путь клиента; modular — асимметричная модульная сетка. Выбирай архитектуру по типу бизнеса и задаче аудитории, а не случайно. Ориентиры для знакомых демонстрационных ниш: DOMA TECH и магазин телескопов — catalog; PHOTOGRAF — immersive; PENKA и HAIR — editorial; RAKI — immersive; Slopay Buket — editorial; Дом Ульяновск и строительные/ремонтные услуги — service. Это стартовые ориентиры, а не жёсткое правило: учитывай реальное описание ниши, если оно подробнее названия бренда. Не используй один и тот же первый экран для разных ниш. Все строки должны быть полезными и готовыми к редактированию. Услуг ровно 3, преимуществ 3, этапов 4, FAQ 4.`;

module.exports = async function generateLanding(niche, env = {}) {
  const normalizedNiche = typeof niche === "string" ? niche.normalize("NFC").trim().slice(0, 180) : "";
  if (!normalizedNiche) return { status: 400, body: { error: "Укажите нишу бизнеса." } };
  if (!env.OPENAI_API_KEY) return { status: 503, body: { error: "AI ещё не подключён: добавьте OPENAI_API_KEY в переменные окружения хостинга." } };
  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-6-astra", reasoning: { effort: "low" }, store: false,
        instructions, input: `Подготовь стратегию и лендинг для ниши: ${normalizedNiche}`,
        tools: [{ type: "web_search", search_context_size: "medium" }], tool_choice: "auto",
        include: ["web_search_call.action.sources"], max_output_tokens: 6000,
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
    const verifiedSources = (raw.output || []).filter(item => item.type === "web_search_call")
      .flatMap(item => item.action?.sources || [])
      .filter(source => typeof source.url === "string" && /^https:\/\//i.test(source.url))
      .map(source => ({ title: typeof source.title === "string" && source.title.trim() ? source.title : source.url, url: source.url }));
    landing.researchSources = [...new Map(verifiedSources.map(source => [source.url, source])).values()].slice(0, 5);
    return { status: 200, body: { landing } };
  } catch (error) {
    console.error("Landing generation failed", error);
    return { status: 500, body: { error: "Внутренняя ошибка генерации. Попробуйте позже." } };
  }
};
