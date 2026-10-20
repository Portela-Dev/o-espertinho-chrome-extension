import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {renderCatalog} from '../dist/catalog-view.js';
const page=new Window({url:'chrome-extension://test/popup.html'});
globalThis.window=page;globalThis.document=page.document;
document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
const el=id=>document.getElementById(id);
const view=()=>({backendUrl:'http://localhost:3000',user:{email:'<img src=x onerror=alert(1)>',permissions:['affiliate_links','discovery','catalog','updates']},pairing:false,markets:[{id:'fixture',name:'Loja',catalog_executor:'extension',allowedOrigins:['https://shop.example.com']}],message:'Pronto',version:'0.2.0'});
test('interface mostra permissões, progresso e texto externo sem HTML',()=>{
 const state=view();renderCatalog(state,false);assert.equal(el('account').querySelector('img'),null);assert.equal(el('workspace').hidden,false);assert.equal(el('step-discover').disabled,false);
 state.run={status:'waiting_for_human',reason:'challenge',total:5,completed:2,failed:1};renderCatalog(state,false);assert.equal(el('step-prices').disabled,true);assert.equal(el('resume').disabled,false);assert.equal(el('progress').value,3);
 state.user=undefined;renderCatalog(state,false);assert.equal(el('workspace').hidden,true);
});
test('ações dos quatro passos, permissão, seletor e switch usam mensagens internas',async()=>{
 let state=view(),closed=0,opened=0,allowed=true;const messages=[];let poll;
 globalThis.chrome={runtime:{sendMessage:async message=>{messages.push(message);return {value:state};}},permissions:{request:async()=>allowed},tabs:{query:async()=>[{id:12,url:'https://shop.example.com'}]},scripting:{executeScript:async()=>{}},windows:{getCurrent:async()=>({id:42})},sidePanel:{setOptions:async()=>{},open:async()=>{opened++;}}};
 page.close=()=>{closed++;};const interval=globalThis.setInterval;globalThis.setInterval=fn=>{poll=fn;return 1;};const tick=()=>new Promise(r=>setImmediate(r));
 try{await import('../dist/popup.js');
  for(const id of ['login','logout','refresh','focus']){el(id).click();await tick();}
  for(const step of ['discover','convert','enrich','prices']){el('step-'+step).click();await tick();assert.ok(messages.some(m=>m.type==='START'&&m.step===step),JSON.stringify({step,messages,error:el('error').textContent,market:el('marketplace').value,limit:el('limit').value}));}
  allowed=false;el('step-discover').click();await tick();assert.equal(el('error').hidden,false);allowed=true;
  el('pick-elements').click();await tick();assert.equal(closed,1);
  el('display-mode').checked=true;el('display-mode').dispatchEvent(new page.Event('change'));await tick();assert.equal(opened,1);assert.equal(closed,2);assert.ok(messages.some(m=>m.type==='DISPLAY_MODE'&&m.mode==='panel'));
  poll();await tick();
 }finally{globalThis.setInterval=interval;}
});
