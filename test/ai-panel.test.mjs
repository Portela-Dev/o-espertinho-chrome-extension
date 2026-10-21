import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {setupAiPanel} from '../dist/ai-panel.js';
test('contas centralizadas no topo e modelo da IA, sem análise avulsa ou autorização por checkbox',async()=>{
 const page=new Window({url:'chrome-extension://'+'a'.repeat(32)+'/popup.html?view=panel'}),previous={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome};
 globalThis.window=page;globalThis.document=page.document;document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));const notices=[];
 const state={phase:'idle',accounts:[],account:null,result:null,error:'',callbackObserved:false};let dispose=0;
 const app={status:()=>state,login:async()=>{state.phase='connected';state.account={email:'admin@example.test',planEnabled:true};state.callbackObserved=true;},models:async()=>[{id:'fixture',name:'Modelo de teste'}],cancelAnalysis:()=>{},cancelLogin:async()=>{},logout:async()=>{state.account=null;state.phase='idle';return {revoked:true};},dispose:()=>{dispose++;}};
 const el=id=>document.getElementById(id),tick=()=>new Promise(r=>setImmediate(r)),click=async id=>{el(id).click();await tick();await tick();};let cleanup;
 try{
  cleanup=await setupAiPanel(message=>notices.push(message),true,async()=>app);await click('direct-login');assert.match(el('direct-account-info').textContent,/admin@example.test/);assert.equal(el('direct-login').closest('section'),el('login').closest('section'));assert.equal(el('direct-model').closest('section'),el('login').closest('section'));assert.equal(el('ai-usage'),null);assert.equal(el('direct-callback-status'),null);assert.equal(document.querySelector('a[href*=Usage]'),null);assert.equal(el('limit-hint'),null);await click('direct-models');assert.equal(el('direct-model').options[0].value,'fixture');
  assert.equal(document.querySelectorAll('progress').length,1);assert.equal(el('direct-analyze'),null);assert.equal(el('direct-consent'),null);assert.equal(el('ai-workflow-consent'),null);assert.ok(el('ai-panel').compareDocumentPosition(el('workspace'))&page.Node.DOCUMENT_POSITION_FOLLOWING);
  await click('direct-logout');assert.match(el('direct-status').textContent,/Desconectado/);
 }finally{cleanup?.();assert.ok(dispose);page.close();Object.assign(globalThis,previous);}
});

test('popup oferece abrir painel sem inicializar sessão ou abrir aba de IA',async()=>{
 const page=new Window(),previous={window:globalThis.window,document:globalThis.document};globalThis.window=page;globalThis.document=page.document;
 document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));let opened=0;document.getElementById('display-mode').onclick=()=>opened++;
 try{const cleanup=await setupAiPanel(()=>{},false,async()=>{throw Error('Não inicializar no popup');});assert.equal(document.getElementById('ai-panel-content').hidden,true);document.getElementById('ai-open-panel').click();assert.equal(opened,1);cleanup();}finally{page.close();Object.assign(globalThis,previous);}
});
