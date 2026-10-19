export interface ProofMarket {id:string;name:string;loginUrl:string;allowedOrigins:string[];cookieDomains:string[];testUrl:string}
export interface ProofTest {id:string;status:'running'|'completed'|'failed';expiresAt:number;error?:string;result?:{status:string;reason?:string;title:string|null;priceCents:number|null;finalUrl:string;navigationStatuses:number[];missing:string[];cookiesImported:number;storageOriginsImported:number}}
export async function captureSession(browser:typeof chrome,market:ProofMarket,includeStorage:boolean){
 const tabs=await browser.tabs.query({active:true,currentWindow:true}),tab=tabs[0];
 if(!tab?.id||!tab.url||tab.incognito||!market.allowedOrigins.includes(new URL(tab.url).origin))throw new Error('Abra o marketplace selecionado numa aba normal, faça login e volte à extensão.');
 const cookies=new Map<string,{name:string;value:string;domain:string;path:string;expires:number;httpOnly:boolean;secure:true;sameSite:'Strict'|'Lax'|'None'}>();
 let skipped=0;
 for(const origin of market.allowedOrigins){
  if(new URL(origin).protocol!=='https:')throw new Error('A captura exige domínios HTTPS.');
  for(const c of await browser.cookies.getAll({url:origin+'/'})){
   if(c.partitionKey||!market.cookieDomains.includes(c.domain.replace(/^\./u,''))||c.expirationDate!==undefined&&c.expirationDate<=Date.now()/1000){skipped++;continue;}
   cookies.set(c.domain+'\n'+c.path+'\n'+c.name,{name:c.name,value:c.value,domain:c.domain,path:c.path,expires:c.expirationDate??-1,httpOnly:c.httpOnly,secure:true,sameSite:c.sameSite==='strict'?'Strict':c.sameSite==='no_restriction'?'None':'Lax'});
  }
 }
 if(!cookies.size)throw new Error('Nenhum cookie elegível. Verifique o login e os domínios cadastrados, incluindo o domínio raiz.');
 const origins:{origin:string;localStorage:{name:string;value:string}[]}[]=[];
 if(includeStorage){
  const [{result}]=await browser.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:()=>({origin:location.origin,localStorage:Object.keys(localStorage).map(name=>({name,value:localStorage.getItem(name)??''}))})});
  if(!result||!market.allowedOrigins.includes(result.origin))throw new Error('A aba mudou durante a captura. Tente novamente.');origins.push(result);
 }
 const session={cookies:[...cookies.values()],origins};
 if(new TextEncoder().encode(JSON.stringify(session)).length>49152)throw new Error('A sessão excede 48 KiB. Desmarque o armazenamento local e tente novamente.');
 return {session,skipped};
}
