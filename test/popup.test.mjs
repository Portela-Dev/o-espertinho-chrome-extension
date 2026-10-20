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
 state.run={step:'enrich',marketplace_id:'fixture',status:'waiting_for_human',reason:'challenge',total:5,completed:2,failed:1};renderCatalog(state,false);assert.equal(el('step-prices').disabled,true);assert.equal(el('resume').disabled,false);assert.equal(el('progress').value,3);
 state.user=undefined;renderCatalog(state,false);assert.equal(el('workspace').hidden,true);
});
test('tipo da execução e pendências por marketplace são exibidos sem confundir contagem com limite',()=>{
 const state={...view(),marketplaceId:'fixture',retryFailed:true,stats:{marketplaceId:'fixture',retryFailed:true,convert:{pending:7,total:100},enrich:{pending:3,total:100},prices:{pending:2,total:40}},run:{step:'prices',marketplace_id:'fixture',status:'running',total:5,completed:1,failed:0}};
 renderCatalog(state,false);assert.match(el('run-status').textContent,/4 — Atualizar preços · Loja · Em execução/);assert.match(el('step-convert').textContent,/7 \/ 100/);assert.match(el('step-enrich').textContent,/3 \/ 100/);assert.match(el('step-prices').textContent,/2 \/ 40/);assert.equal(el('retry-failed').checked,true);
 state.stats.marketplaceId='other';renderCatalog(state,false);assert.match(el('step-convert').textContent,/— \/ —/);assert.equal(el('display-mode').tagName,'BUTTON');assert.equal(document.querySelector('[role="switch"]'),null);
});

test('ações dos quatro passos, permissão, seletor e ícone usam mensagens internas',async()=>{
 let state=view(),closed=0,opened=0,allowed=true,offline=false;const messages=[];let poll;
 globalThis.chrome={runtime:{sendMessage:async message=>{messages.push(message);return offline?{error:'Backend indisponível.'}:{value:state};}},permissions:{request:async()=>allowed},tabs:{query:async()=>[{id:12,url:'https://shop.example.com'}]},scripting:{executeScript:async()=>{}},windows:{getCurrent:async()=>({id:42})},sidePanel:{setOptions:async()=>{},open:async()=>{opened++;}}};
 page.close=()=>{closed++;};const interval=globalThis.setInterval;globalThis.setInterval=fn=>{poll=fn;return 1;};const tick=()=>new Promise(r=>setImmediate(r));
 try{await import('../dist/popup.js');
  for(const id of ['login','logout','refresh','focus']){el(id).click();await tick();}
  el('refresh').click();await tick();assert.equal(el('notification').dataset.kind,'success');assert.equal(el('success').textContent,'Configurações atualizadas.');
  state.error='<img src=x> Falha de processamento';poll();await tick();assert.equal(el('notification').dataset.kind,'error');assert.equal(el('error').textContent,state.error);assert.equal(el('error').querySelector('img'),null);assert.equal(el('notification').closest('main'),null);
  el('dismiss-notification').click();poll();await tick();assert.equal(el('notification').hidden,true);
  state.error=undefined;state.statsError='Contadores indisponíveis.';poll();await tick();assert.equal(el('error').textContent,state.statsError);assert.doesNotMatch(el('queue-counts').textContent,/indisponíveis/);state.statsError=undefined;
  offline=true;poll();await tick();assert.equal(el('error').textContent,'Backend indisponível.');el('dismiss-notification').click();poll();await tick();assert.equal(el('notification').hidden,true);offline=false;poll();await tick();
  for(const step of ['discover','convert','enrich','prices']){el('step-'+step).click();await tick();assert.ok(messages.some(m=>m.type==='START'&&m.step===step),JSON.stringify({step,messages,error:el('error').textContent,market:el('marketplace').value,limit:el('limit').value}));}
  assert.ok(messages.some(m=>m.type==='START'&&m.hostWindowId===42));
  el('retry-failed').checked=true;el('retry-failed').dispatchEvent(new page.Event('change'));await tick();assert.ok(messages.some(m=>m.type==='FILTER'&&m.retryFailed));
  allowed=false;el('step-discover').click();await tick();assert.equal(el('error').hidden,false);allowed=true;
  el('pick-elements').click();await tick();assert.equal(closed,1);
  el('display-mode').click();await tick();assert.equal(opened,1);assert.equal(closed,2);assert.ok(messages.some(m=>m.type==='DISPLAY_MODE'&&m.mode==='panel'));
  poll();await tick();
 }finally{el('dismiss-notification').click();globalThis.setInterval=interval;}
});
