import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {setupDirectAiPage} from '../dist/direct-ai-view.js';
test('página direta exige consentimento, exibe a conta e renderiza resultado como texto',async()=>{
 const page=new Window({url:'chrome-extension://'+'a'.repeat(32)+'/direct-ai.html'}),previous={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome};
 globalThis.window=page;globalThis.document=page.document;document.write(await readFile(new URL('../extension/direct-ai.html',import.meta.url),'utf8'));
 globalThis.chrome={storage:{session:{get:async()=>({directAiOfferDraft:{title:'Oferta da aba',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'}})}}};
 const state={phase:'idle',accounts:[],account:null,result:null,error:'',callbackObserved:false};let dispose=0,analyses=0;
 const app={status:()=>state,login:async()=>{state.phase='connected';state.account={email:'admin@example.test',planEnabled:true};state.callbackObserved=true;},models:async()=>[{id:'fixture',name:'Modelo de teste'}],analyze:async body=>{analyses++;assert.equal(body.offer.title,'Oferta da aba');state.phase='completed';state.result={reason:'<img src=x> Revisar'};},cancelAnalysis:()=>{},cancelLogin:async()=>{},logout:async()=>{state.account=null;state.phase='idle';state.result=null;return {revoked:true};},dispose:()=>{dispose++;}};
 const el=id=>document.getElementById(id),tick=()=>new Promise(r=>setImmediate(r)),click=async id=>{el(id).click();await tick();await tick();};let cleanup;
 try{
  cleanup=await setupDirectAiPage(async()=>app);assert.equal(el('direct-title').value,'Oferta da aba');await click('direct-login');assert.match(el('direct-account-info').textContent,/Usando seu plano/);assert.match(el('direct-callback-status').textContent,/reconhecido/);
  await click('direct-models');el('direct-model').value='fixture';el('direct-model').dispatchEvent(new page.Event('change'));
  await click('direct-analyze');assert.equal(analyses,0);assert.match(el('direct-notice').textContent,/Autorize/);
  el('direct-consent').checked=true;el('direct-products').value='invalid';await click('direct-analyze');assert.match(el('direct-notice').textContent,/JSON/);
  el('direct-products').value='[]';await click('direct-analyze');assert.equal(analyses,1);assert.match(el('direct-result').textContent,/Revisar/);assert.equal(el('direct-result').querySelector('img'),null);
  await click('direct-logout');assert.match(el('direct-status').textContent,/desconectado/);await click('direct-dismiss');assert.equal(el('direct-notification').hidden,true);
 }finally{cleanup?.();assert.ok(dispose);page.close();Object.assign(globalThis,previous);}
});
