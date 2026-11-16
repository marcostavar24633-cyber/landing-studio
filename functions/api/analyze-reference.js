// Cloudflare Pages Function: analyze a reference website using Workers AI.
// Only public HTTPS pages are accepted. No cookies, credentials, redirects or page scripts are executed.
const MAX_HTML = 1_000_000;
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODES = new Set(["structure", "composition", "detailed"]);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
function validateUrl(value){
  if(typeof value!=="string"||value.length>2048)throw new Error("Укажите корректный URL сайта.");
  let u;try{u=new URL(value)}catch{throw new Error("Не удалось распознать адрес сайта.");}
  const host=u.hostname.toLowerCase();
  if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443")throw new Error("Поддерживаются только публичные HTTPS-сайты на стандартном порту.");
  if(!host.includes(".")||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||/^\d+(\.\d+){3}$/.test(host)||host.includes(":"))throw new Error("Этот адрес не поддерживается. Укажите публичный домен.");
  u.hash="";return u;
}
function collectPage(html){
  const data={title:"",description:"",headings:[],paragraphs:[],links:[],buttons:[],images:[],sections:[]};
  let currentSection=null;
  const text=(v)=>String(v||"").replace(/\\s+/g," ").trim().slice(0,500);
  new HTMLRewriter()
    .on("title",{text(t){data.title+=t.text}})
    .on('meta[name="description"]',{element(e){data.description=e.getAttribute("content")||""}})
    .on("h1,h2,h3",{element(e){data.headings.push({tag:e.tagName.toLowerCase(),text:"",id:e.getAttribute("id")||"",className:(e.getAttribute("class")||"").slice(0,120)})},text(t){const last=data.headings[data.headings.length-1];if(last&&last.text.length<300)last.text+=t.text}})
    .on("p,li",{text(t){if(t.text.trim()&&data.paragraphs.length<45)data.paragraphs.push(text(t.text))}})
    .on("a",{element(e){const href=e.getAttribute("href")||"";if(data.links.length<60)data.links.push({text:"",href:href.slice(0,300)})},text(t){const last=data.links[data.links.length-1];if(last&&last.text.length<180)last.text+=t.text}})
    .on("button,input[type=submit]",{element(e){if(data.buttons.length<30)data.buttons.push({text:e.getAttribute("aria-label")||e.getAttribute("value")||"",type:e.getAttribute("type")||"button"})},text(t){const last=data.buttons[data.buttons.length-1];if(last&&!last.text)last.text+=t.text}})
    .on("img",{element(e){if(data.images.length<35)data.images.push({alt:(e.getAttribute("alt")||"").slice(0,160),role:e.getAttribute("role")||"",className:(e.getAttribute("class")||"").slice(0,100)})}})
    .on("section,main,article,header,footer,nav",{element(e){if(data.sections.length<40)data.sections.push({tag:e.tagName.toLowerCase(),id:(e.getAttribute("id")||"").slice(0,100),className:(e.getAttribute("class")||"").slice(0,140)})}})
    .transform(new Response(html));
  data.title=text(data.title);data.description=text(data.description);
  data.headings=data.headings.map(h=>({...h,text:text(h.text)})).filter(h=>h.text);
  data.links=data.links.map(a=>({...a,text:text(a.text)})).filter(a=>a.text||a.href);
  data.buttons=data.buttons.map(b=>({...b,text:text(b.text)}));
  data.paragraphs=[...new Set(data.paragraphs.map(text).filter(Boolean))].slice(0,35);
  return data;
}
async function readLimited(response){
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>MAX_HTML)throw new Error("Страница слишком большая для анализа (лимит 1 МБ).");
  if(!response.body)throw new Error("Сайт не вернул содержимое страницы.");
  const reader=response.body.getReader();let total=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_HTML){await reader.cancel();throw new Error("Страница слишком большая для анализа (лимит 1 МБ).");}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder("utf-8").decode(bytes);
}
function extractJson(result){
  const raw=typeof result==="string"?result:result?.response||result?.result?.response||"";
  const match=String(raw).match(/\{[\\s\\S]*\}/);
  if(!match)return null;try{return JSON.parse(match[0])}catch{return null}
}
const modeInstructions={
 structure:"Верни только структуру и порядок блоков. Не анализируй визуальный стиль. Сформируй sections как массив объектов {order,name,purpose,contentTypes,confidence}.",
 composition:"Разбери структуру, композицию и визуальное направление: сетки, колонки, пропорции, размещение изображений, иерархию, плотность, типографику на уровне характера, визуальные паттерны. Не предлагай копировать фирменные элементы.",
 detailed:"Проведи максимально подробный UX/UI-анализ: структура, композиция, визуальная иерархия, навигация, CTA, карточки, формы, контентные типы, доверие, FAQ, контакты, адаптивные риски, доступность, SEO-сигналы, сильные решения и слабые места. Отделяй наблюдения от предположений."
};
export async function onRequestPost({request,env}){
  let payload;try{const raw=await request.text();if(raw.length>5000)return json({error:"Слишком большой запрос."},413);payload=JSON.parse(raw||"{}");}catch{return json({error:"Некорректный JSON запроса."},400);}
  const mode=MODES.has(payload.mode)?payload.mode:"structure";
  let url;try{url=validateUrl(payload.url);}catch(e){return json({error:e.message},400);}
  if(!env.AI?.run)return json({error:"Workers AI не подключён. Добавьте binding AI в настройках Cloudflare Pages."},503);
  try{
    const response=await fetch(url.toString(),{method:"GET",redirect:"manual",headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":"LandingStudioReferenceAnalyzer/1.0"}});
    if(response.status>=300&&response.status<400)return json({error:"Сайт перенаправляет на другой адрес. Введите конечный HTTPS-адрес вручную."},422);
    if(!response.ok)return json({error:"Сайт не удалось открыть (HTTP "+response.status+"). Проверьте адрес или доступность страницы."},422);
    const type=response.headers.get("content-type")||"";if(!/text\\/html|application\\/xhtml\\+xml/i.test(type))return json({error:"По этому адресу не найдена HTML-страница."},415);
    const html=await readLimited(response);const extracted=collectPage(html);
    if(!extracted.title&&!extracted.headings.length)return json({error:"Не удалось извлечь структуру. Возможно, сайт формирует содержимое только через JavaScript."},422);
    const prompt="Проанализируй публичную страницу сайта. Верни только корректный JSON без Markdown. URL: "+url.origin+url.pathname+"\\nРежим: "+modeInstructions[mode]+"\\nНе воспроизводи текст страницы, торговые марки, названия компании, авторские изображения или уникальный фирменный стиль. Опиши обобщённые UX-паттерны. Если данных нет, укажи это явно. JSON-объект должен содержать mode, pageTitle, summary, sections, composition, visualDirection, navigation, callsToAction, forms, responsiveNotes, accessibilityNotes, seoNotes, strengths, risks, limitations. Для structure достаточно sections, summary и limitations; для остальных режимов заполни только поля, доступные по извлечённым данным.";
    const ai=await env.AI.run(MODEL,{messages:[{role:"system",content:"Ты специалист по UX-архитектуре сайтов. Никакого копирования чужого контента. Не выдумывай невидимые детали."},{role:"user",content:prompt+"\\nИзвлечённые данные (частичный DOM-анализ):\\n"+JSON.stringify(extracted).slice(0,22000)}],max_tokens:mode==="detailed"?2600:mode==="composition"?1600:900});
    const analysis=extractJson(ai);
    if(!analysis)return json({error:"AI не смог вернуть структурированный анализ. Повторите запрос."},502);
    analysis.mode=mode;analysis.sourceUrl=url.origin+url.pathname;analysis.extracted=extracted;
    return json({analysis});
  }catch(error){return json({error:error?.message||"Ошибка анализа сайта-образца."},502);}
}
