// Runs in the isolated page world. Only bounded product data leaves this function.
export async function extractCatalogProduct(input:{profile:any;settings:any;originalUrl:string;allowedOrigins:string[]}):Promise<any>{
 const text=(s:string,n:number)=>s.replace(/\s+/gu,' ').trim().slice(0,n);
 function money(value:string):number|null {
  let raw=value.replace(/R\$/gi,'').replace(/[\s\u00a0]/gu,'');
  if(!/^\d+(?:[.,]\d+)*$/u.test(raw))return null;
  if(raw.includes(',')){if(!/^\d{1,3}(?:\.\d{3})*,\d{1,2}$/u.test(raw)&&!/^\d+,\d{1,2}$/u.test(raw))return null;raw=raw.replaceAll('.','').replace(',','.');}
  else if(/^\d{1,3}(?:\.\d{3})+$/u.test(raw))raw=raw.replaceAll('.','');else if(!/^\d+(?:\.\d{1,2})?$/u.test(raw))return null;
  const cents=Math.round(Number(raw)*100);return Number.isSafeInteger(cents)&&cents>0&&cents<=100000000?cents:null;
 }
 function state(){for(const r of input.settings.blockRules){const match=r.match==='url_contains'?location.href.includes(r.value):r.match==='selector'?!!document.querySelector(r.value):(document.body?.innerText??'').slice(0,500000).includes(r.value);if(match)return r.kind;}return null;}
 function read(){
  const data:any={title:'',brand:'',priceCents:null,originalPriceCents:null,description:'',category:'',conditions:'',externalId:'',productUrl:input.originalUrl,images:[],specifications:[],warnings:[],missing:[],evidence:[],collectedAt:new Date().toISOString()};
  const categories:string[]=[];
  for(const rule of input.profile.rules){
   for(const selector of rule.selectors){
    let nodes:Element[]=[];try{nodes=Array.from(document.querySelectorAll(selector)).slice(0,80);}catch{data.warnings.push('Seletor inválido para '+rule.field);continue;}
    for(const node of nodes){
     let value=rule.mode==='attribute'?node.getAttribute(rule.attribute)??'':(node as HTMLElement).innerText||node.textContent||'';
     if(rule.wholeSelector){const whole=node.querySelector(rule.wholeSelector)?.textContent?.replace(/\D/gu,'');const fraction=rule.fractionSelector?node.querySelector(rule.fractionSelector)?.textContent?.replace(/\D/gu,''):'';value=whole?whole+','+(fraction||'00'):'';}
     value=value.trim();if(!value&&rule.mode!=='pairs')continue;
     if(rule.field==='images'){try{const image=new URL(value,document.baseURI);if(image.protocol==='https:'&&!image.username&&!image.password&&data.images.length<12&&!data.images.includes(image.href))data.images.push(image.href);}catch{/* invalid image ignored */}}
     else if(rule.field==='specifications'){const name=node.querySelector(rule.nameSelector||'th')?.textContent;const val=node.querySelector(rule.valueSelector||'td')?.textContent;if(name&&val&&data.specifications.length<80&&!data.specifications.some((p:any)=>p.name===text(name,150)&&p.value===text(val,600)))data.specifications.push({name:text(name,150),value:text(val,600)});}
     else if(rule.field==='category'){const parts=input.settings.categorySeparator?value.split(input.settings.categorySeparator):[value];for(const part of parts){const clean=text(part,120);if(clean&&categories.length<30)categories.push(clean);}data.category=categories.at(-1)?.slice(0,80)??'';}
     else if(rule.field==='price'||rule.field==='originalPrice'){const key=rule.field==='price'?'priceCents':'originalPriceCents';if(data[key]===null)data[key]=money(value);}
     else if(rule.field==='productUrl'){try{const url=new URL(value,document.baseURI);if(url.protocol==='https:'&&!url.username&&!url.password&&input.allowedOrigins.includes(url.origin))data.productUrl=url.href;}catch{/* original retained */}}
     else if(!data[rule.field])data[rule.field]=text(value,({title:300,brand:120,description:4000,conditions:1500,externalId:100} as Record<string,number>)[rule.field]??300);
     if(data.evidence.length<600)data.evidence.push({field:rule.field,selector});
    }
    if(!['images','specifications','category'].includes(rule.field)){const key=rule.field==='price'?'priceCents':rule.field==='originalPrice'?'originalPriceCents':rule.field;if(data[key])break;}
    else if(rule.field==='category'&&categories.length)break;
   }
  }
  for(const field of new Set(['title','price',...input.profile.rules.filter((r:any)=>r.required).map((r:any)=>r.field)])){
   const key=field==='price'?'priceCents':field==='originalPrice'?'originalPriceCents':String(field),value=data[key];if(value===null||value===''||Array.isArray(value)&&!value.length)data.missing.push(String(field));
  }
  if(data.originalPriceCents!==null&&data.priceCents!==null&&data.originalPriceCents<=data.priceCents)data.originalPriceCents=null;
  return {data,sourceCategoryPath:categories};
 }
 const end=Date.now()+input.settings.timeoutMs;
 let result=read();
 while(true){const block=state();if(block&&block!=='unavailable')return {blocked:block};if(block==='unavailable'){result.data.priceCents=null;return {...result,outcome:'unavailable'};}
  if(!result.data.missing.length)return {...result,outcome:'success'};
  if(Date.now()>=end)return {outcome:'technical_failure',reason:'incomplete'};
  await new Promise(r=>setTimeout(r,250));result=read();
 }
}
