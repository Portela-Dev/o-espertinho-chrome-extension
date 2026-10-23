import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewAiInventory,decideReview} from '../dist/review-ai-inventory.js';
const proposed={action:'create_new',category:'',categoryId:null,productId:null,product:{name:'Novo',brand:'',description:''},reason:'Novo'};
test('comparação global percorre todos os lotes e encontra produto depois do antigo limite',async()=>{
 const inventory=new ReviewAiInventory();inventory.products=Array.from({length:65},(_,i)=>({id:'p'+i,name:'Modelo '+i,brand:'Marca',kind:'product'}));let calls=0;
 const decision=await decideReview({task:'product',offer:{title:'Modelo 64'}},inventory,'fixture',async input=>{calls++;return input.products.some(p=>p.id==='p64')?{...proposed,action:'link_existing',product:null,productId:'p64'}:proposed;},()=>{});
 assert.equal(calls,4);assert.equal(decision.productId,'p64');
});

test('decisão final compara todos os vínculos e uma dúvida em lote irrelevante não veta criação',async()=>{
 const inventory=new ReviewAiInventory();inventory.products=Array.from({length:60},(_,i)=>({id:'p'+i,name:'Modelo '+i}));let calls=0;
 const result=await decideReview({task:'product'},inventory,'fixture',async input=>{calls++;if(!input.products.length)return proposed;return calls===1?{...proposed,action:'needs_review',product:null,reason:'Candidatos não correspondem.'}:proposed;},()=>{});
 assert.equal(result.action,'create_new');assert.equal(calls,3);
 const seen=[];const matched=await decideReview({task:'product'},inventory,'fixture',async input=>{seen.push(input.products.map(p=>p.id));return {...proposed,action:'link_existing',product:null,productId:input.products.at(-1).id};},()=>{});
 assert.deepEqual(seen.at(-1),['p29','p59']);assert.equal(matched.productId,'p59');
});

test('contradição invalida antes de criar; categorias completas podem criar filho de raiz existente',async()=>{
 const inventory=new ReviewAiInventory();inventory.products=Array.from({length:35},(_,i)=>({id:'p'+i}));let calls=0;
 const invalid=await decideReview({task:'product'},inventory,'fixture',async()=>{calls++;return {action:'invalid',reason:'128 GB contra 256 GB.'};},()=>{});assert.equal(invalid.action,'invalid');assert.equal(calls,1);
 inventory.categories=[{id:'root',path:['Saúde']}];const category=await decideReview({task:'category'},inventory,'fixture',async input=>{assert.equal(input.allowCreate,true);return {action:'create_category',category:'Saúde > Suplementos Alimentares'};},()=>{});assert.equal(category.action,'create_category');
});
test('categorização considera todas as árvores e desempata os candidatos, sem criar quando há equivalente',async()=>{
 const inventory=new ReviewAiInventory();inventory.categories=Array.from({length:125},(_,i)=>({id:'c'+i,path:['Grupo '+i]}));let seen=new Set(),calls=0;
 const result=await decideReview({task:'category'},inventory,'fixture',async input=>{calls++;input.categories.forEach(c=>seen.add(c.id));return input.categories.some(c=>c.id==='c124')?{action:'use_category',categoryId:'c124'}:{action:'create_category',category:'Grupo novo'};},()=>{});
 assert.equal(seen.size,125);assert.equal(result.categoryId,'c124');assert.equal(calls,3);
 inventory.merge({revision:'2',categories:[{id:'new',path:['Recém criada']}],drafts:[{id:'draft',kind:'draft'}]});assert.ok(inventory.categories.some(c=>c.id==='new'));assert.ok(inventory.products.some(p=>p.id==='draft'));
 inventory.merge({revision:'3',products:[{id:'definitive',kind:'product'}],removeDraftIds:['draft']});assert.equal(inventory.products.some(p=>p.id==='draft'),false);
});
test('inventário paginado é completo e detecta revisões inconsistentes e cursores repetidos',async()=>{
 const inventory=new ReviewAiInventory();let calls=0;
 await inventory.load(async(_op,p)=>{calls++;return {revision:'1',items:[{id:p.kind+(p.cursor?'2':'1')}],nextCursor:p.cursor?null:'next'};},()=>{});assert.equal(calls,6);assert.equal(inventory.categories.length,2);assert.equal(inventory.products.length,4);
 await assert.rejects(()=>inventory.load(async(_op,p)=>({revision:p.cursor?'2':'1',items:[],nextCursor:'again'}),()=>{}),/inconsistente/);
 await assert.rejects(()=>inventory.load(async()=>({revision:'1',items:[],nextCursor:'same'}),()=>{}),/sem progresso/);
});
