import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {CatalogNavigation,checkPageState} from '../dist/catalog-navigation.js';
test('aba própria recebe foco ao abrir, preserva a janela e não retoma foco nas navegações seguintes',async()=>{
 const state={},calls=[];const browser={permissions:{contains:async()=>true},windows:{getLastFocused:async()=>({id:9,type:'normal'}),update:async()=>{}},tabs:{create:async options=>{calls.push(options);return {id:4,windowId:9};},get:async()=>({id:4,windowId:9,status:'complete',url:'https://shop.example.com/p'}),update:async(id,options)=>{calls.push({id,...options});} }};
 const nav=new CatalogNavigation(browser,()=>state,async()=>{});assert.equal(await nav.ensure('https://shop.example.com/p',['https://shop.example.com']),4);
 assert.deepEqual(calls[0],{windowId:9,url:'https://shop.example.com/p',active:true});await nav.wait(['https://shop.example.com'],500);
 await nav.ensure('https://shop.example.com/other',['https://shop.example.com']);assert.deepEqual(calls[1],{id:4,url:'https://shop.example.com/other'});
 await assert.rejects(nav.ensure('https://other.example.com/p',['https://shop.example.com']),/permission/);
 browser.tabs.get=async()=>{throw Error('closed');};await assert.rejects(nav.ensure('https://shop.example.com/p',['https://shop.example.com']),/tab_closed/);
 await assert.rejects(nav.focus(),/tab_closed/);
 browser.tabs.get=async()=>({id:4,windowId:99});await assert.rejects(nav.focus(),/tab_closed/);
});

test('trocar de janela move somente a aba controlada; aba movida externamente exige recuperação explícita',async()=>{
 const state={tabId:4,windowId:9,hostWindowId:12},moves=[];
 const browser={permissions:{contains:async()=>true},windows:{get:async id=>({id,type:'normal'}),update:async()=>{}},tabs:{get:async()=>({id:4,windowId:9}),move:async(id,options)=>{moves.push({id,...options});return {id,windowId:options.windowId};},update:async()=>{}}};
 const nav=new CatalogNavigation(browser,()=>state,async()=>{});await nav.focus();assert.deepEqual(moves,[{id:4,windowId:12,index:-1}]);assert.equal(state.windowId,12);
 browser.tabs.get=async()=>({id:4,windowId:99});await assert.rejects(nav.ensure('https://shop.example.com/p',['https://shop.example.com']),/tab_closed/);assert.equal(moves.length,1);
});
test('detector distingue login, desafio e indisponibilidade sem interagir com a página',()=>{
 const win=new Window({url:'https://shop.example.com/login'});globalThis.document=win.document;globalThis.location=win.location;
 assert.equal(checkPageState([{kind:'login',match:'url_contains',value:'/login'}]),'login');
 document.body.innerHTML='<div class="challenge">Verificação</div>';assert.equal(checkPageState([{kind:'challenge',match:'selector',value:'.challenge'}]),'challenge');
 assert.equal(checkPageState([{kind:'unavailable',match:'text',value:'Esgotado'}]),null);
});
