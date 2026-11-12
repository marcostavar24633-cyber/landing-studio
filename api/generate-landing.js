// Vercel Node.js serverless function. Keep OPENAI_API_KEY in server-side env vars only.
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    brand:{type:"string"}, niche:{type:"string"}, title:{type:"string"}, description:{type:"string"}, cta:{type:"string"},
    strategySummary:{type:"string"}, targetAudience:{type:"string"}, mainOffer:{type:"string"}, visualDirection:{type:"string"}, marketResearch:{type:"string"},
    researchSources:{type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},url:{type:"string"}},required:["title","url"]}},
    assumptions:{type:"array",items:{type:"string"}}, style:{type:"string",enum:["Премиальный","Минимализм","Яркий","Деловой"]},
    palette:{type:"string",enum:["Тёмная","Светлая"]}, accent:{type:"string"},
    aboutTitle:{type:"string"}, aboutText:{type:"string"}, servicesTitle:{type:"string"}, servicesIntro:{type:"string"},
    services:{type:"array",items:{type:"array",items:{type:"string"}}},
    advantagesTitle:{type:"string"}, advantagesIntro:{type:"string"}, advantages:{type:"array",items:{type:"array",items:{type:"string"}}},
    processTitle:{type:"string"}, process:{type:"array",items:{type:"array",items:{type:"string"}}},
    faqs:{type:"array",items:{type:"array",items:{type:"string"}}}, contactTitle:{type:"string"}, contactText:{type:"string"}
  },
  required:["brand","niche","title","description","cta","strategySummary","targetAudience","mainOffer","visualDirection","marketResearch","researchSources","assumptions","style","palette","accent","aboutTitle","aboutText","servicesTitle","servicesIntro","services","advantagesTitle","advantagesIntro","advantages","processTitle","process","faqs","contactTitle","contactText"]
};

module.exports = async function handler(req,res){
  if(req.method==="GET") return res.status(200).json({status:"ok",configured:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||"gpt-6-astra"});
  if(req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Разрешены только GET и POST запросы."});}
  const niche=typeof req.body?.niche==="string"?req.body.niche.normalize("NFC").trim().slice(0,180):"";
  if(!niche)return res.status(400).json({error:"Укажите нишу бизнеса."});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"AI ещё не подключён: добавьте OPENAI_API_KEY в переменные окружения хостинга."});
  const instructions=`Ты — автономная команда: маркетолог, исследователь аудитории, UX/UI-дизайнер, UX-копирайтер и специалист по конверсии. По одной нише подготовь полноценную первую версию одностраничного сайта на русском языке. Самостоятельно разрешай неопределённость: не задавай уточняющих вопросов пользователю. Если география, бренд, цены или особенности неизвестны, не выдумывай факты — используй нейтральные формулировки, укажи гипотезы в assumptions. Не создавай фальшивые отзывы, сертификаты, цифры, гарантии, адреса, телефоны или конкретные цены. Предложи реалистичную аудиторию, её задачи и потребности, понятный оффер, структуру сайта, тексты карточек услуг, преимущества как рекомендации к подтверждению, этапы работы и FAQ. Используй доступный веб-поиск, чтобы изучить публичные предложения и типовые подходы конкурентов в этой нише. Сформулируй краткие рыночные наблюдения в marketResearch и добавь до 5 реально использованных публичных источников в researchSources (title и полный https URL). Не выдавай гипотезы за факты и не выдумывай источники. Подбери цвет и стиль, соответствующие нише и ожидаемой аудитории. Все строки должны быть полезными и готовыми к редактированию. Услуг ровно 3, преимуществ 3, этапов 4, FAQ 4. Ниша: ${niche}`;
  try{
    const upstream=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-6-astra",reasoning:{effort:"low"},store:false,instructions,input:`Подготовь стратегию и лендинг для ниши: ${niche}`,tools:[{type:"web_search",search_context_size:"medium"}],tool_choice:"auto",include:["web_search_call.action.sources"],max_output_tokens:6000,text:{format:{type:"json_schema",name:"landing_studio_brief",strict:true,schema}}})
    });
    const raw=await upstream.json();
    if(!upstream.ok){console.error("OpenAI API error",raw);return res.status(502).json({error:"AI-модель не смогла подготовить сайт. Проверьте модель и настройки API."});}
    const output=(raw.output||[]).flatMap(item=>item.content||[]).find(item=>item.type==="output_text")?.text;
    if(!output){const reason=raw.incomplete_details?.reason;return res.status(502).json({error:reason==="max_output_tokens"?"Ответ AI оказался слишком большим. Повторите запрос или сократите описание ниши.":"AI вернул пустой или неполный результат. Попробуйте повторить запрос."});}
    const landing=JSON.parse(output);
    // Only expose sources actually returned by the hosted web-search tool.
    // Do not trust URLs invented by the model in the structured payload.
    const verifiedSources=(raw.output||[])
      .filter(item=>item.type==="web_search_call")
      .flatMap(item=>item.action?.sources||[])
      .filter(source=>typeof source.url==="string"&&/^https:\/\//i.test(source.url))
      .map(source=>({title:typeof source.title==="string"&&source.title.trim()?source.title:source.url,url:source.url}));
    landing.researchSources=[...new Map(verifiedSources.map(source=>[source.url,source])).values()].slice(0,5);
    return res.status(200).json({landing});
  }catch(error){console.error("Landing generation failed",error);return res.status(500).json({error:"Внутренняя ошибка генерации. Попробуйте позже."});}
}
