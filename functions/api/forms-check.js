function attr(tag,name){const m=new RegExp("\\b"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i").exec(tag);return m?(m[1]??m[2]??m[3]??""):""}
export async function onRequestPost(context){
 const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
 try{
  const body=await context.request.json(),raw=String(body?.url||"");let url;
  try{url=new URL(raw)}catch{return new Response(JSON.stringify({error:"Некорректный URL"}),{status:400,headers})}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||!(host.endsWith(".pages.dev")||host.endsWith(".github.io")))return new Response(JSON.stringify({error:"Поддерживаются только HTTPS-сайты pages.dev и github.io."}),{status:400,headers});
  const response=await fetch(url.toString(),{redirect:"follow",signal:AbortSignal.timeout(10000)});
  if(!(response.headers.get("content-type")||"").includes("text/html"))return new Response(JSON.stringify({error:"Сайт не вернул HTML.",httpStatus:response.status}),{status:422,headers});
  const html=(await response.text()).slice(0,1500000),base=new URL(response.url);
  const forms=[...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)].slice(0,30).map((match,index)=>{
   const source=match[0],opening=/<form\b[^>]*>/i.exec(source)?.[0]||"<form>",action=attr(opening,"action"),method=(attr(opening,"method")||"get").toLowerCase();
   const fields=[...source.matchAll(/<(input|textarea|select)\b[^>]*>/gi)].map(m=>{const tag=m[0],type=(attr(tag,"type")||m[1]).toLowerCase(),id=attr(tag,"id");return {type,name:attr(tag,"name"),required:/\brequired(?:\s|=|\/?>)/i.test(tag),hasLabel:!!id&&new RegExp("<label\\b[^>]*\\bfor\\s*=\\s*['\"]"+id+"['\"][^>]*>","i").test(source)}});
   let endpoint="";try{endpoint=action?new URL(action,base).toString():base.toString()}catch{endpoint="invalid"}
   return {index:index+1,method,action:action||"(не указан; отправка на текущую страницу)",endpoint,fields,hasSubmit:/<button\b[^>]*type\s*=\s*['"]submit['"]|<input\b[^>]*type\s*=\s*['"]submit['"]/i.test(source),hasConsent:/consent|privacy|соглас|персональн/i.test(source)};
  });
  const anchors=[...html.matchAll(/<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>/gi)].map(m=>m[1]);
  const tel=anchors.filter(x=>/^tel:/i.test(x)).length,email=anchors.filter(x=>/^mailto:/i.test(x)).length,messengers=anchors.filter(x=>/wa\.me|api\.whatsapp\.com|t\.me|telegram\.me|viber:/i.test(x)).length;
  const issues=[];
  for(const f of forms){if(!f.fields.length)issues.push("Форма "+f.index+": поля не обнаружены или форма создаётся JavaScript.");if(!f.hasSubmit)issues.push("Форма "+f.index+": кнопка отправки не найдена в HTML.");if(!f.fields.some(x=>x.required))issues.push("Форма "+f.index+": нет обязательных полей.");if(!f.hasConsent)issues.push("Форма "+f.index+": не обнаружен признак согласия/политики.");if(f.method==="get")issues.push("Форма "+f.index+": используется GET — проверьте передачу персональных данных в URL.");if(f.endpoint==="invalid")issues.push("Форма "+f.index+": некорректный action.");}
  const checks=[
   {label:"Формы на странице",status:forms.length?"ok":"warn",value:"Найдено: "+forms.length},
   {label:"Обязательные поля",status:forms.some(f=>f.fields.some(x=>x.required))?"ok":"warn",value:forms.reduce((n,f)=>n+f.fields.filter(x=>x.required).length,0)+" обязательных полей"},
   {label:"Кнопки отправки",status:forms.length&&forms.every(f=>f.hasSubmit)?"ok":"warn",value:forms.filter(f=>f.hasSubmit).length+" из "+forms.length+" форм"},
   {label:"Согласие / политика",status:forms.length&&forms.every(f=>f.hasConsent)?"ok":"warn",value:forms.filter(f=>f.hasConsent).length+" из "+forms.length+" форм"},
   {label:"Телефонные ссылки",status:tel?"ok":"warn",value:"Найдено: "+tel},
   {label:"Email-ссылки",status:email?"ok":"warn",value:"Найдено: "+email},
   {label:"Ссылки мессенджеров",status:messengers?"ok":"warn",value:"Найдено: "+messengers}
  ];
  return new Response(JSON.stringify({url:base.toString(),httpStatus:response.status,forms,checks,issues,checkedAt:new Date().toISOString(),notice:"Проверен только HTML. Реальная доставка заявок не тестировалась; сообщения не отправлялись. Динамические формы могут быть не обнаружены."}),{status:200,headers});
 }catch(error){return new Response(JSON.stringify({error:error?.name==="TimeoutError"?"Превышено время ожидания сайта.":"Не удалось проверить формы."}),{status:502,headers})}
}