import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {discoverPage} from '../dist/catalog-discovery.js';
const config={rendering:{frameSelector:'',readySelector:'',timeoutMs:1000,settleDelayMs:0},extraction:{itemSelector:'.card',linkSelector:'a',linkAttribute:'href'},pagination:{mode:'single',endSelector:'',waitAfterMs:1}};
test('vitrine resolve links relativos e dispensa paginação; desafio impede extração e clique',async()=>{
 const win=new Window({url:'https://shop.example.com/list'});globalThis.document=win.document;globalThis.location=win.location;globalThis.window=win;
 document.body.innerHTML='<div class="card"><a href="/product?ref=one">Produto</a></div><div class="card"><a href="/another">Outro</a></div>';
 const result=await discoverPage({config,rules:[],action:'read',page:1});assert.equal(result.done,true);assert.deepEqual(result.links,['https://shop.example.com/product?ref=one','https://shop.example.com/another']);
 let clicks=0;document.querySelector('a').onclick=()=>clicks++;
 const blocked=await discoverPage({config:{...config,pagination:{mode:'next',nextSelector:'a'}},rules:[{kind:'challenge',match:'selector',value:'.card'}],action:'advance',page:1});
 assert.equal(blocked.blocked,'challenge');assert.equal(clicks,0);
});


test('paginação por botão avança sem href e limite de cards não trunca silenciosamente',async()=>{
 const win=new Window({url:'https://shop.example.com/list'});globalThis.document=win.document;globalThis.location=win.location;globalThis.window=win;
 document.body.innerHTML='<div class="card"><a href="/first">Primeiro</a></div><button class="next">Próximo</button>';
 const nextConfig={...config,pagination:{mode:'next',nextSelector:'.next',waitAfterMs:1}};
 document.querySelector('.next').onclick=()=>{document.body.innerHTML='<div class="card"><a href="/second">Segundo</a></div>';};
 const first=await discoverPage({config:nextConfig,rules:[],action:'read',page:1});assert.equal(first.done,false);assert.equal(first.nextUrl,undefined);
 await discoverPage({config:nextConfig,rules:[],action:'advance',page:2});await new Promise(r=>setTimeout(r,10));assert.deepEqual((await discoverPage({config:nextConfig,rules:[],action:'read',page:2})).links,['https://shop.example.com/second']);
 document.body.innerHTML=Array(501).fill('<div class="card"><a href="/item">Item</a></div>').join('');
 await assert.rejects(discoverPage({config,rules:[],action:'read',page:1}),/limit/);
});
