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

test('execução pausada mostra o status HTTP da conversão sem confundir 403 com login',()=>{const state={...view(),message:'Conversão recusada: HTTP 403. Intervenção necessária: access_denied.',run:{step:'convert',marketplace_id:'fixture',status:'waiting_for_human',reason:'access_denied',total:1,completed:0,failed:0}};renderCatalog(state,false);assert.match(el('run-status').textContent,/HTTP 403/);assert.match(el('run-status').textContent,/access_denied/);});
test('interface mostra permissões, progresso e texto externo sem HTML',()=>{
 const state=view();renderCatalog(state,false);assert.equal(el('account').querySelector('img'),null);assert.equal(el('workspace').hidden,false);assert.equal(el('step-discover').disabled,false);
 state.run={step:'enrich',marketplace_id:'fixture',status:'waiting_for_human',reason:'challenge',total:5,completed:2,failed:1};renderCatalog(state,false);assert.equal(el('step-prices').disabled,true);assert.equal(el('resume').disabled,false);assert.equal(el('progress').value,3);
 state.user=undefined;renderCatalog(state,false);assert.equal(el('workspace').hidden,true);
});
test('tipo da execução e pendências por marketplace são exibidos sem confundir contagem com limite',()=>{
 const state={...view(),marketplaceId:'fixture',retryFailed:true,stats:{marketplaceId:'fixture',retryFailed:true,convert:{pending:7,completed:93,total:100},enrich:{pending:3,completed:80,total:100},prices:{pending:2,total:40}},run:{step:'prices',marketplace_id:'fixture',status:'running',total:5,completed:1,failed:0}};
 renderCatalog(state,false);assert.match(el('run-status').textContent,/6 — Analisar Preços · Loja · Em execução/);assert.match(el('step-convert').textContent,/Gerados: 93 \/ 100/);assert.match(el('step-enrich').textContent,/Extraídos: 80 \/ 100/);assert.match(el('step-prices').textContent,/2 \/ 40/);assert.equal(el('retry-failed').checked,true);
 state.stats.convert={pending:3,completed:0,total:3};state.stats.enrich={pending:0,completed:0,total:3};renderCatalog(state,false);
 assert.match(el('step-convert').textContent,/Gerados: 0 \/ 3/);assert.match(el('step-enrich').textContent,/Extraídos: 0 \/ 3/);assert.match(el('step-prices').textContent,/Pendentes \(24h\): 2 \/ 40/);
 delete state.stats.convert.completed;renderCatalog(state,false);assert.match(el('step-convert').textContent,/Gerados: — \/ —/);
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
  state.error=undefined;state.statsError='Contadores indisponíveis.';poll();await tick();assert.equal(el('error').textContent,state.statsError);assert.equal(el('queue-counts'),null);state.statsError=undefined;
  offline=true;poll();await tick();assert.equal(el('error').textContent,'Backend indisponível.');el('dismiss-notification').click();poll();await tick();assert.equal(el('notification').hidden,true);offline=false;poll();await tick();
  for(const step of ['discover','convert','enrich','prices']){el('step-'+step).click();await tick();assert.ok(messages.some(m=>m.type==='START'&&m.step===step),JSON.stringify({step,messages,error:el('error').textContent,market:el('marketplace').value,limit:el('limit').value}));}
  assert.ok(messages.some(m=>m.type==='START'&&m.hostWindowId===42));
  el('retry-failed').checked=true;el('retry-failed').dispatchEvent(new page.Event('change'));await tick();assert.ok(messages.some(m=>m.type==='FILTER'&&m.retryFailed));
  allowed=false;el('step-discover').click();await tick();assert.equal(el('error').hidden,false);allowed=true;
  el('pick-elements').click();await tick();assert.equal(closed,1);
  el('display-mode').click();await tick();assert.equal(opened,1);assert.equal(closed,2);assert.ok(messages.some(m=>m.type==='DISPLAY_MODE'&&m.mode==='panel'));
  state.environments=[{id:'local',label:'Local',url:'http://localhost:3000'},{id:'production',label:'Produção',url:'https://production.test'}];state.environmentId='local';
  poll();await tick();
  el('runs').append(document.createElement('li'));
  const originalSend=globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage=async message=>{
   if(message.type==='ENVIRONMENT')state={...state,backendUrl:'https://production.test',environmentId:'production',user:undefined,markets:[]};
   return originalSend(message);
  };
  el('environment').value='production';el('environment').dispatchEvent(new page.Event('change'));await tick();await tick();
  assert.ok(messages.some(message=>message.type==='ENVIRONMENT'&&message.environmentId==='production'&&message.environmentUrl==='http://localhost:3000'));
  assert.equal(el('environment').value,'production');assert.equal(el('runs').children.length,0);assert.equal(el('workspace').hidden,true);
 }finally{el('dismiss-notification').click();globalThis.setInterval=interval;}
});

test('uma única barra exibe todos os links processados, incluindo pendências da IA',()=>{
 const state=view();const ai={task:'product',status:'completed',total:51,completed:47,pending:4,failed:0,title:'Produto que não deve aparecer'};renderCatalog(state,false,ai);
 assert.equal(document.querySelectorAll('progress').length,1);assert.equal(el('progress').value,51);assert.equal(el('progress').max,51);assert.match(el('counts').textContent,/51 \/ 51 links processados · 47 catalogados · 4 pendências/);assert.equal(el('cancel').disabled,true);assert.equal(el('pause').hidden,true);
 ai.status='running';renderCatalog(state,true,ai);assert.doesNotMatch(el('run-status').textContent,/Produto que não deve aparecer/);assert.equal(el('cancel').disabled,false);assert.equal(el('step-enrich').disabled,true);
 renderCatalog(state,false);assert.equal(el('pause').hidden,false);
});
