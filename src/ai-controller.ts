import {PersistentAiSession} from './persistent-ai-session.js';
import {OpenAISession,LocalError} from './shared/openai-session.mjs';
import {analyze} from './shared/analysis.mjs';

export const DIRECT_CALLBACK='http://127.0.0.1:18766/auth/callback';
const ORIGINS=['https://auth.openai.com/*','https://api.openai.com/*','http://127.0.0.1/*'];
const KEY='directAiRegistrationV1';
const safeError=(error:unknown)=>error instanceof LocalError?error.message:'Não foi possível concluir a chamada direta à OpenAI. Confira sua conexão e tente novamente.';
export class AiController {
 private loginTab?:number;
 private processing=false;
 private controller?:AbortController;
 private operation=0;
 private phase='idle';
 private error='';
 private result:any=null;
 private modelsList:{id:string;name:string}[]=[];
 private callbackObserved=false;
 private selectedModel='';
 private syncedSessionId='';
 private syncing=false;
 private readonly onRequest:Parameters<typeof chrome.webRequest.onBeforeRequest.addListener>[0];
 private readonly onTabRemoved:(tabId:number)=>void;
 constructor(private readonly session:OpenAISession,private readonly browser:typeof chrome=chrome){
  this.onRequest=details=>{void this.receive(details).catch(()=>{});return undefined;};
  this.onTabRemoved=tabId=>{
   if(tabId===this.loginTab&&!this.processing){this.loginTab=undefined;this.session.pending=null;this.session.generation++;this.phase='failed';this.error='A aba de login foi fechada. Inicie uma nova tentativa.';}
  };
  this.browser.webRequest.onBeforeRequest.addListener(this.onRequest,{urls:['http://127.0.0.1:18766/auth/callback*'],types:['main_frame']});
  this.browser.tabs.onRemoved.addListener(this.onTabRemoved);
 }
 static async create(browser:typeof chrome=chrome){
  await browser.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const old=(await browser.storage.local.get(KEY))[KEY] as any;
  const hostId=typeof old?.hostId==='string'&&/^urn:uuid:[\da-f-]{36}$/.test(old.hostId)?old.hostId:'urn:uuid:'+crypto.randomUUID();
  const registrations=Array.isArray(old?.registrations)?old.registrations.filter((r:any)=>typeof r?.clientId==='string'&&typeof r?.subject==='string'&&typeof r?.email==='string').slice(-20).map((r:any)=>({clientId:r.clientId,subject:r.subject,email:r.email})):[];
  const saveRegistrations=async(rows:any[])=>{await browser.storage.local.set({[KEY]:{hostId,registrations:rows.map(r=>({clientId:r.clientId,subject:r.subject,email:r.email}))}});};
  await saveRegistrations(registrations);
  const app=new AiController(new PersistentAiSession({hostId,registrations,saveRegistrations},browser),browser);
  try{await app.sync();}catch{app.error='A sessão local não pôde ser recuperada. Entre novamente no ChatGPT.';}
  if(app.session.active)try{await app.models();}catch{/* Offline restoration retains the saved account/model; authorized requests still validate online. */}
  return app;
 }
 private async admin(){
  const reply=await this.browser.runtime.sendMessage({type:'STATE'});
  if(reply.error||!reply.value?.user?.permissions?.includes('affiliate_links'))throw new LocalError('Entre no O Espertinho com permissão de gerar links de afiliados.');
 }
 status(){
  const account=this.session.status();
  if(this.phase==='waiting_for_login'&&!account.loginPending){this.phase='failed';this.error=account.error||'A tentativa de login expirou. Inicie novamente.';}
  return {...account,usage:(this.session as any).usage??{requests:0,totalTokens:0},phase:this.phase,error:this.error||account.error,models:this.modelsList,selectedModel:this.selectedModel,activeAccountId:this.session.active?.clientId??'',result:this.result,callbackObserved:this.callbackObserved};
 }
 async sync(){
  if(!(this.session instanceof PersistentAiSession)||this.syncing||this.processing||['waiting_for_login','validating_identity'].includes(this.phase))return;
  this.syncing=true;try{
   const record=await this.session.sync();
   if(this.syncedSessionId!==record.sessionId){if(this.phase==='analyzing')this.cancelAnalysis();this.modelsList=[];this.result=null;this.error='';this.selectedModel='';this.syncedSessionId=record.sessionId;this.phase=record.account?'connected':'idle';}
   this.modelsList=record.models;this.selectedModel=record.model;if(!record.account)this.phase='idle';else if(this.phase==='idle')this.phase='connected';
  }finally{this.syncing=false;}
 }
 async selectModel(model:string){
  if(!this.modelsList.some(m=>m.id===model))throw new LocalError('Escolha um modelo disponível nesta conta.');
  if(this.session instanceof PersistentAiSession)await this.session.selectModel(model);
  this.selectedModel=model;
 }
 async login(accountId?:string){
  if(this.phase==='analyzing'||this.processing)throw new LocalError('Conclua ou cancele a operação atual antes de entrar novamente.');
  if(!await this.browser.permissions.request({origins:ORIGINS}))throw new LocalError('Autorize acesso aos endpoints oficiais da OpenAI e ao retorno local.');
  await this.admin();await this.cancelLogin();
  this.error='';this.result=null;this.callbackObserved=false;this.modelsList=[];this.selectedModel='';
  const url=await this.session.begin(DIRECT_CALLBACK,accountId);
  this.phase='waiting_for_login';
  try{
   const tab=await this.browser.tabs.create({url:'about:blank',active:true});
   if(tab.id===undefined)throw new LocalError('Não foi possível abrir a aba de login.');
   this.loginTab=tab.id;await this.browser.tabs.update(tab.id,{url});
  }catch(error){this.session.pending=null;this.phase='failed';this.error=safeError(error);throw new LocalError(this.error);}
 }
 async receive(details:{tabId:number;frameId:number;url:string}){
  const pending=this.session.pending;
  if(!pending||this.processing||details.tabId!==this.loginTab||details.frameId!==0||pending.expiresAt<=Date.now())return false;
  let url:URL;try{url=new URL(details.url);}catch{return false;}
  const expected=new URL(DIRECT_CALLBACK);
  if(url.origin!==expected.origin||url.pathname!==expected.pathname||url.username||url.password||url.hash||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==pending.state)return false;
  if(['code','client_id','error'].some(key=>url.searchParams.getAll(key).length>1))return false;
  this.processing=true;this.callbackObserved=true;this.phase='validating_identity';const generation=this.session.generation;
  const tabId=this.loginTab;
  try{
   // Close only this attempt's login tab. The panel retains the in-memory session.
   try{await this.browser.tabs.remove(tabId);}catch{/* The callback was already captured. */}
   await this.session.callback(url.searchParams);
   if(generation===this.session.generation){this.phase='connected';this.error='';if(this.session instanceof PersistentAiSession){const p=this.session.preference();this.syncedSessionId=p.sessionId;this.selectedModel=p.model;this.modelsList=p.models;}}
  }catch(error){if(generation===this.session.generation){this.phase='failed';this.error=safeError(error);}}
  finally{this.processing=false;if(this.loginTab===tabId)this.loginTab=undefined;}
  return true;
 }
 async cancelLogin(){
  this.session.generation++;this.session.pending=null;
  const tabId=this.loginTab;this.loginTab=undefined;
  if(tabId!==undefined)try{await this.browser.tabs.remove(tabId);}catch{/* The owned login tab may already be closed. */}
  if(this.phase==='waiting_for_login'||this.phase==='validating_identity')this.phase='idle';
 }
 async models(){
  await this.admin();if(this.session.pending||this.processing)throw new LocalError('Conclua o login antes de carregar modelos.');
  try{this.modelsList=await this.session.models();if(this.session instanceof PersistentAiSession)this.selectedModel=this.session.preference().model;this.error='';return this.modelsList;}catch(error){this.modelsList=[];throw new LocalError(safeError(error));}
 }
 async analyze(body:any){
  await this.admin();
  if(this.phase==='analyzing'||this.session.pending||this.processing)throw new LocalError('Já existe uma operação em andamento.');
  this.phase='analyzing';this.error='';this.result=null;const operation=++this.operation;this.controller=new AbortController();
  try{
   const result=await analyze(this.session,body,AbortSignal.any([this.controller.signal,AbortSignal.timeout(120000)]));
   await this.sync();
   if(operation===this.operation){this.result=result;this.phase='completed';return result;}throw new LocalError('Análise cancelada.');
  }catch(error){if(operation===this.operation){this.phase='failed';this.error=safeError(error);throw new LocalError(this.error);}throw new LocalError('Análise cancelada.');}
 }
 cancelAnalysis(){this.operation++;this.controller?.abort();this.controller=undefined;if(this.phase==='analyzing'){this.phase=this.session.active?'connected':'idle';this.error='Análise cancelada.';}}
 async logout(){
  this.cancelAnalysis();await this.cancelLogin();this.modelsList=[];this.selectedModel='';this.syncedSessionId='';this.result=null;this.error='';this.phase='idle';(this.session as any).usage=undefined;return this.session.signout();
 }
 dispose(){
  this.cancelAnalysis();void this.cancelLogin();this.session.active=null;
  this.browser.webRequest.onBeforeRequest.removeListener(this.onRequest);this.browser.tabs.onRemoved.removeListener(this.onTabRemoved);
 }
}
