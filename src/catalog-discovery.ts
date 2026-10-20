// Serialized into the isolated world. No imports or credentials are used here.
export async function discoverPage(input:{config:any;rules:any[];action:'read'|'advance';page:number}):Promise<any>{
 const {config,rules}=input;
 function blocked(){for(const r of rules){if(r.kind==='unavailable')continue;const match=r.match==='url_contains'?location.href.includes(r.value):r.match==='selector'?!!document.querySelector(r.value):(document.body?.innerText??'').slice(0,500000).includes(r.value);if(match)return r.kind;}return null;}
 function safeUrl(raw:string){const u=new URL(raw,document.baseURI);if(u.protocol!=='https:'||u.username||u.password)throw Error('permission');return u.href;}
 const state=blocked();if(state)return {blocked:state};
 if(config.rendering.frameSelector)throw Error('configuration');
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 if(input.action==='advance'){
  const p=config.pagination;
  if(p.mode==='scroll'){const scroller=p.scrollContainerSelector?document.querySelector(p.scrollContainerSelector):window;if(!scroller)throw Error('configuration');scroller.scrollBy(0,p.scrollStepPx);}
  else{const next=document.querySelector<HTMLElement>(p.nextSelector);if(!next)return {end:true};next.click();}
  await wait(config.pagination.waitAfterMs);return {advanced:true};
 }
 const end=Date.now()+config.rendering.timeoutMs;
 while(Date.now()<end){const block=blocked();if(block)return {blocked:block};if(document.querySelector(config.rendering.readySelector||config.extraction.itemSelector))break;await wait(200);}
 await wait(config.rendering.settleDelayMs);
 const block=blocked();if(block)return {blocked:block};
 const cards=Array.from(document.querySelectorAll(config.extraction.itemSelector));
 if(!cards.length)throw Error('incomplete');
 const links:string[]=[];let invalid=0;
 for(const card of cards.slice(0,500)){
  const el=config.extraction.linkSelector===':scope'?card:card.querySelector(config.extraction.linkSelector);
  const raw=el?.getAttribute(config.extraction.linkAttribute);
  try{if(raw)links.push(safeUrl(raw));else invalid++;}catch{invalid++;}
 }
 if(!links.length)throw Error('incomplete');
 const p=config.pagination;
 let done=p.mode==='single'||!!(p.endSelector&&document.querySelector(p.endSelector));
 let nextUrl:string|undefined;
 if(!done&&['next','load_more'].includes(p.mode)){
  const next=document.querySelector(p.nextSelector);
  const disabled=!!next&&(next.hasAttribute('disabled')||next.getAttribute('aria-disabled')==='true'||!!(p.disabledSelector&&next.matches(p.disabledSelector)));
  if(!next||disabled){if(!next&&p.missingNextAction==='failure')throw Error('incomplete');done=true;}
  else{const href=next.getAttribute('href');if(p.mode==='next'&&href)nextUrl=safeUrl(href);}
 }
 if(p.mode==='url')nextUrl=safeUrl(p.urlTemplate.replaceAll('{page}',String(p.startPage+input.page*p.pageStep)));
 return {links:[...new Set(links)],invalid,done,nextUrl,url:location.href};
}
