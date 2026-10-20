import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {localAiRequest,readOfferMetadata,captureAiOffer} from '../dist/local-ai.js';
import {setupLocalAi} from '../dist/local-ai-view.js';

test('cliente mantém chave só em sessão confiável e chama exclusivamente loopback',async()=>{
 const saved={},calls=[];let permitted=true;const browser={permissions:{contains:async()=>permitted},storage:{session:{setAccessLevel:async value=>assert.equal(value.accessLevel,'TRUSTED_CONTEXTS'),get:async key=>({[key]:saved[key]}),set:async values=>Object.assign(saved,values),remove:async key=>delete saved[key]}}};
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/pair')?{key:'helper-only-capability'}:{connected:true});};
 try{
  await assert.rejects(()=>localAiRequest('/unknown',{},browser),/inválida/);await assert.rejects(()=>localAiRequest('/status',{},browser),/Vincule/);
  assert.deepEqual(await localAiRequest('/pair',{code:'fixture'},browser),{paired:true});await localAiRequest('/status',{},browser);
  assert.equal(calls[1].options.headers['X-Espertinho-Local'],'helper-only-capability');assert.ok(calls.every(c=>c.url.startsWith('http://127.0.0.1:18765/')));assert.equal(calls[1].options.credentials,'omit');
  globalThis.fetch=async()=>Response.json({error:'Repareie'},{status:401});await assert.rejects(()=>localAiRequest('/status',{},browser),/Repareie/);assert.equal(saved.localAiConnection,undefined);
  permitted=false;await assert.rejects(()=>localAiRequest('/pair',{},browser),/Autorize/);
 }finally{globalThis.fetch=previous;}
});
test('captura lê somente metadados públicos de produto e ignora JSON inválido',async()=>{
 const page=new Window();globalThis.document=page.document;
 document.write('<title>Fallback</title><script type="application/ld+json">broken</script><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Modelo X","description":"Descrição","brand":{"name":"Marca"},"category":"Áudio"}]}</script>');
 assert.deepEqual(readOfferMetadata(),{title:'Modelo X',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'});
 const browser={tabs:{query:async()=>[{id:1,url:'https://shop.test/product'}]},scripting:{executeScript:async({func})=>[{result:func()}]}};
 assert.equal((await captureAiOffer(browser)).title,'Modelo X');browser.tabs.query=async()=>[{id:1,url:'chrome://settings'}];await assert.rejects(()=>captureAiOffer(browser),/HTTPS/);page.close();
});
test('painel local pareia, captura, pede consentimento e exibe sugestão como texto sem backend',async()=>{
 const page=new Window({url:'chrome-extension://'+'a'.repeat(32)+'/popup.html'});globalThis.document=page.document;document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
 const el=id=>document.getElementById(id),saved={},messages=[],calls=[],notices=[];let poll,analysis=null;
 const browser={permissions:{request:async()=>true,contains:async()=>true},storage:{session:{setAccessLevel:async()=>{},get:async key=>({[key]:saved[key]}),set:async v=>Object.assign(saved,v),remove:async key=>delete saved[key]}},runtime:{sendMessage:async message=>{messages.push(message);return {value:{user:{permissions:['affiliate_links']}}};}},tabs:{create:async()=>{},query:async()=>[{id:7,url:'https://shop.test/p'}]},scripting:{executeScript:async()=>[{result:{title:'Produto',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'}}]}};
 const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,interval:globalThis.setInterval,Option:globalThis.Option};globalThis.Option=page.Option;globalThis.chrome=browser;globalThis.setInterval=fn=>{poll=fn;return 1;};
 globalThis.fetch=async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});
  if(url.endsWith('/pair'))return Response.json({key:'fixture-pair-key'});
  if(url.endsWith('/models'))return Response.json({models:[{id:'fixture',name:'Fixture'}]});
  if(url.endsWith('/login'))return Response.json({url:'https://auth.openai.com/api/accounts/authorize?state=fixture'});
  if(url.endsWith('/analyze'))analysis={status:'completed',result:{reason:'<img src=x onerror=alert(1)> Revisar'}};
  if(url.endsWith('/cancel'))analysis=null;
  if(url.endsWith('/logout'))return Response.json({revoked:true});
  return Response.json({connected:true,account:{email:'admin@example.test',planEnabled:true},accounts:[],loginPending:false,error:'',analysis});
 };
 const tick=()=>new Promise(r=>setImmediate(r)),click=async id=>{el(id).click();await tick();await tick();};
 try{
  setupLocalAi((...v)=>notices.push(v));el('ai-code').value='code';await click('ai-pair');assert.equal(el('ai-code').value,'');assert.match(el('ai-status').textContent,/Usando seu plano/);
  await click('ai-login');await click('ai-models');el('ai-model').value='fixture';el('ai-model').dispatchEvent(new page.Event('change'));await click('ai-capture');assert.equal(el('ai-title').value,'Produto');
  assert.equal(el('ai-analyze').disabled,false,JSON.stringify({model:el('ai-model').value,options:el('ai-model').innerHTML,notices}));await click('ai-analyze');assert.match(notices.at(-1)[0],/Autorize/);
  el('ai-consent').checked=true;await click('ai-analyze');assert.match(el('ai-result').textContent,/Revisar/);assert.equal(el('ai-result').querySelector('img'),null);assert.equal(el('ai-consent').checked,false);
  assert.ok(calls.every(c=>c.url.startsWith('http://127.0.0.1:18765/')));assert.ok(messages.every(m=>m.type==='STATE'));
  await click('ai-logout');assert.match(notices.at(-1)[0],/desconectado/);poll();await tick();
 }finally{globalThis.chrome=previous.chrome;globalThis.fetch=previous.fetch;globalThis.setInterval=previous.interval;globalThis.Option=previous.Option;page.close();}
});
