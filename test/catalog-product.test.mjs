import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {extractCatalogProduct} from '../dist/catalog-product.js';
const settings={timeoutMs:1,blockRules:[],categorySeparator:'>'};
const profile={rules:[{field:'title',selectors:['h1'],mode:'text',required:true},{field:'price',selectors:['.price'],mode:'text',required:true},{field:'category',selectors:['nav a'],mode:'text'},{field:'images',selectors:['img'],mode:'attribute',attribute:'src'}]};

test('seletores configurados para HTML fornecido preservam preço condicionado, breadcrumb e avaliações',async()=>{
 const win=new Window({url:'https://shop.example.com/product'});globalThis.document=win.document;globalThis.location=win.location;
 document.head.innerHTML='<meta property="og:description" content="Produto de vitrine"><meta property="og:image" content="https://cdn.example.com/product.jpg">';
 document.body.innerHTML='<h1 class="auau1S">Iphone 13 Branco Apple 128gb VITRINE</h1><div class="uLEz5u"><button><div class="FllsTu">4.8</div></button><button><div class="FllsTu">133</div><div>Avaliações</div></button><div>257 Vendidos</div></div><section aria-live="polite"><div class="pyzxvq pw3J3G">R$2.116,00</div><p>no Pix com cupom</p><p>ou R$2.400,00 sem cupom</p></section><div class="page-product__breadcrumb"><a href="/">Shopee</a><a href="/Celulares-e-Dispositivos-cat.11059988">Celulares e Dispositivos</a><a href="/Celulares-cat.11059988.11060166">Celulares</a><span>Nome do produto</span></div>';
 const rules=[{field:'title',selectors:['h1'],mode:'text',required:true},{field:'price',selectors:['section[aria-live="polite"] .pyzxvq'],mode:'text',required:true},{field:'conditions',selectors:['section[aria-live="polite"]'],mode:'text'},{field:'category',selectors:['.page-product__breadcrumb a[href*="-cat."]'],mode:'text'},{field:'rating',selectors:['.uLEz5u button:first-child .FllsTu'],mode:'text'},{field:'reviewCount',selectors:['.uLEz5u button:nth-child(2) .FllsTu'],mode:'text'},{field:'images',selectors:['meta[property="og:image"]'],mode:'attribute',attribute:'content'}];
 const result=await extractCatalogProduct({profile:{rules},settings,originalUrl:location.href,allowedOrigins:[location.origin]});
 assert.equal(result.outcome,'success');assert.equal(result.data.priceCents,211600);assert.equal(result.data.rating,4.8);assert.equal(result.data.reviewCount,133);assert.match(result.data.conditions,/Pix com cupom/);assert.deepEqual(result.sourceCategoryPath,['Celulares e Dispositivos','Celulares']);assert.deepEqual(result.data.images,['https://cdn.example.com/product.jpg']);win.close();
});

test('avaliações usam seletores configurados, atributos e números locais; valores ausentes são opcionais',async()=>{
 const win=new Window({url:'https://shop.example.com/p'});globalThis.document=win.document;globalThis.location=win.location;
 const input={profile:{rules:[...profile.rules,{field:'rating',selectors:['.rating'],mode:'attribute',attribute:'title'},{field:'reviewCount',selectors:['.reviews'],mode:'text'}]},settings,originalUrl:location.href,allowedOrigins:[location.origin]};
 for(const [score,count,rating,reviewCount] of [['4,8 de 5 estrelas','(3.102)',4.8,3102],['4.3 out of 5','1,234 avaliações',4.3,1234],['0','0',0,0],['4,5','1,2 mil avaliações',4.5,1200],['6','sem avaliações',null,null],['-2','-3',null,null]]){
  document.body.innerHTML='<h1>Produto</h1><span class="price">R$ 50,00</span><span class="rating"></span><span class="reviews"></span>';
  document.querySelector('.rating').setAttribute('title',score);document.querySelector('.reviews').textContent=count;
  const result=await extractCatalogProduct(input);assert.equal(result.outcome,'success');assert.equal(result.data.rating,rating);assert.equal(result.data.reviewCount,reviewCount);
 }
 document.querySelector('.rating').remove();document.querySelector('.reviews').remove();assert.equal((await extractCatalogProduct(input)).outcome,'success');win.close();
});
test('extrai preço em centavos e breadcrumb ordenado; preço ausente não significa indisponível',async()=>{
 const win=new Window({url:'https://shop.example.com/p'});globalThis.document=win.document;globalThis.location=win.location;
 document.body.innerHTML='<nav><a>Eletrônicos</a><a>Áudio</a></nav><h1>Produto</h1><div class="price">R$ 1.234,56</div><img src="https://cdn.example.com/photo.png">';
 const input={profile,settings,originalUrl:location.href,allowedOrigins:[location.origin]};
 const result=await extractCatalogProduct(input);assert.equal(result.outcome,'success');assert.equal(result.data.priceCents,123456);assert.deepEqual(result.sourceCategoryPath,['Eletrônicos','Áudio']);assert.equal(result.data.images.length,1);
 document.querySelector('.price').remove();assert.equal((await extractCatalogProduct(input)).outcome,'technical_failure');
 const blocked=await extractCatalogProduct({...input,settings:{...settings,blockRules:[{kind:'login',match:'selector',value:'h1'}]}});assert.equal(blocked.blocked,'login');
});

test('indicador configurado de indisponibilidade encerra a espera sem preço; login tem prioridade', {timeout:2000}, async()=>{
 const win=new Window({url:'https://shop.example.com/p'});globalThis.document=win.document;globalThis.location=win.location;
 document.body.innerHTML='<h1>Produto</h1><div id="stock-unavailable">Sem estoque</div>';
 const input={profile,settings:{...settings,timeoutMs:30000,blockRules:[{kind:'unavailable',match:'selector',value:'#stock-unavailable'},{kind:'login',match:'selector',value:'#login'}]},originalUrl:location.href,allowedOrigins:[location.origin]};
 const result=await extractCatalogProduct(input);assert.equal(result.outcome,'unavailable');assert.equal(result.data.priceCents,null);assert.equal(result.data.originalPriceCents,null);assert.equal(result.data.missing.includes('price'),false);
 document.body.insertAdjacentHTML('beforeend','<div id="login">Login</div>');assert.equal((await extractCatalogProduct(input)).blocked,'login');
});
