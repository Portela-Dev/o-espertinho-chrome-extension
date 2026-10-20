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
