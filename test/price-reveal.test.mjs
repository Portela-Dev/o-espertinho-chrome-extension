import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {extractCatalogProduct} from '../dist/catalog-product.js';
function fixture(t,html='<button type="button" id="show">Opções</button>'){
 const win=new Window({url:'https://shop.example.com/p'});t.after(()=>win.close());globalThis.document=win.document;globalThis.location=win.location;
 document.body.innerHTML='<h1>Produto</h1>'+html;
 const input={profile:{rules:[{field:'title',selectors:['h1']},{field:'price',selectors:['.primary'],priceSelection:'first_in_range'},{field:'price',selectors:['#offers > article:first-child .price'],priceSelection:'first_in_range',wholeSelector:'.whole',fractionSelector:'.fraction',priceReveal:{clickSelector:'#show',waitTimeoutMs:100}}]},settings:{timeoutMs:1,blockRules:[],categorySeparator:'>'},originalUrl:location.href,allowedOrigins:[location.origin]};
 return {input,read:()=>extractCatalogProduct(input),reveal:()=>extractCatalogProduct({...input,revealPrice:true})};
}
test('preços únicos e faixas válidas dispensam qualquer interação',async t=>{
 const f=fixture(t);let clicks=0;document.querySelector('#show').onclick=()=>clicks++;
 for(const [text,price] of [['R$ 321,00',32100],['R$ 506,58 – R$ 524,25',50658]]){
  const node=document.createElement('div');node.className='primary';node.textContent=text;document.body.append(node);
  assert.equal((await f.read()).data.priceCents,price);assert.equal((await f.reveal()).data.priceCents,price);node.remove();
 }
 assert.equal(clicks,0);
});
test('clique só é autorizado na segunda fase e lê o primeiro preço após hidratação',async t=>{
 const f=fixture(t);let clicks=0;
 document.querySelector('#show').onclick=()=>{clicks++;setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<div id="offers"><article><span class="price"><span class="whole">1519</span><span class="fraction">05</span></span></article><article><span class="price"><span class="whole">10</span><span class="fraction">00</span></span></article></div>'),20);};
 assert.deepEqual(await f.read(),{needsPriceReveal:true});assert.equal(clicks,0);
 const result=await f.reveal();assert.equal(result.outcome,'success');assert.equal(result.data.priceCents,151905);assert.equal(clicks,1);
});
test('clique sem preço termina por timeout e nunca se repete',async t=>{
 const f=fixture(t);let clicks=0;document.querySelector('#show').onclick=()=>clicks++;
 const result=await f.reveal();assert.equal(result.outcome,'technical_failure');assert.equal(clicks,1);
});
test('preço que aparece entre as fases evita o clique e mantém o range',async t=>{
 const f=fixture(t);let clicks=0;document.querySelector('#show').onclick=()=>clicks++;
 assert.equal((await f.read()).needsPriceReveal,true);document.body.insertAdjacentHTML('beforeend','<div class="primary">R$31,59 - R$40,00</div>');
 assert.equal((await f.reveal()).data.priceCents,3159);assert.equal(clicks,0);
});
for(const kind of ['login','challenge','unavailable'])test('estado '+kind+' tem prioridade antes e depois do clique',async t=>{
 const f=fixture(t);let clicks=0;f.input.settings.blockRules=[{kind,match:'selector',value:'#blocked'}];
 document.querySelector('#show').onclick=()=>{clicks++;document.body.insertAdjacentHTML('beforeend','<div id="blocked"></div>');};
 const result=await f.reveal();assert.equal(kind==='unavailable'?result.outcome:result.blocked,kind);assert.equal(clicks,1);
 const prior=await f.reveal();assert.equal(kind==='unavailable'?prior.outcome:prior.blocked,kind);assert.equal(clicks,1);
});
test('alvos ausentes, desabilitados, ocultos, inválidos, submits e links externos não são acionados',async t=>{
 const f=fixture(t);let clicks=0;document.addEventListener('click',()=>clicks++);
 for(const html of ['', '<button type="button" id="show" disabled>Opções</button>', '<button type="button" id="show" hidden>Opções</button>', '<button type="button" id="show" style="display:none">Opções</button>', '<div style="display:none"><button type="button" id="show">Opções</button></div>', '<form><button id="show">Enviar</button></form>', '<a id="show" href="https://other.example.com">Opções</a>','<a id="show" href="javascript:alert(1)">Opções</a>']){
  document.body.innerHTML='<h1>Produto</h1>'+html;assert.equal((await f.reveal()).outcome,'technical_failure');
 }
 f.input.profile.rules[2].priceReveal.clickSelector='[';assert.equal((await f.reveal()).outcome,'technical_failure');assert.equal(clicks,0);
});
test('perfis antigos não pedem interação',async t=>{
 const f=fixture(t);delete f.input.profile.rules[2].priceReveal;assert.equal((await f.read()).outcome,'technical_failure');
});

test('outros campos ausentes não acionam a interação se o preço já é válido',async t=>{
 const f=fixture(t);let clicks=0;document.querySelector('#show').onclick=()=>clicks++;document.querySelector('h1').remove();document.body.insertAdjacentHTML('beforeend','<span class="primary">R$ 50,00</span>');
 assert.equal((await f.read()).outcome,'technical_failure');assert.equal(clicks,0);
});
test('links internos configurados são aceitos e páginas fora do marketplace são recusadas',async t=>{
 const f=fixture(t,'<a id="show" href="#offers">Opções</a>');let clicks=0;document.querySelector('#show').onclick=event=>{event.preventDefault();clicks++;document.body.insertAdjacentHTML('beforeend','<span class="primary">R$ 50,00</span>');};
 assert.equal((await f.reveal()).data.priceCents,5000);assert.equal(clicks,1);
 document.querySelector('.primary').remove();f.input.allowedOrigins=['https://other.example.com'];assert.equal((await f.reveal()).outcome,'technical_failure');assert.equal(clicks,1);
});

test('botão pronto antecipa o fallback sem consumir o timeout geral de 30 segundos',{timeout:3000},async t=>{
 const f=fixture(t);let clicks=0;f.input.settings.timeoutMs=30000;document.querySelector('#show').onclick=()=>clicks++;
 assert.deepEqual(await f.read(),{needsPriceReveal:true});assert.equal(clicks,0);
});
test('botão que chega durante hidratação dispara a solicitação assim que fica pronto',{timeout:3000},async t=>{
 const f=fixture(t,'');f.input.settings.timeoutMs=30000;
 const pending=f.read();setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<button type="button" id="show">Opções</button>'),30);
 assert.deepEqual(await pending,{needsPriceReveal:true});
});
test('botão oculto não antecipa a interação e permite que o preço normal termine de carregar',{timeout:3000},async t=>{
 const f=fixture(t,'<button type="button" id="show" hidden>Opções</button>');f.input.settings.timeoutMs=30000;
 const pending=f.read();setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<div class="primary">R$ 506,58 - R$ 524,25</div>'),30);
 const result=await pending;assert.equal(result.outcome,'success');assert.equal(result.data.priceCents,50658);
});
