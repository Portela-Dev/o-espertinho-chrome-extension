import type {Recipe} from './contracts.js';
type Capture={name:string;header:string;url:string};
type Memory={recipeId:string;captures:Capture[];expiresAt:number;values:Record<string,string>;tabId:number};
const storageKey='affiliateRequestHeaders';
export class RequestHeaderMemory {
 constructor(private readonly browser:typeof chrome){}
 async arm(recipe:Recipe,tabId:number){
  const captures:Capture[]=recipe.steps.flatMap(s=>{
   if(s.type!=='extract'||s.source!=='requestHeader')return [];
   const url=new URL(s.sourceUrl!);
   if(!/^(?:x-[\w-]+|csrf-token)$/i.test(s.key??'')||url.protocol!=='https:'||!recipe.allowedOrigins.includes(url.origin)||url.username||url.password)throw new Error('Origem de observação inválida.');
   return [{name:s.name,header:s.key!.toLowerCase(),url:url.origin+url.pathname}];
  });
  await this.browser.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await this.browser.storage.session.set({[storageKey]:{recipeId:recipe.id,captures,expiresAt:Date.now()+900000,values:{},tabId}});
 }
 async clear(){await this.browser.storage.session.remove(storageKey);}
 async observe(details:{url:string;tabId:number;initiator?:string;requestHeaders?:{name:string;value?:string}[]}){
  const memory=(await this.browser.storage.session.get(storageKey))[storageKey] as Memory|undefined;
  if(!memory||memory.expiresAt<Date.now()||details.tabId!==memory.tabId)return;
  const url=new URL(details.url);if(details.initiator!==url.origin&&details.initiator!=='chrome-extension://'+this.browser.runtime.id)return;
  let changed=false;
  for(const capture of memory.captures){
   if(url.origin+url.pathname!==capture.url)continue;
   const value=details.requestHeaders?.find(h=>h.name.toLowerCase()===capture.header)?.value;
   if(value&&value.length<=8192){memory.values[capture.name]=value;changed=true;}
  }
  if(changed)await this.browser.storage.session.set({[storageKey]:memory});
 }
 async values(recipe:Recipe){
  const memory=(await this.browser.storage.session.get(storageKey))[storageKey] as Memory|undefined;
  const needed=recipe.steps.filter(s=>s.type==='extract'&&s.source==='requestHeader');
  if(!needed.length)return {};
  if(memory?.recipeId!==recipe.id||memory.expiresAt<Date.now()||needed.some(s=>s.type!=='extract'||!Object.hasOwn(memory.values,s.name)||typeof memory.values[s.name]!=='string'||!memory.values[s.name]||!memory.captures.some(c=>c.name===s.name&&c.url===new URL(s.sourceUrl!).origin+new URL(s.sourceUrl!).pathname&&c.header===s.key!.toLowerCase())))throw new Error('Gere um link manualmente na aba preparada para observar o header de sessão.');
  return memory.values;
 }
 async ready(recipe:Recipe){try{await this.values(recipe);return true;}catch{return false;}}
}
