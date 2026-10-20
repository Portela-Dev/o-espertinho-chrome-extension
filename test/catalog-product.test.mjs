import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {extractCatalogProduct} from '../dist/catalog-product.js';
const settings={timeoutMs:1,blockRules:[],categorySeparator:'>'};
const profile={rules:[{field:'title',selectors:['h1'],mode:'text',required:true},{field:'price',selectors:['.price'],mode:'text',required:true},{field:'category',selectors:['nav a'],mode:'text'},{field:'images',selectors:['img'],mode:'attribute',attribute:'src'}]};
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
