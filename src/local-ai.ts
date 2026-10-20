const LOCAL='http://127.0.0.1:18765';
const KEY='localAiConnection';
export async function localAiRequest(path:string,body:Record<string,unknown>={},browser:typeof chrome=chrome){
 if(!['/pair','/status','/login','/logout','/models','/analyze','/cancel'].includes(path))throw new Error('Operação local inválida.');
 if(!await browser.permissions.contains({origins:['http://127.0.0.1/*']}))throw new Error('Autorize a conexão com o auxiliar local.');
 await browser.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
 const stored=(await browser.storage.session.get(KEY))[KEY],key=typeof stored==='string'?stored:'';
 if(path!=='/pair'&&!key)throw new Error('Vincule o auxiliar com o código exibido no terminal.');
 let response:Response;
 try{response=await fetch(LOCAL+path,{method:'POST',headers:{'Content-Type':'application/json',...(path==='/pair'?{}:{'X-Espertinho-Local':key})},body:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});}
 catch{throw new Error('Auxiliar local indisponível. Execute npm run ai:helper na pasta da extensão.');}
 const value=await response.json();
 if(!response.ok){if(response.status===401)await browser.storage.session.remove(KEY);throw new Error(value.error||'Falha no auxiliar local.');}
 if(path==='/pair'){
  if(typeof value.key!=='string')throw new Error('Resposta de vínculo inválida.');
  await browser.storage.session.set({[KEY]:value.key});return {paired:true};
 }
 return value;
}
// Only structured, bounded product metadata is read; no cookies, scripts, or page storage leave the tab.
export function readOfferMetadata(){
 const meta=(name:string)=>document.querySelector<HTMLMetaElement>(`meta[property="${name}"],meta[name="${name}"]`)?.content??'';
 let product:any;
 for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0,20)){
  if((script.textContent?.length??0)>100000)continue;
  try{
   const value=JSON.parse(script.textContent||'{}');
   const nodes=(Array.isArray(value)?value:[value]).flatMap(v=>[v,...(Array.isArray(v?.['@graph'])?v['@graph']:[])]);
   product=nodes.find(v=>v&&[v['@type']].flat().includes('Product'));if(product)break;
  }catch{/* Ignore malformed metadata. */}
 }
 const scalar=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
 return {title:scalar(product?.name||meta('og:title')||document.title,500),description:scalar(product?.description||meta('og:description')||meta('description'),8000),brand:scalar(typeof product?.brand==='string'?product.brand:product?.brand?.name,200),sourceCategory:scalar(product?.category,1500)};
}
export async function captureAiOffer(browser:typeof chrome=chrome){
 const [tab]=await browser.tabs.query({active:true,currentWindow:true});
 if(!tab?.id||!tab.url?.startsWith('https://'))throw new Error('Abra uma página HTTPS de produto na aba ativa.');
 const results=await browser.scripting.executeScript({target:{tabId:tab.id},func:readOfferMetadata});
 if(!results[0]?.result?.title)throw new Error('Não foi possível identificar o nome da oferta. Preencha os dados manualmente.');
 return results[0].result;
}
