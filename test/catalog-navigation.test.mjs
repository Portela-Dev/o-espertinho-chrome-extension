import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {CatalogNavigation,checkPageState} from '../dist/catalog-navigation.js';
test('janela exclusiva não captura aba do usuário e navegação recusa destino não autorizado',async()=>{
 const state={},calls=[];const browser={permissions:{contains:async()=>true},windows:{create:async options=>{calls.push(options);return {id:9,tabs:[{id:4,windowId:9}]};},update:async()=>{}},tabs:{get:async()=>({id:4,windowId:9,status:'complete',url:'https://shop.example.com/p'}),update:async()=>{} }};
 const nav=new CatalogNavigation(browser,()=>state,async()=>{});assert.equal(await nav.ensure('https://shop.example.com/p',['https://shop.example.com']),4);
 assert.equal(calls[0].focused,false);await nav.wait(['https://shop.example.com'],500);
 await assert.rejects(nav.ensure('https://other.example.com/p',['https://shop.example.com']),/permission/);
 browser.tabs.get=async()=>{throw Error('closed');};await assert.rejects(nav.ensure('https://shop.example.com/p',['https://shop.example.com']),/tab_closed/);
});
test('detector distingue login, desafio e indisponibilidade sem interagir com a página',()=>{
 const win=new Window({url:'https://shop.example.com/login'});globalThis.document=win.document;globalThis.location=win.location;
 assert.equal(checkPageState([{kind:'login',match:'url_contains',value:'/login'}]),'login');
 document.body.innerHTML='<div class="challenge">Verificação</div>';assert.equal(checkPageState([{kind:'challenge',match:'selector',value:'.challenge'}]),'challenge');
 assert.equal(checkPageState([{kind:'unavailable',match:'text',value:'Esgotado'}]),null);
});
