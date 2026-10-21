import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {extractCatalogProduct} from '../dist/catalog-product.js';

test('fontes JSON configuráveis preservam ordem, URLs diferentes e preferência por propriedade, sem executar scripts',async()=>{
 const win=new Window({url:'https://shop.example.com/p'});globalThis.document=win.document;globalThis.location=win.location;
 const photos=Array.from({length:20},(_,i)=>({original:i===2?null:'https://cdn.example.com/'+i+'.jpg',normal:'https://cdn.example.com/'+i+'-small.jpg'}));
 document.body.innerHTML='<h1>Produto</h1><span class="price">10,00</span><script id="gallery"></script><img src="https://cdn.example.com/0-small.jpg">';
 document.querySelector('script').textContent="doNotExecute(); const data = { 'photos': parse('"+JSON.stringify(photos)+"') };";
 const base=[{field:'title',selectors:['h1']},{field:'price',selectors:['.price']}];
 const source={field:'images',mode:'json',selectors:['#missing','#gallery'],jsonMarker:"'photos':",imageProperties:['original','normal']};
 const input={profile:{rules:[...base,source,{field:'images',mode:'attribute',attribute:'src',selectors:['img'],imageSource:'fallback'}]},settings:{timeoutMs:1,blockRules:[]},originalUrl:location.href,allowedOrigins:[location.origin]};
 let result=await extractCatalogProduct(input);assert.equal(result.outcome,'success');assert.equal(result.data.images.length,20);assert.equal(result.data.images[2],'https://cdn.example.com/2-small.jpg');assert.ok(result.data.evidence.some(e=>e.selector==='#gallery'));
 result=await extractCatalogProduct({...input,profile:{rules:[...base,source,{field:'images',mode:'attribute',attribute:'src',selectors:['img'],imageSource:'append'}]}});assert.equal(result.data.images.length,21);assert.equal(result.data.images.at(-1),'https://cdn.example.com/0-small.jpg');
 document.querySelector('script').textContent='not valid JSON';result=await extractCatalogProduct(input);assert.deepEqual(result.data.images,['https://cdn.example.com/0-small.jpg']);win.close();
});

test('JSON em atributo com caminho configurado e atributos alternativos aceitam somente URLs válidas',async()=>{
 const win=new Window({url:'https://shop.example.com/p'});globalThis.document=win.document;globalThis.location=win.location;
 document.body.innerHTML='<h1>Produto</h1><b>10,00</b><div id="data"></div><img data-hi="javascript:bad()" src="https://cdn.example.com/fallback.jpg">';
 const input={profile:{rules:[{field:'title',selectors:['h1']},{field:'price',selectors:['b']},{field:'images',mode:'json',selectors:['#data'],attribute:'data-json',jsonPath:'gallery.photos'},{field:'images',mode:'attribute',selectors:['img'],attribute:'data-hi',attributes:['src'],imageSource:'fallback'}]},settings:{timeoutMs:1,blockRules:[]},originalUrl:location.href,allowedOrigins:[location.origin]};
 document.querySelector('#data').setAttribute('data-json',JSON.stringify({gallery:{photos:['https://cdn.example.com/a.jpg','https://cdn.example.com/a.jpg','https://cdn.example.com/a-small.jpg','javascript:bad()','']}}));
 assert.deepEqual((await extractCatalogProduct(input)).data.images,['https://cdn.example.com/a.jpg','https://cdn.example.com/a-small.jpg']);
 document.querySelector('#data').setAttribute('data-json','{"gallery":{"photos":{}}}');assert.deepEqual((await extractCatalogProduct(input)).data.images,['https://cdn.example.com/fallback.jpg']);
 document.querySelector('#data').setAttribute('data-json','{"gallery":');assert.deepEqual((await extractCatalogProduct(input)).data.images,['https://cdn.example.com/fallback.jpg']);win.close();
});
