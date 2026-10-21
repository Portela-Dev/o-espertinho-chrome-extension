import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

test('Chrome valida o destino e envia texto somente após prévia e confirmação únicas',{skip:process.env.TEST_NATIVE_BROWSER!=='1',timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'espertinho-wa-')),ext=join(dir,'extension');let context;
 try{
  await cp(new URL('../dist/',import.meta.url),ext,{recursive:true});
  const manifest=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));manifest.host_permissions.push('https://web.whatsapp.com/*');await writeFile(join(ext,'manifest.json'),JSON.stringify(manifest));
  // Isolated fixture: only group identification runs, without catalogue login/network.
  await writeFile(join(ext,'background.js'),`import {WhatsAppGroups} from './whatsapp-groups.js';const groups=new WhatsAppGroups(async()=>{});chrome.runtime.onMessage.addListener((m,s,respond)=>{groups.handle(m.operation,m.payload).then(value=>respond({value})).catch(e=>respond({error:e.message}));return true;});`);
  const html=(await readFile(join(ext,'popup.html'),'utf8')).replace('src="popup.js"','src="wa-test.js"');await writeFile(join(ext,'wa-test.html'),html);
  await writeFile(join(ext,'wa-test.js'),`import {setupWhatsAppPanel} from './whatsapp-panel.js';setupWhatsAppPanel((text)=>{document.querySelector('#success').hidden=false;document.querySelector('#success').textContent=text;});`);
  context=await chromium.launchPersistentContext(join(dir,'profile'),{headless:true,channel:'chromium',args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  let sent=0;await context.route('https://web.whatsapp.com/**',route=>{if(route.request().method()!=='GET')sent++;return route.fulfill({contentType:'text/html',body:`<!doctype html><title>WhatsApp — fixture</title><h1>Grupo de teste</h1><script>window.identity={account:'5511999999999@c.us',id:'120363000000001@g.us',name:'Mesmo nome',group:true};window.sent=[];const messages=[],listeners=new Set();const chat={active:true,get id(){return {_serialized:identity.id,server:identity.group?'g.us':'c.us'}},get isGroup(){return identity.group},get name(){return identity.name},msgs:{getModelsArray:()=>messages,on:(_event,fn)=>listeners.add(fn),off:(_event,fn)=>listeners.delete(fn)}};window.require=name=>name==='WAWebCollections'?{Chat:{getModelsArray:()=>[chat]}}:name==='WAWebSendTextMsgChatAction'?{sendTextMsgToChat:(target,text)=>{const id=target.id._serialized;window.sent.push({id,text});const msg={id:{_serialized:crypto.randomUUID(),fromMe:true,remote:{_serialized:id}},body:text,type:'chat'};messages.push(msg);for(const listener of listeners)listener(msg);return Promise.resolve();}}:{getMaybeMePnUser:()=>({_serialized:identity.account})};</script>`});});
  const wa=await context.newPage();await wa.goto('https://web.whatsapp.com/');const panel=await context.newPage();await panel.goto(new URL('wa-test.html',worker.url()).href);await panel.locator('#wa-title').click();
  await wa.bringToFront();await panel.locator('#wa-identify').click();await panel.locator('#wa-candidate:not([hidden])').waitFor();assert.equal(await panel.locator('#wa-candidate-name').textContent(),'Mesmo nome');
  await panel.locator('#wa-confirm').click();await panel.locator('#wa-bindings option[value]:not([value=""])').waitFor({state:'attached'});assert.equal(await panel.locator('#wa-bindings option').count(),2);
  await wa.evaluate(()=>window.identity.id='120363000000002@g.us');await panel.locator('#wa-validate').click();await panel.waitForFunction(()=>document.querySelector('#success').textContent.includes('outro grupo'));
  await wa.evaluate(()=>{window.identity.id='120363000000001@g.us';window.identity.name='Grupo renomeado';});await panel.locator('#wa-validate').click();await panel.waitForFunction(()=>document.querySelector('#wa-validation').textContent.includes('nome alterado'));
  await wa.evaluate(()=>window.identity.account='5511888888888@c.us');await panel.locator('#wa-validate').click();await panel.waitForFunction(()=>document.querySelector('#success').textContent.includes('conta vinculada'));
  await wa.evaluate(()=>{window.identity.account='5511999999999@c.us';window.identity.id='5511777777777@c.us';window.identity.group=false;});await panel.locator('#wa-identify').click();await panel.waitForFunction(()=>document.querySelector('#success').textContent.includes('não é um grupo'));
  await wa.reload();await panel.locator('#wa-identify').click();await panel.locator('#wa-candidate:not([hidden])').waitFor();await wa.reload();await panel.locator('#wa-confirm').click();await panel.waitForFunction(()=>document.querySelector('#success').textContent.includes('mudou'));
  assert.equal(await panel.locator('#wa-bindings option').count(),2);assert.equal(sent,0);
  await panel.locator('#wa-text').fill('Mensagem única de teste');await panel.locator('#wa-text-preview-button').click();await panel.locator('#wa-text-preview:not([hidden])').waitFor();assert.equal(await wa.evaluate(()=>window.sent.length),0);assert.equal(await panel.locator('#wa-preview-text').textContent(),'Mensagem única de teste');
  await wa.evaluate(()=>window.identity.id='120363000000002@g.us');await panel.locator('#wa-send-confirm').click();await panel.waitForFunction(()=>document.querySelector('#success').textContent.includes('não corresponde'));assert.equal(await wa.evaluate(()=>window.sent.length),0);
  await wa.evaluate(()=>window.identity.id='120363000000001@g.us');await panel.locator('#wa-text-preview-button').click();await panel.locator('#wa-text-preview:not([hidden])').waitFor();await panel.locator('#wa-send-confirm').click();await panel.waitForFunction(()=>document.querySelector('#wa-send-status').textContent.includes('registrada na conversa'));assert.deepEqual(await wa.evaluate(()=>window.sent),[{id:'120363000000001@g.us',text:'Mensagem única de teste'}]);
  assert.equal(await panel.locator('#wa-send-confirm').isDisabled(),true);await new Promise(r=>setTimeout(r,300));assert.equal(await wa.evaluate(()=>window.sent.length),1);assert.equal(sent,0);
  await panel.screenshot({path:'reports/whatsapp-groups-poc.png',fullPage:true});
 }finally{await context?.close();await rm(dir,{recursive:true,force:true});}
});
