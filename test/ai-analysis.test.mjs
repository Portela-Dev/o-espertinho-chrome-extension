import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisInput,readSuggestion,analyze,validateSuggestion} from '../extension/shared/analysis.mjs';
const input={task:'resolver',stage:'match',offer:{title:'Headset Modelo X',description:'Fone estéreo',brand:'Marca',sourceCategory:'Áudio'},categories:[],candidates:[{id:'p1',title:'Headset Modelo X',brand:'Marca'}],policies:[],instructions:''};
const suggestion={productId:'p1',reason:'Mesmo modelo e marca. Cor não distingue o produto.'};
function stream(events){const text=events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''),bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}));}
const complete=text=>stream([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed'}}]);
test('resposta concluída encerra a leitura mesmo quando o provedor mantém o stream aberto',{timeout:1000},async()=>{
 let cancelled=false;
 const event={type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(suggestion)}]}]}};
 const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));},cancel(){cancelled=true;}}));
 assert.deepEqual(await readSuggestion(response,input),suggestion);assert.equal(cancelled,true);
});
test('análise usa modelo da conta e Responses oficial, sem ferramentas ou armazenamento',async()=>{
 const calls=[],session={models:async()=>[{id:'fixture'}],token:async()=>'local-secret',fetcher:async(url,options)=>{calls.push({url,options});return complete(JSON.stringify(suggestion));}};
 const result=await analyze(session,{task:'resolver',context:input,model:'fixture'},new AbortController().signal);assert.equal(result.decision.productId,'p1');assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
 const body=JSON.parse(calls[0].options.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.tools,undefined);assert.match(body.instructions,/tela/);assert.doesNotMatch(JSON.stringify(result),/local-secret/);
 await assert.rejects(()=>analyze(session,{task:'resolver',context:input,model:'other'}),/indisponível/);
});
test('resposta incompleta, limite, JSON inválido e produto inventado não geram sugestão válida',async()=>{
 assert.deepEqual(await readSuggestion(complete('```json\n'+JSON.stringify(suggestion)+'\n```'),input),suggestion);
 await assert.rejects(()=>readSuggestion(complete('```json\n'+JSON.stringify(suggestion)),input),e=>e.code==='invalid_response');
 for(const events of [[{type:'response.output_text.delta',delta:'{}'}],[{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}],[{type:'response.incomplete'}]])await assert.rejects(()=>readSuggestion(stream(events),input));
 await assert.rejects(()=>readSuggestion(complete('not JSON'),input),e=>e.code==='invalid_response');
 await assert.rejects(()=>readSuggestion(complete('Bearer PRIVATE_TOKEN'),input),e=>e.code==='invalid_response'&&e.message==='A resposta da IA não contém JSON válido.');
 await assert.rejects(()=>readSuggestion(complete(JSON.stringify({facts:{},reason:'',policyId:'wrong'})),{...input,stage:'identity',policy:{id:'smartphone',attributes:[]}}),e=>e.code==='invalid_response'&&e.message==='Identidade fora da política.');
 await assert.rejects(()=>readSuggestion(complete(JSON.stringify({facts:{brand:{value:'Marca',evidence:'Marca'}},reason:'',policyId:'smartphone'})),{...input,stage:'identity',policy:{id:'smartphone',attributes:[]}}),e=>e.code==='invalid_response'&&e.message==='Atributo fora da política.');
 await assert.rejects(()=>readSuggestion(complete(JSON.stringify({...suggestion,productId:'invented'})),input),e=>e.code==='invalid_response');
 for(const [status,code] of [[400,'invalid_response'],[401,'authentication'],[403,'authentication'],[429,'usage_limit'],[500,'provider_unavailable']])
  await assert.rejects(()=>readSuggestion(new Response('',{status}),input),e=>e.status===status&&e.code===code);
 assert.throws(()=>analysisInput({offer:{title:''}}));assert.throws(()=>analysisInput({task:'resolver',context:{...input,candidates:Array(31).fill(input.candidates[0])}}));
 assert.deepEqual(validateSuggestion({...suggestion,productId:null},input),{productId:null,reason:suggestion.reason});
});

 test('tarefas independentes separam identidade de produto e categoria e usam prompt do admin sem dados da oferta como instruções',async()=>{
  let body;const session={models:async()=>[{id:'fixture'}],token:async()=>'private',fetcher:async(_url,options)=>{body=JSON.parse(options.body);return complete(JSON.stringify({categoryId:null,path:['Áudio'],reason:''}));}};
  const category={...input,stage:'category',prompt:'Prefira categorias específicas.'};
  await analyze(session,{task:'resolver',context:category,model:'fixture'},new AbortController().signal);
  assert.match(body.instructions,/Prefira categorias específicas/);assert.match(body.instructions,/categoria/);assert.equal(JSON.parse(body.input[0].content).instructions,undefined);
  assert.throws(()=>validateSuggestion(suggestion,category));
  assert.equal(validateSuggestion(suggestion,input).productId,'p1');
 });

test('política do admin e mapeamento chegam à chamada; inválidos não podem aplicar produto e kits são separados',async()=>{
 let body;const session={models:async()=>[{id:'fixture'}],token:async()=>'private',fetcher:async(_url,options)=>{body=JSON.parse(options.body);return complete(JSON.stringify({action:'invalid',reason:'Título e descrição divergem.',productId:null,categoryId:null,product:null}));}};
 const specifications=[{name:'RAM',value:'8 GB'}];
 const result=await analyze(session,{task:'resolver',context:{...input,offer:{...input.offer,specifications},prompt:'Minha política personalizada: kits são independentes.'},model:'fixture'},new AbortController().signal);
 assert.equal(result.decision.productId,null);assert.equal(result.decision.action,undefined);
 assert.match(body.instructions,/Minha política personalizada/);assert.match(body.instructions,/RAM física/);assert.match(body.instructions,/Kits personalizados/);
 assert.throws(()=>validateSuggestion({action:'invalid'},input));
 assert.deepEqual(JSON.parse(body.input[0].content).offer.specifications,specifications);
 assert.throws(()=>validateSuggestion({...suggestion,productId:'kit'}, {...input,candidates:[]}));
});
