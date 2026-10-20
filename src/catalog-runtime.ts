import {discoveryPolicy,failureKind} from './catalog-policy.js';
import {DEFAULT_BACKEND_URL} from './config.js';
import {backendOrigin,validateRecipe,type Auth} from './contracts.js';
import {RequestHeaderMemory} from './request-header-memory.js';
import {CatalogNavigation} from './catalog-navigation.js';
import {discoverPage} from './catalog-discovery.js';
import {extractCatalogProduct} from './catalog-product.js';
import {executeRecipe} from './executor.js';
import type {CatalogState,CatalogRun,CatalogStep,CatalogClaim,CatalogMarket} from './catalog-types.js';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export class CatalogRuntime {
 state!:CatalogState;
 private initialization?:Promise<void>;private pumping=false;private generation=0;private nextRequestAt=0;private timer?:ReturnType<typeof setTimeout>;
 private headers:RequestHeaderMemory;private navigation:CatalogNavigation;
 constructor(private readonly browser:typeof chrome=chrome){this.headers=new RequestHeaderMemory(browser);this.navigation=new CatalogNavigation(browser,()=>this.state,()=>this.save());}
 async init(){this.initialization??=this.load();await this.initialization;}
 private async load(){
  await this.browser.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const old=(await this.browser.storage.local.get('state')).state as CatalogState|undefined;
  this.state=old?.version===2?old:{version:2,backendUrl:old?.backendUrl??DEFAULT_BACKEND_URL,auth:old?.auth,markets:[],message:'Conecte sua conta para começar.'};
  this.state.backendUrl=backendOrigin(this.state.backendUrl);await this.browser.alarms.create('worker',{periodInMinutes:0.5});await this.save();
 }
 private save(){return this.browser.storage.local.set({state:this.state});}
 private async disconnect(){this.generation++;clearTimeout(this.timer);await this.headers.clear();delete this.state.auth;delete this.state.pair;delete this.state.claim;delete this.state.pendingResult;delete this.state.run;delete this.state.nextAt;delete this.state.locallyPaused;this.state.markets=[];this.state.message='Sessão encerrada. Entre novamente.';await this.save();}
 private async request(path:string,body?:unknown,token?:string){
  const delay=Math.max(0,this.nextRequestAt-Date.now());this.nextRequestAt=Math.max(Date.now(),this.nextRequestAt)+300;if(delay)await sleep(delay);
  const response=await fetch(this.state.backendUrl+'/api/extension'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Espertinho-Extension-Id':this.browser.runtime.id,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
  let data:any;try{data=await response.json();}catch{throw Error('Resposta inválida do backend.');}return {response,data};
 }
 private async api<T=any>(path:string,body?:unknown,retry=true):Promise<T>{
  const auth=this.state.auth,generation=this.generation;if(!auth)throw Error('Entre no O Espertinho.');
  const {response,data}=await this.request(path,body,auth.token);if(generation!==this.generation)throw Error('Operação interrompida.');
  if(response.status===401&&retry){const renewed=await this.request('/auth/refresh',{refreshToken:auth.refreshToken});if(generation!==this.generation)throw Error('Operação interrompida.');if(renewed.response.ok){this.state.auth=renewed.data as Auth;await this.save();return this.api(path,body,false);}}
  if(response.status===401||response.status===403)await this.disconnect();
  if(!response.ok)throw Error(data.error??'Não foi possível concluir a operação.');return data as T;
 }
 async observeAffiliateHeaders(details:Parameters<RequestHeaderMemory['observe']>[0]){await this.init();await this.headers.observe(details);}
 private async refresh(){const config=await this.api('/catalog/config');this.state.markets=config.marketplaces;if(this.state.run){this.state.run=await this.api('/catalog/runs/'+this.state.run.id);if(['completed','cancelled','failed'].includes(this.state.run!.status))this.state.locallyPaused=false;}await this.save();}
 private market(id?:string):CatalogMarket{const market=this.state.markets.find(m=>m.id===(id??this.state.marketplaceId));if(!market)throw Error('Escolha um marketplace.');return market;}
 private async login(){
  const verifier=hex(crypto.getRandomValues(new Uint8Array(32)).buffer),challenge=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const {response,data}=await this.request('/auth/start',{challenge});if(!response.ok)throw Error(data.error??'Falha no login.');
  const url=new URL(data.verificationUrl);if(url.origin!==this.state.backendUrl)throw Error('Origem de login inválida.');
  this.state.pair={...data,verifier,nextAt:0};await this.save();await this.browser.tabs.create({url:url.href,active:true});
 }
 private async poll(){
  const pair=this.state.pair;if(!pair||pair.nextAt>Date.now())return;
  if(pair.expiresAt<Date.now()){delete this.state.pair;this.state.message='Conexão expirada. Entre novamente.';await this.save();return;}
  pair.nextAt=Date.now()+3000;const generation=this.generation;
  const {response,data}=await this.request('/auth/poll',{deviceCode:pair.deviceCode,verifier:pair.verifier});if(generation!==this.generation)return;
  if(response.status===202)return;if(!response.ok)throw Error(data.error??'Login recusado.');
  if(!data.user?.permissions?.includes('affiliate_links'))throw Error('Perfil sem permissão para gerar links.');
  this.state.auth=data;delete this.state.pair;this.state.message='Conta conectada.';await this.refresh();
 }
 private async prepare(market:CatalogMarket){
  const recipe=market.config.recipe;if(recipe)validateRecipe(recipe);
  if(this.state.run&&!['completed','failed','cancelled'].includes(this.state.run.status)&&this.state.run.marketplace_id!==market.id)throw Error('Prepare o marketplace da execução atual.');
  if(this.state.tabId){try{await this.browser.tabs.get(this.state.tabId);}catch{delete this.state.tabId;delete this.state.windowId;await this.save();}}
  const tabId=await this.navigation.ensure(recipe?.loginUrl??market.website_url,market.allowedOrigins);await this.navigation.wait(market.allowedOrigins,market.config.timeoutMs);if(recipe)await this.headers.arm(recipe,tabId);else await this.headers.clear();await this.navigation.focus();
  this.state.message='Faça login se necessário. Se a receita usa header de requisição, gere um link manualmente nesta janela para prepará-lo.';await this.save();
 }
 async handle(command:{type:string;marketplaceId?:string;step?:CatalogStep;url?:string;limit?:number;retryFailed?:boolean;runId?:string;page?:number;pageSize?:number}){
  await this.init();
  switch(command.type){
   case 'STATE':break;
   case 'LOGIN':await this.login();break;
   case 'LOGOUT':this.generation++;if(this.state.auth){try{await this.api('/auth/logout',{});}finally{await this.disconnect();}}else await this.disconnect();break;
   case 'REFRESH':await this.refresh();break;
   case 'BACKEND':if(this.state.auth||this.state.pair)throw Error('Saia antes de alterar o backend.');this.state.backendUrl=backendOrigin(command.url!);delete this.state.run;delete this.state.claim;delete this.state.pendingResult;await this.save();break;
   case 'PREPARE':this.state.marketplaceId=this.market(command.marketplaceId).id;await this.prepare(this.market());break;
   case 'START':{
    if(this.state.run&&!['completed','cancelled','failed'].includes(this.state.run.status))throw Error('Conclua ou cancele a execução atual.');
    const market=this.market(command.marketplaceId);if(market.catalog_executor!=='extension')throw Error('Ative o executor da extensão no admin.');
    this.state.marketplaceId=market.id;
    if(command.step==='convert'){if(!market.config.recipe)throw Error('Cadastre a receita de conversão.');await this.headers.values(market.config.recipe);}
    this.state.locallyPaused=false;this.state.run=await this.api('/catalog/runs',{marketplaceId:market.id,step:command.step,requestKey:crypto.randomUUID(),limit:command.limit??100,retryFailed:command.retryFailed??false});delete this.state.claim;delete this.state.pendingResult;delete this.state.nextAt;await this.save();void this.pump();break;
   }
   case 'ATTACH':{
    const run=await this.api<CatalogRun>('/catalog/runs/'+command.runId);if(this.state.run&&this.state.run.id!==run.id&&!['completed','cancelled','failed'].includes(this.state.run.status))throw Error('Já existe uma execução local.');this.state.run=run;this.state.locallyPaused=false;await this.save();break;
   }
   case 'RUNS':return this.api('/catalog/runs?page='+Math.max(1,command.page??1)+'&pageSize='+Math.min(50,Math.max(1,command.pageSize??10))); 
   case 'FOCUS':await this.navigation.focus();break;
   case 'PAUSE':await this.action('pause');break;
   case 'CANCEL':await this.action('cancel');delete this.state.claim;delete this.state.pendingResult;break;
   case 'RESUME':{
    const run=this.state.run;if(!run)throw Error('Não há execução para retomar.');
    const rules=run.snapshot.settings.blockRules;
    if(this.state.tabId){const blocked=await this.navigation.inspect(rules);if(blocked&&blocked!=='unavailable')throw Error('A página ainda exige intervenção: '+blocked);}
    this.state.run=await this.api('/catalog/runs/'+run.id+'/action',{action:'resume'});this.state.locallyPaused=false;delete this.state.claim;delete this.state.pendingResult;await this.save();void this.pump();break;
   }
   default:throw Error('Operação desconhecida.');
  }
  if(command.type==='STATE')void this.pump();return this.view();
 }
 private view(){return {backendUrl:this.state.backendUrl,user:this.state.auth?.user,pairing:!!this.state.pair,markets:this.state.markets,marketplaceId:this.state.marketplaceId,run:this.state.run,message:this.state.message,version:this.browser.runtime.getManifest().version};}
 private async action(action:'pause'|'cancel'|'human'|'technical',reason=''){
  if(!this.state.run)return;this.generation++;this.state.locallyPaused=action!=='cancel';this.state.run=await this.api('/catalog/runs/'+this.state.run.id+'/action',{action,reason});await this.save();
 }
 private async execute(claim:CatalogClaim):Promise<any>{
  const generation=this.generation;const assertActive=()=>{if(generation!==this.generation)throw Error('interrupted');};
  const {item,snapshot,step}=claim;if(!item)throw Error('incomplete');const origins=snapshot.market.allowedHosts.map((h:string)=>'https://'+h),settings=snapshot.settings;
  let url=item.payload.url;
  if(step==='convert')url=settings.recipe.loginUrl;
  const checkpoint=item.payload.checkpoint;
  const sameTab=!!this.state.tabId;
  if(step==='discover'&&checkpoint)url=checkpoint.url;
  await this.navigation.ensure(url,origins,!(step==='convert'&&sameTab)&&!(step==='discover'&&checkpoint&&sameTab&&(['load_more','scroll'].includes(item.payload.config.pagination.mode)||checkpoint.advance)));
  await this.navigation.wait(origins,settings.timeoutMs);
  assertActive();const block=await this.navigation.inspect(settings.blockRules);if(block&&block!=='unavailable')return {blocked:block};
  const inject=async(func:any,args:any[])=>{assertActive();const values=await this.browser.scripting.executeScript({target:{tabId:this.state.tabId!},world:'ISOLATED',func,args});const value=values[0]?.result;if(value===undefined)throw Error('incomplete');return value as any;};
  if(step==='convert'){
   const recipe=settings.recipe;validateRecipe(recipe);const variables=await this.headers.values(recipe);
   const result=await inject(executeRecipe,[recipe,{id:item.id,title:item.payload.title??'',originalUrl:item.payload.originalUrl},variables]);
   if(result.needsLogin)return {blocked:'login'};if(!result.affiliateUrl)return {outcome:'technical_failure',reason:'configuration'};return {outcome:'success',affiliateUrl:result.affiliateUrl};
  }
  if(step==='discover'){
   const config=item.payload.config,page=(checkpoint?.page??0)+1;
   if(config.rendering.frameSelector)throw Error('configuration');
   if(checkpoint&&(['load_more','scroll'].includes(config.pagination.mode)||checkpoint.advance)){if(!sameTab)throw Error('incomplete');const advance=await inject(discoverPage,[{config,rules:settings.blockRules,action:'advance',page}]);if(advance.blocked)return advance;await sleep(Math.max(50,config.pagination.waitAfterMs));await this.navigation.wait(origins,settings.timeoutMs);}
   const result=await inject(discoverPage,[{config,rules:settings.blockRules,action:'read',page}]);if(result.blocked)return result;
   if(result.invalid&&discoveryPolicy(config,'invalidItem',5).action!=='skip_item')throw Error('invalidItem');
   const links=result.links.filter((value:string)=>{try{return origins.includes(new URL(value).origin);}catch{return false;}});
   const identity=links.map((value:string)=>{const u=new URL(value);u.search='';u.hash='';for(const rule of snapshot.market.normalizationRules??[]){if(rule.type==='remove_path_suffix'){const at=u.pathname.indexOf(rule.marker);if(at>=0)u.pathname=u.pathname.slice(0,at)||'/';}}return u.href;}).sort().join('\n');
   const fingerprint=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))),seen=checkpoint?.seen??[],found=(checkpoint?.found??0)+links.length;
   const noProgress=seen.includes(fingerprint)?(checkpoint?.noProgress??0)+1:0;
   const done=result.done||(['next','url'].includes(config.pagination.mode)&&seen.includes(fingerprint))||page>=config.limits.maxPages||found>=config.limits.maxItems||noProgress>=config.pagination.noProgressLimit;
   if(links.length!==result.links.length&&discoveryPolicy(config,'invalidItem',5).action!=='skip_item')throw Error('invalidItem');
   return {outcome:'success',links:links.slice(0,Math.max(0,config.limits.maxItems-(checkpoint?.found??0))),done,checkpoint:{url:result.nextUrl??result.url,page,seen:[...seen,fingerprint].slice(-1000),found:Math.min(found,config.limits.maxItems),noProgress,advance:!done&&config.pagination.mode==='next'&&!result.nextUrl}};
  }
  return inject(extractCatalogProduct,[{profile:snapshot.profile,settings,originalUrl:item.payload.originalUrl,allowedOrigins:origins}]);
 }
 private async executeWithPolicy(claim:CatalogClaim):Promise<any>{
  if(claim.step!=='discover')return this.execute(claim);
  const config=claim.item!.payload.config,generation=this.generation;
  const previous=claim.item!.payload.checkpoint,startedAt=claim.item!.payload.startedAt;
  if(startedAt&&config.limits.maxDurationSeconds&&(Date.now()-Date.parse(startedAt))>config.limits.maxDurationSeconds*1000){
   if(config.failures?.limitReached==='pause_source')return {outcome:'technical_failure',reason:'incomplete',failureType:'limit'};
   return {outcome:'success',links:[],done:true,checkpoint:{url:previous?.url??claim.item!.payload.url,page:(previous?.page??0)+1,seen:previous?.seen??[],found:previous?.found??0,noProgress:previous?.noProgress??0}};
  }

  for(let attempt=0;attempt<=5;attempt++){
   if(generation!==this.generation)throw Error('interrupted');
   try{return await this.execute(claim);}catch(error){
    const message=error instanceof Error?error.message:'navigation';
    if(['permission','tab_closed','interrupted','access_denied'].includes(message))throw error;
    if(message==='limit')return {outcome:'technical_failure',reason:'incomplete',failureType:'limit'};
    const kind=failureKind(message),policy=discoveryPolicy(config,kind,attempt);
    if(policy.retry){await sleep(policy.delayMs);continue;}
    if(policy.action==='skip_page'&&config.pagination.mode==='url'){
     const previous=claim.item!.payload.checkpoint,page=(previous?.page??0)+1;
     const url=config.pagination.urlTemplate.replaceAll('{page}',String(config.pagination.startPage+page*config.pagination.pageStep));
     return {outcome:'success',links:[],done:page>=config.limits.maxPages,reason:'incomplete',failureType:kind,checkpoint:{url,page,seen:previous?.seen??[],found:previous?.found??0,noProgress:previous?.noProgress??0}};
    }
    return {outcome:'technical_failure',reason:'incomplete',failureType:kind};
   }
  }
  throw Error('incomplete');
 }
 async pump(){
  await this.init();if(this.pumping)return;this.pumping=true;
  try{
   if(this.state.pair)await this.poll();
   const run=this.state.run;if(!this.state.auth||!run||this.state.locallyPaused)return;
   if(['queued','running'].includes(run.status)&&(this.state.nextAt??0)>Date.now())return;
   this.state.run=await this.api<CatalogRun>('/catalog/runs/'+run.id);
   if(!['queued','running'].includes(this.state.run.status)||((this.state.nextAt??0)>Date.now()))return;
   const generation=this.generation;
   if(this.state.pendingResult){await this.api('/catalog/runs/'+run.id+'/results',this.state.pendingResult);delete this.state.pendingResult;delete this.state.claim;await this.save();}
   if(!this.state.claim){this.state.claim=await this.api<CatalogClaim>('/catalog/runs/'+run.id+'/claim',{});await this.save();}
   const claim=this.state.claim;if(!claim?.item){delete this.state.claim;this.state.run=await this.api('/catalog/runs/'+run.id);this.state.nextAt=Date.now()+30000;await this.save();return;}
   const currentItem=claim.item;
   await this.api('/catalog/runs/'+run.id+'/heartbeat',{itemId:currentItem.id,leaseToken:currentItem.lease_token});
   const heart=setInterval(()=>{void this.api('/catalog/runs/'+run.id+'/heartbeat',{itemId:currentItem.id,leaseToken:currentItem.lease_token}).catch(()=>{});},45000);
   let result:any;try{result=await this.executeWithPolicy(claim);}finally{clearInterval(heart);}
   if(generation!==this.generation)return;
   if(result.blocked){await this.action('human',result.blocked);this.state.message='Intervenção necessária: '+result.blocked+'. Abra a janela de processamento e depois clique em Continuar.';await this.save();return;}
   this.state.pendingResult={itemId:currentItem.id,leaseToken:currentItem.lease_token,...result};await this.save();
   await this.api('/catalog/runs/'+run.id+'/results',this.state.pendingResult);
   delete this.state.pendingResult;delete this.state.claim;this.state.nextAt=Date.now()+Math.max(claim.snapshot.settings.intervalMs,claim.step==='discover'?currentItem.payload.config.limits.requestIntervalMs:0,claim.step==='convert'?claim.snapshot.settings.recipe.intervalMs:0);
   this.state.run=await this.api('/catalog/runs/'+run.id);this.state.message='Resultado salvo.';await this.save();
  }catch(error){
   const reason=error instanceof Error?error.message:'';this.state.message=reason;
   if(this.state.auth&&this.state.run&&['queued','running'].includes(this.state.run.status)){const code=['permission','tab_closed','incomplete'].includes(reason)?reason:'network';try{await this.action('technical',code);}catch{if(this.state.run)this.state.run.status='paused_technical';this.state.locallyPaused=true;}}
   await this.save();
  }finally{
   this.pumping=false;clearTimeout(this.timer);
   if(this.state.auth&&!this.state.locallyPaused&&this.state.run&&['queued','running'].includes(this.state.run.status))this.timer=setTimeout(()=>{void this.pump();},Math.max(100,(this.state.nextAt??0)-Date.now()));
  }
 }
}
