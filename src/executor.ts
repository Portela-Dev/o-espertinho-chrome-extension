import type {Item,Recipe} from './contracts.js';

// Serializada pelo Chrome e executada no mundo isolado da aba.
// Valores extraídos da sessão ficam neste escopo; somente o link final retorna.
export async function executeRecipe(recipe:Recipe,item:Item):Promise<{affiliateUrl?:string;error?:string;needsLogin?:boolean}> {
 try {
  const variables:Record<string,string>=Object.create(null) as Record<string,string>;
  variables.originalUrl=item.originalUrl;
  if(!recipe.allowedOrigins.includes(location.origin))throw new Error('A aba saiu dos domínios autorizados.');
  const original=new URL(item.originalUrl);if(!recipe.allowedOrigins.includes(original.origin)||original.username||original.password)throw new Error('Origem do produto não autorizada.');
  const render=(value:string)=>value.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)(\|urlencode)?\}\}/g,(_all,key:string,encoded:string)=>{
   if(!Object.hasOwn(variables,key))throw new Error('Variável necessária não encontrada.');
   return encoded?encodeURIComponent(variables[key]):variables[key];
  });
  let affiliateUrl='';
  for(const step of recipe.steps){
   if(step.type==='extract'){
    let value:string|null|undefined;
    if(step.source==='dom'){const element=document.querySelector(step.selector??'');value=step.attribute?element?.getAttribute(step.attribute):element?.textContent;}
    else if(step.source==='localStorage')value=localStorage.getItem(step.key??'');
    else if(step.source==='sessionStorage')value=sessionStorage.getItem(step.key??'');
    else if(step.source==='cookie')value=document.cookie.split('; ').find(v=>v.startsWith(`${step.key}=`))?.split('=').slice(1).join('=');
    if(!value) return {error:'Abra o marketplace, confirme o login e tente novamente.',needsLogin:true};
    variables[step.name]=value.trim();
   }else if(step.type==='fill'){
    const input=document.querySelector<HTMLInputElement>(step.selector);if(!input)throw new Error('Campo configurado não encontrado.');
    input.value=render(step.value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   }else if(step.type==='click'){
    const element=document.querySelector<HTMLElement>(step.selector);if(!element)throw new Error('Botão configurado não encontrado.');element.click();
   }else if(step.type==='request'){
    const url=new URL(render(step.url));
    if(url.origin!==location.origin||!recipe.allowedOrigins.includes(url.origin)||url.username||url.password)throw new Error('Destino da conversão não autorizado.');
    const headers:Record<string,string>={};
    for(const [key,value] of Object.entries(step.headers??{})){
     if(/^(cookie|host|origin|referer|proxy-|sec-)/i.test(key))throw new Error('Header não suportado.');
     headers[key]=render(value);
    }
    const body=Object.fromEntries(Object.entries(step.body??{}).map(([key,value])=>[key,render(value)]));
    const response=await fetch(url.href,{method:step.method,headers,body:step.method==='GET'?undefined:step.bodyEncoding==='form'?new URLSearchParams(body):JSON.stringify(body),credentials:'include',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(response.status===401||response.status===403)return {error:'Marketplace exige login ou confirmação da sessão.',needsLogin:true};
    if(!response.ok)throw new Error('O marketplace recusou a conversão.');
    const text=await response.text();if(text.length>262144)throw new Error('Resposta excedeu o limite.');
    let value:unknown=JSON.parse(text);
    for(const key of step.responsePath.split('.')){
     if(['__proto__','constructor','prototype'].includes(key)||!value||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('Link não encontrado na resposta.');
     value=(value as Record<string,unknown>)[key];
    }
    if(typeof value!=='string'||value.length>2000)throw new Error('Link retornado inválido.');affiliateUrl=value;
   }
  }
  const link=new URL(affiliateUrl);if(!recipe.affiliateOrigins.includes(link.origin)||link.username||link.password)throw new Error('Origem do link gerado não autorizada.');
  return {affiliateUrl:link.href};
 }catch{return {error:'Conversão não concluída. Confira os seletores e a configuração da resposta.'};}
}
