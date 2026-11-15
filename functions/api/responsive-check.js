function escText(s){return String(s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();}
export async function onRequestPost(context) {
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
  try {
    const body=await context.request.json(),raw=String(body?.url||"");
    let url;try{url=new URL(raw)}catch{return new Response(JSON.stringify({error:"Некорректный URL"}),{status:400,headers})}
    const host=url.hostname.toLowerCase();
    if(url.protocol!=="https:"||!(host.endsWith(".pages.dev")||host.endsWith(".github.io")))return new Response(JSON.stringify({error:"Поддерживаются только HTTPS-сайты pages.dev и github.io."}),{status:400,headers});
    const response=await fetch(url.toString(),{redirect:"follow",signal:AbortSignal.timeout(10000)});
    if(!(response.headers.get("content-type")||"").includes("text/html"))return new Response(JSON.stringify({error:"Сайт не вернул HTML.",httpStatus:response.status}),{status:422,headers});
    const html=(await response.text()).slice(0,1500000),finalUrl=new URL(response.url);
    const viewport=/<meta[^>]+name=["']viewport["']/i.test(html);
    const imageTags=[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
    const imagesWithAlt=imageTags.filter(x=>/\balt\s*=/i.test(x)).length;
    const inlineCss=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]);
    const cssFiles=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).filter(x=>/rel=["']stylesheet["']/i.test(x)).map(x=>/href=["']([^"']+)["']/i.exec(x)?.[1]).filter(Boolean);
    const styles=[...inlineCss];let cssLoaded=0;
    for(const href of cssFiles.slice(0,8)){try{const cssUrl=new URL(href,finalUrl);if(cssUrl.origin!==finalUrl.origin)continue;const r=await fetch(cssUrl,{signal:AbortSignal.timeout(5000)});if(r.ok){styles.push((await r.text()).slice(0,300000));cssLoaded++}}catch{}}
    const css=styles.join("\n");
    const media=(css.match(/@media\s*\(/gi)||[]).length;
    const imgResponsive=/img\s*\{[^}]*max-width\s*:\s*100%/is.test(css)||/img\s*\{[^}]*width\s*:\s*100%/is.test(css);
    const fixedWidth=[...css.matchAll(/(?:width|min-width)\s*:\s*(\d{4,})px/gi)].map(m=>m[0]).slice(0,6);
    const checks=[
      {label:"Viewport для мобильных устройств",status:viewport?"ok":"fail",value:viewport?"Мета-тег viewport найден":"Мета-тег viewport отсутствует"},
      {label:"Медиазапросы CSS",status:media>0?"ok":"warn",value:media?("Найдено: "+media):"Медиазапросы не обнаружены в проверенных стилях"},
      {label:"Адаптивность изображений",status:imgResponsive?"ok":"warn",value:imgResponsive?"Найдено правило max-width/width для img":"Общее правило для img не обнаружено"},
      {label:"Потенциально большие фиксированные ширины",status:fixedWidth.length?"warn":"ok",value:fixedWidth.length?fixedWidth.join(", "):"Не обнаружены простые шаблоны ширины от 1000px"},
      {label:"Атрибуты alt у изображений",status:imageTags.length===0?"warn":imagesWithAlt===imageTags.length?"ok":"warn",value:imageTags.length?imagesWithAlt+" из "+imageTags.length+" изображений имеют alt":"Изображения img не найдены"}
    ];
    return new Response(JSON.stringify({url:finalUrl.toString(),httpStatus:response.status,checks,mediaQueries:media,images:imageTags.length,imagesWithAlt,stylesheetsFound:cssFiles.length,stylesheetsChecked:cssLoaded,checkedAt:new Date().toISOString(),notice:"Статический анализ HTML/CSS. Не измеряет фактическое переполнение, визуальную компоновку или поведение в реальном браузере."}),{status:200,headers});
  }catch(error){return new Response(JSON.stringify({error:error?.name==="TimeoutError"?"Превышено время ожидания сайта.":"Не удалось проверить адаптивность."}),{status:502,headers})}
}