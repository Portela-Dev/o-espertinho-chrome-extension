import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewAiWorkflow} from '../dist/review-ai-workflow.js';
import {LocalError} from '../dist/shared/openai-session.mjs';
import {analysisFailure} from '../dist/analysis-failure.js';
function fixture({failure, lostSave=false, deterministic=false, stage='type'}={}) {
 let done=0,calls=0,lost=false;const sent=[],receipts=new Map();
 const transport=async(op,p)=>{
  sent.push({op,p});
  if(op==='config')return {resolver:{protocolVersion:3,mode:'active',concurrency:1},settings:{productEnabled:true,categoryEnabled:true}};
  if(op==='resolverStart')return {id:'run',mode:'active',status:'running'};
  if(op==='resolverClaim')return {run:{status:done===6?'completed':'running',stats:{total:6,accepted:done,failed:0,fallback:[...receipts.values()].filter(r=>r.fallback).length}},item:done===6?null:{id:String(done),leaseId:'lease',context:{stage,enabled:true,offer:{title:'Produto'}},deterministic:deterministic&&done>0?{facts:{},reason:''}:null}};
  if(op==='resolverComplete'){
   const key=JSON.stringify(p);if(receipts.has(key))return receipts.get(key);
   done++;const result=p.error?{outcome:'drafted',fallback:{diagnostic:p.diagnostic}}:{outcome:'drafted'};receipts.set(key,result);
   if(lostSave&&!lost){lost=true;throw Error('resposta perdida');}return result;
  }
  return {};
 };
 const flow=new ReviewAiWorkflow(transport,async()=>{calls++;if(failure)throw failure;return {decision:{facts:{},reason:''}};});
 return {flow,sent,calls:()=>calls};
}
test('falha permanente da IA conclui 100% sem três chamadas por item nem enviar o erro bruto',async()=>{
 const f=fixture({failure:Error('Bearer PRIVATE_TOKEN secret@example.test')});await f.flow.run('product','shop',6,'model');
 assert.equal(f.flow.progress.completed,6);assert.equal(f.flow.progress.total,6);assert.equal(f.flow.progress.fallback,6);assert.equal(f.flow.progress.failed,0);assert.equal(f.flow.progress.status,'completed');assert.equal(f.calls(),2);
 assert.ok(f.sent.filter(s=>s.op==='resolverComplete').every(s=>s.p.diagnostic==='unknown'));
 assert.doesNotMatch(JSON.stringify(f.sent),/PRIVATE_TOKEN|secret@example/);
});
test('sessão ou limite do provedor suspende novas chamadas e mantém a catalogação pela alternativa',async()=>{
 for(const code of ['authentication','usage_limit']){
  const f=fixture({failure:new LocalError('não registrar',429,code)});await f.flow.run('category','shop',6,'model');
  assert.equal(f.calls(),1);assert.equal(f.flow.progress.completed,6);
 }
 for(const code of ['provider_unavailable','invalid_response','connection','timeout','unknown'])assert.equal(analysisFailure(new LocalError('sensitive',500,code)).code,code);
 assert.equal(analysisFailure(new LocalError('sensitive',401)).code,'authentication');
 assert.equal(analysisFailure(new DOMException('sensitive','TimeoutError')).code,'timeout');
});
test('perda da confirmação repete o mesmo payload sem nova análise ou produto duplicado',async()=>{
 const f=fixture({lostSave:true});await f.flow.run('product','shop',6,'model');
 assert.equal(f.calls(),6);assert.equal(f.flow.progress.completed,6);
 const saves=f.sent.filter(s=>s.op==='resolverComplete');assert.deepEqual(saves[0].p,saves[1].p);assert.equal(saves.length,7);
});
test('resultados determinísticos continuam sendo usados mesmo após falha da IA',async()=>{
 const f=fixture({failure:new LocalError('expired',401,'authentication'),deterministic:true});await f.flow.run('product','shop',6,'model');
 const saves=f.sent.filter(s=>s.op==='resolverComplete');assert.equal(saves[0].p.error,'technical');assert.ok(saves.slice(1).every(s=>s.p.decision&&!s.p.error));assert.equal(f.calls(),1);
});
test('cancelamento explícito durante a resposta não aplica nem mesmo a alternativa',async()=>{
 let flow,save=0;
 const f=fixture();flow=new ReviewAiWorkflow(async(op,p)=>{if(op==='resolverComplete')save++;return op==='config'?f.flow.refresh('shop'):op==='resolverStart'?{id:'run',status:'running'}:op==='resolverClaim'?{run:{status:'running',stats:{total:1,accepted:0}},item:{id:'i',leaseId:'l',context:{stage:'type',enabled:true}}}:{};},async()=>{flow.cancel();throw Error('cancelled');});
 await assert.rejects(()=>flow.run('product','shop',1,'model'),/interrompido/);assert.equal(save,0);assert.equal(flow.progress.status,'cancelled');
});
