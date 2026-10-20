import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {setupAiPanel} from '../dist/ai-panel.js';
test('painel exige consentimento, exibe a conta e renderiza resultado como texto',async()=>{
 const page=new Window({url:'chrome-extension://'+'a'.repeat(32)+'/popup.html?view=panel'}),previous={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome};
 globalThis.window=page;globalThis.document=page.document;document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
 globalThis.chrome={tabs:{query:async()=>[{id:1,url:'https://shop.test/p'}]},scripting:{executeScript:async()=>[{result:{title:'Oferta da aba',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'}}]}};const notices=[];
 const state={phase:'idle',accounts:[],account:null,result:null,error:'',callbackObserved:false};let dispose=0,analyses=0;
 const app={status:()=>state,login:async()=>{state.phase='connected';state.account={email:'admin@example.test',planEnabled:true};state.callbackObserved=true;},models:async()=>[{id:'fixture',name:'Modelo de teste'}],analyze:async body=>{analyses++;assert.equal(body.offer.title,'Oferta da aba');state.phase='completed';state.result={reason:'<img src=x> Revisar'};},cancelAnalysis:()=>{},cancelLogin:async()=>{},logout:async()=>{state.account=null;state.phase='idle';state.result=null;return {revoked:true};},dispose:()=>{dispose++;}};
 const el=id=>document.getElementById(id),tick=()=>new Promise(r=>setImmediate(r)),click=async id=>{el(id).click();await tick();await tick();};let cleanup;
 try{
  cleanup=await setupAiPanel(message=>notices.push(message),true,async()=>app);await click('direct-capture');assert.equal(el('direct-title').value,'Oferta da aba');await click('direct-login');assert.match(el('direct-account-info').textContent,/Usando seu plano/);assert.match(el('direct-callback-status').textContent,/reconhecido/);
  await click('direct-models');el('direct-model').value='fixture';el('direct-model').dispatchEvent(new page.Event('change'));
  await click('direct-analyze');assert.equal(analyses,0);assert.match(notices.at(-1),/Autorize/);
  el('direct-consent').checked=true;el('direct-products').value='invalid';await click('direct-analyze');assert.match(notices.at(-1),/JSON/);
  el('direct-products').value='[]';await click('direct-analyze');assert.equal(analyses,1);assert.match(el('direct-result').textContent,/Revisar/);assert.equal(el('direct-result').querySelector('img'),null);
  await click('direct-logout');assert.match(el('direct-status').textContent,/desconectado/);
 }finally{cleanup?.();assert.ok(dispose);page.close();Object.assign(globalThis,previous);}
});

test('popup oferece abrir painel sem inicializar sessão ou abrir aba de IA',async()=>{
 const page=new Window(),previous={window:globalThis.window,document:globalThis.document};globalThis.window=page;globalThis.document=page.document;
 document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));let opened=0;document.getElementById('display-mode').onclick=()=>opened++;
 try{const cleanup=await setupAiPanel(()=>{},false,async()=>{throw Error('Não inicializar no popup');});assert.equal(document.getElementById('ai-panel-content').hidden,true);document.getElementById('ai-open-panel').click();assert.equal(opened,1);cleanup();}finally{page.close();Object.assign(globalThis,previous);}
});
