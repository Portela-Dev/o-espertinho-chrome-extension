import {DEFAULT_BACKEND_URL} from './config.js';
import {backendOrigin,validateConfiguration,type State,type Auth,type Recipe,type Configuration} from './contracts.js';
import {executeRecipe} from './executor.js';

const empty=()=>({status:'idle' as const,success:0,failed:0,total:0,message:'Conecte sua conta para começar.'});
let state:State;let initialization:Promise<void>|undefined;let pumping=false;let generation=0;
async function init(){
 initialization??=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const stored=await chrome.storage.local.get('state');state=(stored.state as State)??{backendUrl:DEFAULT_BACKEND_URL,progress:empty()};
  state.backendUrl=backendOrigin(state.backendUrl);await chrome.alarms.create('worker',{periodInMinutes:0.5});
 })();return initialization;
}
const save=()=>chrome.storage.local.set({state});
function view(){return {backendUrl:state.backendUrl,user:state.auth?.user,pairing:!!state.pair,config:state.config,queue:state.queue,marketplaceId:state.marketplaceId,progress:state.progress,version:chrome.runtime.getManifest().version};}
function disconnect(message:string){generation++;delete state.auth;delete state.pair;state.progress.status='paused';state.progress.message=message;}
async function request(path:string,body?:unknown,token?:string){
 const r=await fetch(`${state.backendUrl}/api/extension${path}`,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Espertinho-Extension-Id':chrome.runtime.id,...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 let data:any;try{data=await r.json();}catch{throw new Error('O backend não retornou JSON. Confira BACKEND_URL.');}
 return {r,data};
}
async function api<T>(path:string,body?:unknown,retry=true):Promise<T>{
 const auth=state.auth;if(!auth)throw new Error('Conecte sua conta no O Espertinho.');const current=generation;
 const {r,data}=await request(path,body,auth.token);if(current!==generation)throw new Error('A sessão mudou.');
 if(r.status===401&&retry){
  const renewed=await request('/auth/refresh',{refreshToken:auth.refreshToken});if(current!==generation)throw new Error('A sessão mudou.');
  if(!renewed.r.ok){disconnect('Sessão expirada. Conecte sua conta novamente.');await save();throw new Error(state.progress.message);}
  state.auth=renewed.data as Auth;await save();return api<T>(path,body,false);
 }
 if(r.status===401||r.status===403){disconnect(data.error??'Acesso revogado.');await save();}
 if(!r.ok)throw new Error(data.error??'Falha na comunicação com o backend.');return data as T;
}
async function refresh(){state.config=validateConfiguration(await api<Configuration>('/config'));state.queue=await api<State['queue']>('/queue');await save();}
async function poll(){
 const pair=state.pair;if(!pair||pair.nextAt>Date.now())return;
 if(pair.expiresAt<Date.now()){delete state.pair;state.progress.message='Conexão expirada. Clique em Entrar novamente.';await save();return;}
 pair.nextAt=Date.now()+3000;const current=generation;
 const {r,data}=await request('/auth/poll',{deviceCode:pair.deviceCode,verifier:pair.verifier});if(current!==generation)return;
 if(r.status===202)return;
 if(!r.ok){delete state.pair;state.progress.message=data.error??'Login não autorizado.';await save();return;}
 if(!data.user?.permissions?.includes('affiliate_links'))throw new Error('Perfil sem permissão para gerar links.');
 state.auth=data as Auth;delete state.pair;state.progress=empty();state.progress.message='Conta conectada.';await refresh();
}
async function recipeTab(recipe:Recipe){
 if(state.tabId){try{const tab=await chrome.tabs.get(state.tabId);if(tab.url&&recipe.allowedOrigins.includes(new URL(tab.url).origin))return state.tabId;}catch{/* A aba pode ter sido fechada. */}}
 const tabs=await chrome.tabs.query({url:recipe.allowedOrigins.map(origin=>`${origin}/*`)});
 const existing=tabs.find(tab=>tab.url===recipe.loginUrl);
 const tab=existing??await chrome.tabs.create({url:recipe.loginUrl,active:false});state.tabId=tab.id;await save();
 if(!tab.id)throw new Error('Não foi possível abrir a aba do marketplace.');return tab.id;
}
async function waitForTab(tabId:number,recipe:Recipe){
 for(let attempt=0;attempt<40;attempt++){
  const tab=await chrome.tabs.get(tabId);
  if(tab.status==='complete'&&tab.url){if(!recipe.allowedOrigins.includes(new URL(tab.url).origin))throw new Error('O marketplace redirecionou para uma origem não autorizada.');return;}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('A página do marketplace não terminou de carregar.');
}
async function pump(){
 if(pumping)return;pumping=true;
 try{
  await init();await poll();
  while(state.auth&&state.progress.status==='running'){
   const current=generation,recipe=state.config?.marketplaces.find(m=>m.id===state.marketplaceId);if(!recipe)throw new Error('Escolha um marketplace configurado.');
   if((state.nextAt??0)>Date.now()){const delay=state.nextAt!-Date.now();if(delay>15000)return;await new Promise(resolve=>setTimeout(resolve,delay));if(state.progress.status!=='running')return;}
   if(!state.batch){
    const batch=await api<any>('/batches/claim',{marketplaceId:recipe.id});if(current!==generation)return;
    if(!batch.items.length){state.progress.status=batch.remaining?'paused':'complete';state.progress.message=batch.remaining?'Há links reservados em outra execução. Aguarde a expiração da reserva e continue.':'Todos os links pendentes foram processados.';await refresh();return;}
    state.batch={...batch,results:[]};await save();
   }
   const batch=state.batch!;
   if(batch.leaseExpiresAt<Date.now()){delete state.batch;state.progress.message='Lote expirou. Buscando uma nova reserva.';await save();continue;}
   for(const item of batch.items.slice(batch.results.length)){
    if(current!==generation||state.progress.status!=='running')return;
    state.progress.currentTitle=item.title;state.progress.message='Gerando link…';await save();
    const tabId=await recipeTab(recipe);await waitForTab(tabId,recipe);
    const [{result}]=await chrome.scripting.executeScript({target:{tabId},func:executeRecipe,args:[recipe,item],world:'ISOLATED'});
    if(current!==generation)return;
    if(result?.needsLogin){state.progress.status='paused';state.progress.message=result.error??'Confirme o login no marketplace.';await chrome.tabs.update(tabId,{active:true});await save();return;}
    batch.results.push(result?.affiliateUrl?{id:item.id,affiliateUrl:result.affiliateUrl}:{id:item.id,error:result?.error??'Não foi possível executar a conversão.'});
    state.nextAt=Date.now()+recipe.intervalMs;await save();
    if(recipe.intervalMs>15000)return;
    await new Promise(resolve=>setTimeout(resolve,recipe.intervalMs));
   }
   if(current!==generation||state.progress.status!=='running')return;
   await api('/batches/results',{leaseId:batch.leaseId,results:batch.results});if(current!==generation)return;
   state.progress.success+=batch.results.filter(r=>!!r.affiliateUrl).length;state.progress.failed+=batch.results.filter(r=>!!r.error).length;
   delete state.batch;delete state.progress.currentTitle;await refresh();
  }
 }catch(error){if(state){state.progress.status='paused';state.progress.message=error instanceof Error?error.message:'Falha de comunicação. Clique em Continuar para tentar novamente.';await save();}}
 finally{pumping=false;}
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)){respond({error:'Origem não autorizada.'});return false;}
 void(async()=>{
  await init();
  switch(message.type){
   case 'STATE': void pump();return view();
   case 'LOGIN':{
    if(state.auth)return view();generation++;
    const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
    const challenge=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),v=>v.toString(16).padStart(2,'0')).join('');
    const {r,data}=await request('/auth/start',{challenge});if(!r.ok)throw new Error(data.error??'Não foi possível iniciar a conexão.');
    if(new URL(data.verificationUrl).origin!==state.backendUrl)throw new Error('URL de conexão inválida.');
    state.pair={...data,verifier,nextAt:0};state.progress.message='Entre no site com Google e autorize esta extensão na aba aberta.';await save();await chrome.tabs.create({url:data.verificationUrl});return view();
   }
   case 'LOGOUT':{
    try{if(state.auth)await api('/auth/logout',{});}finally{disconnect('Você saiu. Conecte sua conta para continuar.');delete state.batch;delete state.config;delete state.queue;await save();}return view();
   }
   case 'BACKEND':{
    if(state.auth||state.progress.status==='running')throw new Error('Saia da conta antes de trocar o backend.');state.backendUrl=backendOrigin(message.url);delete state.pair;delete state.config;delete state.batch;state.progress=empty();generation++;await save();return view();
   }
   case 'REFRESH': await refresh();return view();
   case 'OPEN':{
    const recipe=state.config?.marketplaces.find(m=>m.id===message.marketplaceId);if(!recipe)throw new Error('Marketplace inválido.');
    const tab=await chrome.tabs.create({url:recipe.loginUrl});state.tabId=tab.id;await save();return view();
   }
   case 'START':{
    await refresh();const recipe=state.config?.marketplaces.find(m=>m.id===message.marketplaceId);if(!recipe)throw new Error('Marketplace inválido.');
    if(!await chrome.permissions.contains({origins:recipe.allowedOrigins.map(o=>`${o}/*`)}))throw new Error('Autorize o acesso aos domínios do marketplace.');
    if(state.progress.status==='running')return view();
    if(state.marketplaceId!==recipe.id){delete state.batch;state.progress=empty();}
    state.marketplaceId=recipe.id;state.progress.status='running';state.progress.total=(state.queue?.items.filter(i=>i.state==='pending'||i.state==='leased').length??0)+state.progress.success+state.progress.failed;state.progress.message='Iniciando processamento…';await save();void pump();return view();
   }
   case 'PAUSE':state.progress.status='paused';state.progress.message='Pausado. Os resultados já gerados serão enviados ao continuar.';await save();return view();
   case 'RESET':if(state.progress.status==='running')throw new Error('Pause o processamento primeiro.');await api('/queue/reset',{});delete state.batch;state.progress=empty();await refresh();return view();
   default:throw new Error('Operação desconhecida.');
  }
 })().then(value=>respond({value})).catch(error=>respond({error:error instanceof Error?error.message:'Operação não concluída.'}));return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='worker')void pump();});
chrome.runtime.onStartup.addListener(()=>{void pump();});
chrome.runtime.onInstalled.addListener(()=>{void init();});
