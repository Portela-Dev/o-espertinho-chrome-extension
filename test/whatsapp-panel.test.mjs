import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {setupWhatsAppPanel} from '../dist/whatsapp-panel.js';

test('painel confirma explicitamente, exibe nomes como texto e não mantém validação depois de erro',async()=>{
 const win=new Window({url:'chrome-extension://test/popup.html'}),old={window:globalThis.window,document:globalThis.document,Option:globalThis.Option};Object.assign(globalThis,{window:win,document:win.document,Option:win.Option});document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
 const notices=[],calls=[],rows=[],group={id:'binding',groupId:'120363000000001@g.us',name:'<img src=x>',accountFingerprint:'abc'},el=id=>document.getElementById(id);let allowed=true,valid=true,url='https://web.whatsapp.com/';
 const browser={runtime:{sendMessage:async m=>{calls.push(m);if(m.operation==='list')return {value:rows};if(m.operation==='inspect')return {value:{...group,ticket:'ticket'}};if(m.operation==='confirm'){rows.push(group);return {value:group};}if(m.operation==='validate')return valid?{value:{valid:true,name:'Nome alterado',renamed:true,checkedAt:new Date().toISOString()}}:{error:'Outro grupo'};if(m.operation==='remove'){rows.length=0;return {value:{removed:true}};}throw Error('Unexpected');}},permissions:{request:async()=>allowed},tabs:{query:async()=>[{id:7,url}],update:async()=>{},create:async()=>{}}};
 const tick=()=>new Promise(r=>setImmediate(r)),click=async id=>{el(id).click();for(let i=0;i<4;i++)await tick();};
 try{
  setupWhatsAppPanel((...args)=>notices.push(args),browser);await click('wa-open');await click('wa-identify');assert.equal(el('wa-candidate-name').querySelector('img'),null);assert.equal(el('wa-candidate').hidden,false);assert.equal(rows.length,0);
  await click('wa-confirm');assert.equal(rows.length,1);assert.equal(el('wa-candidate').hidden,true);assert.equal(el('wa-bindings').value,group.id);
  await click('wa-validate');assert.match(el('wa-validation').textContent,/nome alterado/);
  valid=false;await click('wa-validate');assert.equal(el('wa-validation').textContent,'Verificação pendente.');assert.equal(notices.at(-1)[0],'Outro grupo');
  await click('wa-load');await click('wa-remove');assert.equal(rows.length,0);
  allowed=false;await click('wa-identify');assert.match(notices.at(-1)[0],/não autorizado/);allowed=true;url='https://evil.test';await click('wa-identify');assert.match(notices.at(-1)[0],/aba atual/);
  assert.equal(calls.some(c=>c.operation==='send'),false);
 }finally{win.close();Object.assign(globalThis,old);}
});
