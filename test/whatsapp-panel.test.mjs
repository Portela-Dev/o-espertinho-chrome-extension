import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {setupWhatsAppPanel} from '../dist/whatsapp-panel.js';

test('painel confirma explicitamente, exibe nomes como texto e não mantém validação depois de erro',async()=>{
 const win=new Window({url:'chrome-extension://test/popup.html'}),old={window:globalThis.window,document:globalThis.document,Option:globalThis.Option};Object.assign(globalThis,{window:win,document:win.document,Option:win.Option});document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
 const notices=[],calls=[],rows=[],group={id:'binding',groupId:'120363000000001@g.us',name:'<img src=x>',accountFingerprint:'abc'},el=id=>document.getElementById(id);let allowed=true,valid=true,url='https://web.whatsapp.com/';
 const browser={runtime:{sendMessage:async m=>{calls.push(m);if(m.operation==='text_status')return {value:null};if(m.operation==='list')return {value:rows};if(m.operation==='inspect')return {value:{...group,ticket:'ticket'}};if(m.operation==='confirm'){rows.push(group);return {value:group};}if(m.operation==='open_group')return {value:group};if(m.operation==='validate')return valid?{value:{valid:true,name:'Nome alterado',renamed:true,checkedAt:new Date().toISOString()}}:{error:'Outro grupo'};if(m.operation==='remove'){rows.length=0;return {value:{removed:true}};}throw Error('Unexpected');}},permissions:{request:async()=>allowed},tabs:{query:async()=>[{id:7,url}],update:async()=>{},create:async()=>{}}};
 const tick=()=>new Promise(r=>setImmediate(r)),click=async id=>{el(id).click();for(let i=0;i<4;i++)await tick();};
 try{
  setupWhatsAppPanel((...args)=>notices.push(args),browser);await click('wa-open');await click('wa-identify');assert.equal(el('wa-candidate-name').querySelector('img'),null);assert.equal(el('wa-candidate').hidden,false);assert.equal(rows.length,0);
  await click('wa-confirm');assert.equal(rows.length,1);assert.equal(el('wa-candidate').hidden,true);assert.equal(el('wa-bindings').value,group.id);
  await click('wa-select');assert.match(el('wa-validation').textContent,/Grupo aberto e conferido/);assert.equal(calls.find(c=>c.operation==='open_group').payload.id,group.id);
  await click('wa-validate');assert.match(el('wa-validation').textContent,/nome alterado/);
  valid=false;await click('wa-validate');assert.equal(el('wa-validation').textContent,'Verificação pendente.');assert.equal(notices.at(-1)[0],'Outro grupo');
  await click('wa-load');await click('wa-remove');assert.equal(rows.length,0);
  allowed=false;await click('wa-identify');assert.match(notices.at(-1)[0],/não autorizado/);allowed=true;url='https://evil.test';await click('wa-identify');assert.match(notices.at(-1)[0],/aba atual/);
  assert.equal(calls.some(c=>c.operation==='send'),false);
 }finally{win.close();Object.assign(globalThis,old);}
});

test('mensagem exige prévia, edição/cancelamento invalida confirmação e resposta perdida não causa repetição',async()=>{
 const win=new Window({url:'chrome-extension://test/popup.html'}),old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:win,document:win.document});document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
 const calls=[],notices=[];let lost=false;let waTabs=[{id:7,url:'https://web.whatsapp.com/'}];
 const el=id=>document.getElementById(id),browser={runtime:{sendMessage:async m=>{calls.push(m);if(m.operation==='preview_text')return {value:{ticket:'one-use',text:m.payload.text,name:'Grupo de teste',groupId:'120363000000001@g.us',accountFingerprint:'abc'}};if(m.operation==='cancel_text')return {value:{cancelled:true}};if(m.operation==='send_text'){if(lost)throw Error('Resposta perdida');return {value:{status:'observed'}};}throw Error('Unexpected');}},permissions:{request:async()=>true},tabs:{query:async options=>options.active?[{id:88,url:'https://other.test/'}]:waTabs,update:async()=>{throw Error('Não pode mudar foco');},create:async()=>{throw Error('Não pode abrir outra aba');}}};
 const click=async id=>{el(id).click();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 try{
  setupWhatsAppPanel(text=>notices.push(text),browser);const option=document.createElement('option');option.value='binding';option.textContent='Grupo';el('wa-bindings').add(option);el('wa-bindings').value='binding';el('wa-text').value='<img src=x> Texto de teste';
  await click('wa-text-preview-button');assert.equal(calls.some(c=>c.operation==='send_text'),false);assert.equal(el('wa-preview-text').querySelector('img'),null);
  el('wa-text').value='Texto editado';el('wa-text').dispatchEvent(new win.Event('input'));assert.equal(el('wa-send-confirm').disabled,true);
  await click('wa-text-preview-button');await click('wa-send-cancel');assert.equal(el('wa-send-confirm').disabled,true);
  await click('wa-text-preview-button');el('wa-send-confirm').click();el('wa-send-confirm').click();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c.operation==='send_text').length,1);assert.equal(calls.find(c=>c.operation==='preview_text').payload.tabId,7);assert.match(el('wa-send-status').textContent,/registrada na conversa/);assert.equal(el('wa-text').readOnly,false);assert.equal(el('wa-bindings').disabled,false);assert.equal(el('wa-send-confirm').disabled,true);
  lost=true;await click('wa-text-preview-button');await click('wa-send-confirm');assert.match(el('wa-send-status').textContent,/Resultado desconhecido/);assert.equal(calls.filter(c=>c.operation==='send_text').length,2);assert.equal(notices.at(-1),'Resposta perdida');
  const count=calls.filter(c=>c.operation==='preview_text').length;waTabs.push({id:8,url:'https://web.whatsapp.com/'});await click('wa-text-preview-button');assert.match(notices.at(-1),/mais de uma aba/);assert.equal(calls.filter(c=>c.operation==='preview_text').length,count);
  waTabs=[];await click('wa-text-preview-button');assert.match(notices.at(-1),/aberta nesta janela/);assert.equal(calls.filter(c=>c.operation==='send_text').length,2);
 }finally{win.close();Object.assign(globalThis,old);}
});
