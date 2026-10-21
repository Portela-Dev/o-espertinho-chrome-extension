import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewAiWorkflow} from '../dist/review-ai-workflow.js';
function fixture(){
 const sent=[],catalog={revision:'1',categories:[{id:'cat',path:['Áudio']}],products:[],drafts:[]},config={settings:{categoryEnabled:true,productEnabled:true}};
 const transport=async(operation,payload)=>{
  sent.push({operation,payload});if(operation==='config')return config;
  if(operation==='inventory')return {items:catalog[payload.kind],revision:catalog.revision,nextCursor:null};
  if(operation==='queue')return {items:payload.task==='product'?[{id:'one',title:'Um'},{id:'two',title:'Dois'}]:[{id:'one',title:'Um'}]};
  if(operation==='context')return {requestId:payload.id,task:payload.task,instructions:'Instrução configurada',offer:{title:'Produto'}};
  if(operation==='result'){
   const isCategory=['use_category','create_category'].includes(payload.suggestion.action),pending=payload.suggestion.action==='needs_review';
   catalog.revision=String(Number(catalog.revision)+1);
   const draft={id:'draft-one',name:'Produto',brand:'Marca',description:'',kind:'draft'};
   if(!isCategory&&!pending)catalog.drafts=[draft];
   return {applied:!pending,inventory:{revision:catalog.revision,categories:[],products:[],drafts:!isCategory&&!pending?[draft]:[]}};
  }
  return {ok:true};
 };return {sent,config,transport};
}
const create={action:'create_new',category:'',productId:null,categoryId:null,product:{name:'Produto',description:'',brand:'Marca'},reason:'Identidade suficiente.'};
test('lote carrega inventário completo, reutiliza novo rascunho em memória e aplica decisões com flags independentes',async()=>{
 const f=fixture(),inputs=[],flow=new ReviewAiWorkflow(f.transport,async input=>{inputs.push(input);return input.task==='category'?{action:'use_category',categoryId:'cat',category:'Áudio',productId:null,product:null,reason:'Reutilizar'}:input.products.length?{...create,action:'link_existing',product:null,productId:input.products[0].id}:create;});
 await flow.run('product','shop',2,'model');assert.equal(flow.progress.completed,2);assert.equal(flow.progress.status,'completed');assert.equal(inputs[0].instructions,'Instrução configurada');assert.equal(inputs[1].products[0].kind,'draft');assert.equal(f.sent.filter(v=>v.operation==='result').length,2);
 assert.ok(f.sent.filter(v=>v.operation==='context').every(v=>v.payload.inventoryRevision));
 f.config.settings.productEnabled=false;await assert.rejects(()=>flow.run('product','shop',1,'model'),/desativada/);
 await flow.run('category','shop',1,'model');assert.equal(flow.progress.completed,1);assert.equal(inputs.at(-1).task,'category');
});
test('cancelamento e falha liberam contexto sem aplicar decisão ou repetir inferência',async()=>{
 const f=fixture();let flow;flow=new ReviewAiWorkflow(f.transport,async()=>{flow.cancel();return create;});
 await assert.rejects(()=>flow.run('product','shop',2,'model'),/cancelada/);assert.equal(flow.progress.status,'cancelled');assert.equal(f.sent.filter(v=>v.operation==='result').length,0);assert.equal(f.sent.filter(v=>v.operation==='release').length,1);
 const fail=new ReviewAiWorkflow(f.transport,async()=>{throw Error('Limite do plano');});await assert.rejects(()=>fail.run('product','shop',2,'model'),/Limite/);assert.equal(fail.progress.failed,1);assert.equal(fail.busy,false);
});

test('pendências contam como links processados, sem fingir que foram catalogados',async()=>{
 const f=fixture();let calls=0;const flow=new ReviewAiWorkflow(f.transport,async()=>++calls===1?create:{action:'needs_review',category:'',categoryId:null,productId:null,product:null,reason:'Ambíguo'});
 await flow.run('product','shop',2,'model');assert.equal(flow.progress.completed,1);assert.equal(flow.progress.pending,1);assert.equal(flow.progress.total,2);assert.equal(flow.progress.status,'completed');
});
