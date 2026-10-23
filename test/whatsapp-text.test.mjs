import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {WhatsAppTextPoc,sendWhatsAppText} from '../dist/whatsapp-text.js';

function fixture(){
 const saved={},calls=[];let changed=false,fail=false;
 const destination={bindingId:'binding',groupId:'120363000000001@g.us',name:'Grupo de teste',accountHash:'a'.repeat(64),documentId:'doc'};
 const browser={storage:{local:{setAccessLevel:async()=>{},get:async key=>({[key]:saved[key]}),set:async value=>{Object.assign(saved,structuredClone(value));}}},scripting:{executeScript:async call=>{calls.push(call);if(fail)throw Error('Lost response');return [{frameId:0,result:{status:'observed'}}];}}};
 const resolve=async()=>({...destination,documentId:changed?'different':destination.documentId});
 const poc=new WhatsAppTextPoc(browser,resolve);
 return {poc,browser,saved,calls,resolve,change:()=>changed=true,fail:()=>fail=true};
}

test('prévia não envia e confirmação usa somente o texto/destino imutáveis, uma vez, no documento validado',async()=>{
 const f=fixture(),preview=await f.poc.handle('preview_text',{id:'binding',tabId:7,text:'  Teste autorizado\r\nLinha 2  '});assert.equal(f.calls.length,0);assert.equal(preview.text,'Teste autorizado\nLinha 2');
 const result=await f.poc.handle('send_text',{ticket:preview.ticket,text:'Texto substituído',groupId:'evil'});assert.equal(result.status,'observed');assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].target,{tabId:7,documentIds:['doc']});assert.equal(f.calls[0].args[0].text,preview.text);assert.equal(f.calls[0].args[0].groupId,preview.groupId);assert.equal(f.calls[0].func,sendWhatsAppText);
 await assert.rejects(f.poc.handle('send_text',{ticket:preview.ticket}),/já utilizada/);assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(f.saved),/Teste autorizado/);
});

test('mudança de destino/documento, cancelamento, expiração e texto inválido não enviam',async()=>{
 const f=fixture();for(const text of ['', ' '.repeat(5),'a'.repeat(2001),'Oi\u0000'])await assert.rejects(f.poc.handle('preview_text',{id:'binding',tabId:7,text}),/caracteres/);
 let preview=await f.poc.handle('preview_text',{id:'binding',tabId:7,text:'Teste'});await f.poc.handle('cancel_text',{ticket:preview.ticket});await assert.rejects(f.poc.handle('send_text',{ticket:preview.ticket}),/expirada/);
 preview=await f.poc.handle('preview_text',{id:'binding',tabId:7,text:'Teste'});const now=Date.now;try{Date.now=()=>now()+120001;await assert.rejects(f.poc.handle('send_text',{ticket:preview.ticket}),/expirada/);}finally{Date.now=now;}
 preview=await f.poc.handle('preview_text',{id:'binding',tabId:7,text:'Teste'});f.change();await assert.rejects(f.poc.handle('send_text',{ticket:preview.ticket}),/mudou/);assert.equal(f.calls.length,0);
});

test('resposta perdida é desconhecida, não repete e reiniciar não restaura ticket; falha no registro impede disparo',async()=>{
 const f=fixture(),preview=await f.poc.handle('preview_text',{id:'binding',tabId:7,text:'Teste'});f.fail();assert.equal((await f.poc.handle('send_text',{ticket:preview.ticket})).status,'unknown');assert.equal(f.calls.length,1);
 const recreated=new WhatsAppTextPoc(f.browser,f.resolve);assert.equal((await recreated.handle('text_status',{})).status,'unknown');await assert.rejects(recreated.handle('send_text',{ticket:preview.ticket}),/expirada/);assert.equal(f.calls.length,1);
 const g=fixture(),draft=await g.poc.handle('preview_text',{id:'binding',tabId:7,text:'Teste'});g.browser.storage.local.set=async()=>{throw Error('Storage failed');};await assert.rejects(g.poc.handle('send_text',{ticket:draft.ticket}),/Storage failed/);assert.equal(g.calls.length,0);
});

test('confirmações simultâneas nunca executam duas vezes',async()=>{
 const f=fixture(),preview=await f.poc.handle('preview_text',{id:'binding',tabId:7,text:'Teste'});const result=await Promise.allSettled([f.poc.handle('send_text',{ticket:preview.ticket}),f.poc.handle('send_text',{ticket:preview.ticket})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.length,1);
});

async function pageFixture(callback){
 const win=new Window({url:'https://web.whatsapp.com/'}),old={window:globalThis.window,location:globalThis.location};globalThis.window=win;globalThis.location=win.location;
 const messages=[],listeners=new Set(),sent=[],chat={active:true,id:{_serialized:'120363000000001@g.us',server:'g.us'},isGroup:true,name:'Grupo de teste',msgs:{getModelsArray:()=>messages,on:(_event,fn)=>listeners.add(fn),off:(_event,fn)=>listeners.delete(fn)}};
 let send=(target,text)=>{sent.push({target,text});const msg={id:{_serialized:crypto.randomUUID(),fromMe:true,remote:{_serialized:target.id._serialized}},body:text,type:'chat'};messages.push(msg);for(const listener of listeners)listener(msg);return Promise.resolve();};
 win.require=name=>name==='WAWebCollections'?{Chat:{getModelsArray:()=>[chat]}}:name==='WAWebUserPrefsMeUser'?{getMaybeMePnUser:()=>({_serialized:'5511999999999@c.us'})}:{sendTextMsgToChat:(...args)=>send(...args)};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('5511999999999@c.us')),input={attemptId:crypto.randomUUID(),groupId:chat.id._serialized,name:chat.name,accountHash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),text:'Texto de teste'};
 try{await callback({win,chat,input,sent,listeners,setSend:value=>send=value});}finally{win.close();Object.assign(globalThis,old);}
}

test('adaptador envia ao modelo de grupo capturado, observa somente a mensagem própria e bloqueia replay',async()=>pageFixture(async f=>{
 assert.equal((await sendWhatsAppText(f.input,20)).status,'observed');assert.equal(f.sent.length,1);assert.equal(f.sent[0].target,f.chat);assert.equal(f.sent[0].text,f.input.text);assert.equal(f.listeners.size,0);
 assert.equal((await sendWhatsAppText(f.input,20)).status,'not_sent');assert.equal(f.sent.length,1);
}));

test('conta/grupo divergente é recusado antes do envio; falha ou timeout após invocação nunca repete',async()=>pageFixture(async f=>{
 assert.equal((await sendWhatsAppText({...f.input,accountHash:'b'.repeat(64)},10)).status,'not_sent');assert.equal(f.sent.length,0);
 f.chat.id._serialized='120363000000002@g.us';assert.equal((await sendWhatsAppText(f.input,10)).status,'not_sent');assert.equal(f.sent.length,0);f.chat.id._serialized=f.input.groupId;
 let calls=0;f.setSend(()=>{calls++;throw Error('Uncertain failure');});assert.equal((await sendWhatsAppText(f.input,10)).status,'unknown');assert.equal(calls,1);
 f.setSend(()=>{calls++;return new Promise(()=>{});});assert.equal((await sendWhatsAppText({...f.input,attemptId:crypto.randomUUID()},5)).status,'unknown');assert.equal(calls,2);assert.equal(f.listeners.size,0);
}));
