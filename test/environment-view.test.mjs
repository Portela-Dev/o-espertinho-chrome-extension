import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {renderCatalog} from '../dist/catalog-view.js';
import {setupAiPanel} from '../dist/ai-panel.js';

test('ambiente aparece desconectado, mantém seleção e bloqueia troca durante execução', async () => {
  const page = new Window({url:'chrome-extension://test/popup.html'});
  globalThis.window=page; globalThis.document=page.document;
  document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
  const view={backendUrl:'https://app.test',environmentId:'production',environments:[{id:'local',label:'Local',url:'http://localhost:3000'},{id:'production',label:'Produção <img>',url:'https://app.test'}],pairing:false,markets:[],message:'Entre novamente.',version:'0.3.0'};
  const select=document.getElementById('environment');
  renderCatalog(view,false);
  assert.equal(select.value,'production');assert.equal(select.disabled,false);
  assert.equal(select.options[1].textContent,'Produção <img>');assert.equal(select.querySelector('img'),null);
  renderCatalog(view,true);assert.equal(select.disabled,true);
  view.run={id:'active',step:'enrich',status:'paused_by_user',total:1,completed:0,failed:0};
  renderCatalog(view,false);assert.equal(select.disabled,true);
  view.run.status='completed';renderCatalog(view,false);assert.equal(select.disabled,false);
  await page.happyDOM.close();
});

test('trocar ambiente limpa revisão da IA e mantém a conta e modelo locais', async () => {
  const page=new Window({url:'chrome-extension://test/popup.html?view=panel'});
  globalThis.window=page;globalThis.document=page.document;
  document.write(await readFile(new URL('../extension/popup.html',import.meta.url),'utf8'));
  const state={phase:'connected',account:{email:'account@test.invalid',planEnabled:true},accounts:[],models:[{id:'test-model'}],selectedModel:'test-model',error:''};
  let cancelled=0,progress='old';
  const app={status:()=>state,sync:async()=>{},cancelAnalysis:()=>{cancelled++;},dispose:()=>{}};
  const cleanup=await setupAiPanel(()=>{},true,async()=>app,{view:()=>({backendUrl:'http://localhost:3000',markets:[]}),busy:()=>{},progress:value=>{progress=value;}});
  try {
    document.dispatchEvent(new page.Event('catalog-environment-changed'));
    assert.equal(cancelled,1);assert.equal(progress,undefined);
    assert.equal(state.account.email,'account@test.invalid');assert.equal(state.selectedModel,'test-model');
  } finally {cleanup();await page.happyDOM.close();}
});
