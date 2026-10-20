import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewAiWorkflow} from '../dist/review-ai-workflow.js';
function fixture(){const sent=[],config={settings:{categoryEnabled:true,productEnabled:true}},transport=async(operation,payload)=>{sent.push({operation,payload});if(operation==='config')return config;if(operation==='queue')return {items:[{id:'one',title:'Um'},{id:'two',title:'Dois'}]};if(operation==='context')return {requestId:payload.id,task:payload.task,instructions:'Instrução configurada',offer:{title:'Produto'},categories:['Áudio'],products:[]};return {ok:true};};return {sent,config,transport};}
test('lote usa contexto do backend e só envia sugestões, com progresso e flags independentes',async()=>{
 const f=fixture(),inputs=[],flow=new ReviewAiWorkflow(f.transport,async input=>{inputs.push(input);return {action:'needs_review',category:'Áudio',productId:null,product:null,reason:'Revisar'};});
 await flow.run('category','shop',2,'model',true);assert.equal(flow.progress.completed,2);assert.equal(flow.progress.status,'completed');assert.equal(inputs[0].instructions,'Instrução configurada');assert.equal(f.sent.filter(v=>v.operation==='result').length,2);assert.ok(f.sent.every(v=>!JSON.stringify(v.payload).includes('token')));
 f.config.settings.categoryEnabled=false;await assert.rejects(()=>flow.run('category','shop',1,'model',true),/desativada/);assert.equal(flow.busy,false);
 await flow.run('product','shop',1,'model',true);assert.equal(inputs.at(-1).task,'product');
 await assert.rejects(()=>flow.run('product','shop',1,'model',false),/Autorize/);
});
test('cancelamento e falha liberam contexto sem salvar resultado nem repetir requisição',async()=>{
 const f=fixture();let flow;flow=new ReviewAiWorkflow(f.transport,async()=>{flow.cancel();return {action:'needs_review'};});
 await assert.rejects(()=>flow.run('product','shop',2,'model',true),/cancelada/);assert.equal(flow.progress.status,'cancelled');assert.equal(f.sent.filter(v=>v.operation==='result').length,0);assert.equal(f.sent.filter(v=>v.operation==='release').length,1);
 const fail=new ReviewAiWorkflow(f.transport,async()=>{throw Error('Limite do plano');});await assert.rejects(()=>fail.run('category','shop',2,'model',true),/Limite/);assert.equal(fail.progress.failed,1);assert.equal(fail.busy,false);
});
