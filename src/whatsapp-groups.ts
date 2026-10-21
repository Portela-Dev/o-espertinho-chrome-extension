import {WhatsAppTextPoc} from './whatsapp-text.js';
/** Read-only adapter for WhatsApp Web's private modules. Never reads messages or credentials. */
export function readWhatsAppIdentity() {
 try {
 const w=window as any;
 if(location.origin!=='https://web.whatsapp.com')throw new Error('Abra o WhatsApp Web.');
 if(typeof w.require!=='function')throw new Error('WhatsApp Web ainda não está pronto ou sua estrutura mudou.');
 const collections=w.require('WAWebCollections'),me=w.require('WAWebUserPrefsMeUser');
 const account=me.getMaybeMePnUser?.()??me.getMaybeMeLidUser?.();
 const accountId=account?._serialized;
 if(typeof accountId!=='string'||!/^\d{5,30}@(c\.us|s\.whatsapp\.net|lid)$/.test(accountId))throw new Error('Confirme o login no WhatsApp Web.');
 const chats=collections?.Chat?.getModelsArray?.();
 if(!Array.isArray(chats))throw new Error('Não foi possível identificar a conversa com segurança.');
 const active=chats.filter((chat:any)=>chat.active===true);
 if(active.length!==1)throw new Error('Abra um único grupo no WhatsApp Web.');
 const chat=active[0],groupId=chat.id?._serialized;
 if(typeof groupId!=='string'||!/^\d{5,30}(?:-\d{1,20})?@g\.us$/.test(groupId)||chat.id?.server!=='g.us'||!(chat.isGroup===true||chat.id?.isGroup?.()===true))throw new Error('A conversa aberta não é um grupo confirmado. Nenhum vínculo foi autorizado.');
 const name=chat.name??chat.formattedTitle;
 if(typeof name!=='string'||!name.trim()||name.length>300)throw new Error('O grupo não possui um nome legível para confirmação.');
 return {accountId:accountId.replace('@s.whatsapp.net','@c.us'),groupId,name:name.trim()};
 } catch(error) { return {error:error instanceof Error?error.message.slice(0,300):'Identificação indisponível.'}; }
}

export interface WhatsAppGroupBinding {id:string;groupId:string;name:string;accountHash:string;createdAt:string}
const origin='https://web.whatsapp.com',key='whatsappGroupBindings';
export class WhatsAppGroups {
 private pending=new Map<string,{tabId:number;documentId:string;identity:Awaited<ReturnType<WhatsAppGroups['read']>>;expiresAt:number}>();
 private text?:WhatsAppTextPoc;
 private serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly authorize:()=>Promise<void>,private readonly browser:typeof chrome=chrome){}
 handle(operation:string,payload:any={}){
  const task=this.serial.catch(()=>{}).then(()=>this.execute(operation,payload));this.serial=task;return task;
 }
 private async bindings():Promise<WhatsAppGroupBinding[]>{
  await this.browser.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const rows=(await this.browser.storage.local.get(key))[key];
  if(!Array.isArray(rows))return [];
  return rows.filter(r=>r&&typeof r.id==='string'&&typeof r.groupId==='string'&&/^\d{5,30}(?:-\d{1,20})?@g\.us$/.test(r.groupId)&&typeof r.name==='string'&&r.name.length<=300&&/^[a-f0-9]{64}$/.test(r.accountHash));
 }
 private async read(tabId:number){
  if(!Number.isInteger(tabId)||tabId<0)throw new Error('Abra o grupo na aba atual.');
  if(!await this.browser.permissions.contains({origins:[origin+'/*']}))throw new Error('Autorize o acesso ao WhatsApp Web.');
  const check=async()=>{const tab=await this.browser.tabs.get(tabId);if(!tab.url||new URL(tab.url).origin!==origin)throw new Error('A aba atual não é o WhatsApp Web.');};
  await check();
  const result=await this.browser.scripting.executeScript({target:{tabId},world:'MAIN',func:readWhatsAppIdentity});
  await check();
  const frame=result.find(r=>r.frameId===0),data=frame?.result;
  if(data?.error)throw new Error(data.error);
  if(!frame?.documentId||!data||typeof data.accountId!=='string'||!/^\d{5,30}@(c\.us|lid)$/.test(data.accountId)||typeof data.groupId!=='string'||!/^\d{5,30}(?:-\d{1,20})?@g\.us$/.test(data.groupId)||typeof data.name!=='string'||!data.name.trim()||data.name.length>300)throw new Error('Identificação indisponível. Confira a sessão e reabra o grupo.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.accountId));
  return {groupId:data.groupId,name:data.name,accountHash:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),documentId:frame.documentId};
 }
 private same(a:Awaited<ReturnType<WhatsAppGroups['read']>>,b:Awaited<ReturnType<WhatsAppGroups['read']>>){return a.groupId===b.groupId&&a.accountHash===b.accountHash&&a.documentId===b.documentId;}
 private async stable(tabId:number){const first=await this.read(tabId),second=await this.read(tabId);if(!this.same(first,second))throw new Error('A conta, conversa ou página mudou durante a verificação. Tente novamente.');return second;}
 private async textDestination(id:string,tabId:number){
  const binding=(await this.bindings()).find(r=>r.id===id);if(!binding)throw Error('Vínculo não encontrado.');
  const current=await this.stable(tabId);
  if(current.accountHash!==binding.accountHash||current.groupId!==binding.groupId)throw Error('A conta ou grupo aberto não corresponde ao vínculo. Nenhuma mensagem foi enviada.');
  return {...current,bindingId:binding.id};
 }
 private async execute(operation:string,payload:any){
  await this.authorize();
  if(['preview_text','send_text','cancel_text','text_status'].includes(operation)){
   this.text??=new WhatsAppTextPoc(this.browser,(id,tabId)=>this.textDestination(id,tabId));
   return this.text.handle(operation,payload);
  }
  for(const [id,pending] of this.pending)if(pending.expiresAt<Date.now())this.pending.delete(id);
  if(operation==='list')return this.bindings();
  if(operation==='inspect'){
   const identity=await this.stable(payload.tabId),ticket=crypto.randomUUID();this.pending.clear();
   this.pending.set(ticket,{identity,tabId:payload.tabId,documentId:identity.documentId,expiresAt:Date.now()+120000});
   return {ticket,groupId:identity.groupId,name:identity.name,accountFingerprint:identity.accountHash.slice(0,12)};
  }
  if(operation==='confirm'){
   const pending=this.pending.get(payload.ticket);this.pending.delete(payload.ticket);
   if(!pending)throw new Error('Confirmação expirada. Identifique o grupo novamente.');
   const current=await this.stable(pending.tabId);
   if(!this.same(current,pending.identity)||current.name!==pending.identity.name)throw new Error('O grupo ou a conta mudou. Identifique e confirme novamente.');
   const rows=await this.bindings();let binding=rows.find(r=>r.groupId===current.groupId&&r.accountHash===current.accountHash);
   if(!binding){if(rows.length>=50)throw new Error('Limite de 50 vínculos nesta POC.');binding={id:crypto.randomUUID(),groupId:current.groupId,name:current.name,accountHash:current.accountHash,createdAt:new Date().toISOString()};rows.push(binding);await this.browser.storage.local.set({[key]:rows});}
   return binding;
  }
  if(operation==='validate'){
   const binding=(await this.bindings()).find(r=>r.id===payload.id);
   if(!binding)throw new Error('Vínculo não encontrado.');
   const current=await this.stable(payload.tabId);
   if(current.accountHash!==binding.accountHash)throw new Error('A conta do WhatsApp é diferente da conta vinculada.');
   if(current.groupId!==binding.groupId)throw new Error('A conversa aberta é outro grupo. O nome não autoriza o destino.');
   return {valid:true,name:current.name,renamed:current.name!==binding.name,groupId:current.groupId,checkedAt:new Date().toISOString()};
  }
  if(operation==='remove'){
   const rows=await this.bindings();await this.browser.storage.local.set({[key]:rows.filter(r=>r.id!==payload.id)});this.pending.clear();return {removed:true};
  }
  throw new Error('Operação de grupo inválida. Use a prévia e confirmação para um envio manual.');
 }
}
