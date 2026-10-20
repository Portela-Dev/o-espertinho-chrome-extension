import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisInput,readSuggestion,analyze,validateSuggestion} from '../local-ai/analysis.mjs';
const input={offer:{title:'Headset Modelo X',description:'Fone estéreo',brand:'Marca',sourceCategory:'Áudio'},categories:['Informática > Fones'],products:[{id:'p1',name:'Headset Modelo X',brand:'Marca'}]};
const suggestion={action:'link_existing',category:'Informática > Fones',productId:'p1',product:null,reason:'Mesmo modelo e marca. Cor não distingue o produto.'};
function stream(events){const text=events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''),bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}));}
const complete=text=>stream([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed'}}]);
test('análise usa modelo da conta e Responses oficial, sem ferramentas ou armazenamento',async()=>{
 const calls=[],session={models:async()=>[{id:'fixture'}],token:async()=>'local-secret',fetcher:async(url,options)=>{calls.push({url,options});return complete(JSON.stringify(suggestion));}};
 const result=await analyze(session,{...input,model:'fixture'},new AbortController().signal);assert.equal(result.productId,'p1');assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
 const body=JSON.parse(calls[0].options.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.tools,undefined);assert.match(body.instructions,/Cor, tensão e tamanho/);assert.doesNotMatch(JSON.stringify(result),/local-secret/);
 await assert.rejects(()=>analyze(session,{...input,model:'other'}),/disponível/);
});
test('resposta incompleta, limite, JSON inválido e produto inventado não geram sugestão válida',async()=>{
 for(const events of [[{type:'response.output_text.delta',delta:'{}'}],[{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}],[{type:'response.incomplete'}]])await assert.rejects(()=>readSuggestion(stream(events),input));
 await assert.rejects(()=>readSuggestion(complete('not JSON'),input),/JSON/);
 await assert.rejects(()=>readSuggestion(complete(JSON.stringify({...suggestion,productId:'invented'})),input),/candidatos/);
 await assert.rejects(()=>readSuggestion(new Response('',{status:429}),input),/Limite/);
 assert.throws(()=>analysisInput({offer:{title:''}}));assert.throws(()=>analysisInput({...input,products:Array(31).fill(input.products[0])}));
 const created=validateSuggestion({...suggestion,action:'create_new',productId:null,product:{name:'X',description:'',brand:''}},input);assert.equal(created.product.name,'X');
});
