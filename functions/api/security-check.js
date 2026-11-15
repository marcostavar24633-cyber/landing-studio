export async function onRequestPost(context){
 const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
 try{
  const body=await context.request.json(),raw=String(body?.url||"");let url;
  try{url=new URL(raw)}catch{return new Response(JSON.stringify({error:"Некорректный URL"}),{status:400,headers})}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||!(host.endsWith(".pages.dev")||host.endsWith(".github.io")))return new Response(JSON.stringify({error:"Поддерживаются только HTTPS-сайты pages.dev и github.io."}),{status:400,headers});
  const response=await fetch(url.toString(),{redirect:"follow",signal:AbortSignal.timeout(10000)});
  const finalUrl=new URL(response.url),finalHost=finalUrl.hostname.toLowerCase();
  if(finalUrl.protocol!=="https:"||!(finalHost.endsWith(".pages.dev")||finalHost.endsWith(".github.io")))return new Response(JSON.stringify({error:"Сайт перенаправил запрос за пределы разрешённых доменов."}),{status:422,headers});
  const h=response.headers,html=(await response.text()).slice(0,1500000);
  const headerChecks=[
   ["Strict-Transport-Security","HSTS",true],
   ["Content-Security-Policy","CSP",true],
   ["X-Content-Type-Options","X-Content-Type-Options",true],
   ["Referrer-Policy","Referrer-Policy",true],
   ["Permissions-Policy","Permissions-Policy",false]
  ].map(([key,label,important])=>({label,status:h.get(key)?"ok":important?"warn":"info",value:h.get(key)||"Не установлен"}));
  const mixed=[...html.matchAll(/(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi)].map(m=>m[1]);
  const secretPatterns=[
   {label:"Похоже на OpenAI API key",re:/\bsk-[A-Za-z0-9_-]{20,}\b/g},
   {label:"Похоже на GitHub token",re:/\bgh[pousr]_[A-Za-z0-9]{25,}\b/g},
   {label:"Похоже на AWS access key",re:/\bAKIA[0-9A-Z]{16}\b/g}
  ];
  const findings=[];
  for(const item of secretPatterns){const count=(html.match(item.re)||[]).length;if(count)findings.push({label:item.label,count})}
  const checks=[
   {label:"HTTPS",status:response.url.startsWith("https:")?"ok":"fail",value:response.url.startsWith("https:")?"Страница загружена по HTTPS":"Итоговый URL не HTTPS"},
   {label:"HTTP security headers",status:headerChecks.some(x=>x.status==="warn")?"warn":"ok",value:headerChecks.filter(x=>x.status==="ok").length+" из 5 заголовков присутствуют"},
   {label:"Смешанный HTTP-контент",status:mixed.length?"warn":"ok",value:mixed.length?"Найдено HTTP-ссылок: "+mixed.length:"Прямые HTTP src/href не обнаружены"},
   {label:"Публичные секреты в HTML",status:findings.length?"fail":"ok",value:findings.length?"Найдены строки, похожие на секреты — значения скрыты":"Известные шаблоны ключей не обнаружены"}
  ];
  return new Response(JSON.stringify({url:finalUrl.toString(),httpStatus:response.status,checks,headers:headerChecks,mixedContentCount:mixed.length,mixedContentExamples:mixed.slice(0,5).map(x=>x.slice(0,180)),secretFindings:findings,checkedAt:new Date().toISOString(),scope:"Проверены HTTP-ответ и HTML главной страницы. Не проверены TLS-цепочка, исходный GitHub-репозиторий, npm-зависимости, workflow permissions и скрытые API-ответы. Совпадение шаблона секрета требует ручной проверки; значения не раскрываются."}),{status:200,headers});
 }catch(error){return new Response(JSON.stringify({error:error?.name==="TimeoutError"?"Превышено время ожидания сайта.":"Не удалось выполнить проверку безопасности."}),{status:502,headers})}
}