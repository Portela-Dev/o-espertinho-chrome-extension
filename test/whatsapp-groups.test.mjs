import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readWhatsAppIdentity,WhatsAppGroups} from '../dist/whatsapp-groups.js';

function fixture(){
 let rows=[],identity={accountId:'5511999999999@c.us',groupId:'120363000000001@g.us',name:'Ofertas'},documentId='doc',url='https://web.whatsapp.com/',allowed=true;
 const calls=[];
 const browser={permissions:{contains:async()=>allowed},tabs:{get:async()=>({id:7,url})},storage:{local:{setAccessLevel:async()=>{},get:async()=>({whatsappGroupBindings:structuredClone(rows)}),set:async value=>{rows=structuredClone(value.whatsappGroupBindings);}}},scripting:{executeScript:async options=>{assert.equal(options.world,'MAIN');assert.equal(options.func,readWhatsAppIdentity);calls.push(options.target.tabId);return [{frameId:0,documentId,result:structuredClone(identity)}];}}};
 const groups=new WhatsAppGroups(async()=>{},browser);
 return {groups,browser,calls,rows:()=>rows,identity,value:value=>{identity={...identity,...value};},document:value=>documentId=value,url:value=>url=value,permission:value=>allowed=value};
}

test('adapter identifica somente grupo ativo e conta; recusa contato, ambiguidades e interface incompatível',()=>{
 const win=new Window({url:'https://web.whatsapp.com/'}),old={window:globalThis.window,location:globalThis.location};globalThis.window=win;globalThis.location=win.location;
 let chats=[{active:true,id:{_serialized:'120363000000001@g.us',server:'g.us'},isGroup:true,name:'Mesmo nome'}],account={_serialized:'5511999999999@c.us'};
 win.require=name=>name==='WAWebCollections'?{Chat:{getModelsArray:()=>chats}}:{getMaybeMePnUser:()=>account};
 try{
  assert.deepEqual(readWhatsAppIdentity(),{accountId:account._serialized,groupId:chats[0].id._serialized,name:'Mesmo nome'});
  chats[0].id={_serialized:'5511888888888@c.us',server:'c.us'};assert.match(readWhatsAppIdentity().error,/não é um grupo/);
  chats=[];assert.match(readWhatsAppIdentity().error,/único grupo/);
  chats=[{active:true},{active:true}];assert.match(readWhatsAppIdentity().error,/único grupo/);
  account=null;assert.match(readWhatsAppIdentity().error,/login/);
  win.require=undefined;assert.match(readWhatsAppIdentity().error,/estrutura mudou/);
 }finally{win.close();Object.assign(globalThis,old);}
});

test('dois grupos homônimos não são intercambiáveis; renomear preserva identidade e trocar conta é recusado',async()=>{
 const f=fixture(),candidate=await f.groups.handle('inspect',{tabId:7});assert.equal(f.rows().length,0);
 assert.equal(candidate.accountId,undefined);const linked=await f.groups.handle('confirm',{ticket:candidate.ticket});assert.equal(f.rows().length,1);assert.doesNotMatch(JSON.stringify(f.rows()),/5511999999999/);
 assert.equal((await f.groups.handle('validate',{id:linked.id,tabId:7})).valid,true);
 f.value({groupId:'120363000000002@g.us'});await assert.rejects(f.groups.handle('validate',{id:linked.id,tabId:7}),/outro grupo/);
 f.value({groupId:linked.groupId,name:'Nome novo'});const renamed=await f.groups.handle('validate',{id:linked.id,tabId:7});assert.equal(renamed.renamed,true);assert.equal(renamed.name,'Nome novo');
 f.value({accountId:'5511888888888@c.us'});await assert.rejects(f.groups.handle('validate',{id:linked.id,tabId:7}),/conta.*diferente/);
 await f.groups.handle('remove',{id:linked.id});assert.deepEqual(await f.groups.handle('list'),[]);
});

test('confirmar exige mesmo documento, conta e grupo; tickets são únicos e expiram sem persistência',async()=>{
 const f=fixture();let candidate=await f.groups.handle('inspect',{tabId:7});f.value({groupId:'120363000000002@g.us'});
 await assert.rejects(f.groups.handle('confirm',{ticket:candidate.ticket}),/mudou/);assert.equal(f.rows().length,0);
 await assert.rejects(f.groups.handle('confirm',{ticket:candidate.ticket}),/expirada/);
 candidate=await f.groups.handle('inspect',{tabId:7});f.document('new-doc');await assert.rejects(f.groups.handle('confirm',{ticket:candidate.ticket}),/mudou/);
 candidate=await f.groups.handle('inspect',{tabId:7});const now=Date.now;try{Date.now=()=>now()+120001;await assert.rejects(f.groups.handle('confirm',{ticket:candidate.ticket}),/expirada/);}finally{Date.now=now;}
 const recreated=new WhatsAppGroups(async()=>{},f.browser);assert.deepEqual(await recreated.handle('list'),[]);
});

test('troca durante leitura, aba externa, falta de acesso e operações de envio falham sem efeitos colaterais',async()=>{
 const f=fixture();f.permission(false);await assert.rejects(f.groups.handle('inspect',{tabId:7}),/Autorize/);assert.equal(f.calls.length,0);
 f.permission(true);f.url('https://evil.test/');await assert.rejects(f.groups.handle('inspect',{tabId:7}),/não é o WhatsApp/);assert.equal(f.calls.length,0);
 f.url('https://web.whatsapp.com/');const execute=f.browser.scripting.executeScript;let n=0;f.browser.scripting.executeScript=async options=>{if(++n===2)f.value({groupId:'120363000000003@g.us'});return execute(options);};
 await assert.rejects(f.groups.handle('inspect',{tabId:7}),/mudou durante/);assert.equal(f.rows().length,0);
 await assert.rejects(f.groups.handle('send',{text:'Nunca enviar'}),/prévia/);assert.equal(f.rows().length,0);
 const denied=new WhatsAppGroups(async()=>{throw Error('Sem permissão');},f.browser);await assert.rejects(denied.handle('list'),/Sem permissão/);
});

test('vínculos persistem no Chrome sem duplicação e validação recusa vínculo desconhecido',async()=>{
 const f=fixture();for(let i=0;i<2;i++){const c=await f.groups.handle('inspect',{tabId:7});await f.groups.handle('confirm',{ticket:c.ticket});}
 assert.equal(f.rows().length,1);const recreated=new WhatsAppGroups(async()=>{},f.browser);assert.equal((await recreated.handle('list')).length,1);
 await assert.rejects(recreated.handle('validate',{id:'unknown',tabId:7}),/não encontrado/);
});
