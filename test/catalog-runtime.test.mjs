import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogRuntime} from '../dist/catalog-runtime.js';
import {recipe,auth} from './fixtures.mjs';
function fixture(options={}){
 let saved={backendUrl:'http://localhost:3000',auth,proofTest:{secret:'obsolete'},progress:{status:'running'}};let run;
 const calls=[],settings={intervalMs:100,timeoutMs:1000,humanTimeoutMs:60000,blockRules:[],recipe:{...recipe,allowedOrigins:['https://shop.example.com'],affiliateOrigins:['https://shop.example.com'],loginUrl:'https://shop.example.com'}},market={id:'shop',name:'Shop',catalog_executor:'extension',website_url:'https://shop.example.com',allowedOrigins:['https://shop.example.com'],config:settings};
 const browser={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'})},storage:{local:{setAccessLevel:async()=>{},get:async()=>({state:saved}),set:async({state})=>{saved=structuredClone(state);}},session:{get:async()=>({}),setAccessLevel:async()=>{},set:async()=>{},remove:async()=>{}}},alarms:{create:async()=>{}},permissions:{contains:async()=>true},windows:{create:async()=>({id:9,tabs:[{id:4,windowId:9}]}),update:async()=>{}},tabs:{get:async()=>({id:4,windowId:9,url:'https://shop.example.com',status:'complete'}),update:async()=>{},create:async()=>({id:4})},scripting:{executeScript:async call=>[{result:call.func.name==='checkPageState'?(options.blocked?.()??null):(options.result??{affiliateUrl:'https://shop.example.com/p?affiliate=1'})}]}};
 const fetch=async(url,requestOptions)=>{const path=new URL(url).pathname.replace('/api/extension','');const body=requestOptions.body?JSON.parse(requestOptions.body):undefined;calls.push({path,body});
  if(path==='/catalog/config')return Response.json({marketplaces:[market]});
  if(path==='/catalog/runs'){run={id:'run',status:'queued',step:body.step,total:1,completed:0,failed:0,snapshot:{market:{allowedHosts:['shop.example.com']},settings,profile:null}};return Response.json(run);}
  if(path.endsWith('/claim'))return Response.json({item:{id:'item',lease_token:'lease',payload:{url:'https://shop.example.com/p',originalUrl:'https://shop.example.com/p',...options.payload}},snapshot:run.snapshot,step:run.step});
  if(path.endsWith('/heartbeat'))return Response.json({ok:true});
  if(path.endsWith('/results')){run.status='completed';run.completed=1;return Response.json({accepted:true});}
  if(path.endsWith('/action')){run.status=body.action==='resume'?'running':body.action==='human'?'waiting_for_human':body.action==='cancel'?'cancelled':'paused_by_user';return Response.json(run);}
  if(path==='/catalog/runs/run')return Response.json(run);
  if(path==='/auth/logout')return Response.json({ok:true});
  throw Error('unexpected '+path);
 };
 return {runtime:new CatalogRuntime(browser),fetch,calls,saved:()=>saved};
}
test('migração de storage descarta POCs e preserva autenticação; conversão salva somente URL',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;
 try{await f.runtime.init();assert.equal(f.saved().version,2);assert.equal(f.saved().proofTest,undefined);assert.equal(f.saved().auth.token,auth.token);
  await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step:'convert'});
  for(let i=0;i<1000&&f.saved().run?.status!=='completed';i++)await new Promise(r=>setTimeout(r,5));
  const result=f.calls.find(c=>c.path.endsWith('/results'));assert.ok(result);assert.deepEqual(Object.keys(result.body).sort(),['affiliateUrl','itemId','leaseToken','outcome']);assert.equal(f.saved().run.status,'completed');
  const view=await f.runtime.handle({type:'STATE'});assert.equal(JSON.stringify(view).includes(auth.token),false);
 }finally{globalThis.fetch=original;}
});


test('falha de rede pausa localmente sem repetição e logout limpa a execução anterior',async()=>{
 const f=fixture(),original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('network unavailable');};
 try{
  await f.runtime.init();f.runtime.state.run={id:'run',status:'running',step:'prices',snapshot:{settings:{blockRules:[]}}};
  await f.runtime.pump();assert.equal(f.saved().locallyPaused,true);assert.equal(f.saved().run.status,'paused_technical');
  const count=requests;await f.runtime.pump();assert.equal(requests,count);
  globalThis.fetch=f.fetch;await f.runtime.handle({type:'LOGOUT'});assert.equal(f.saved().run,undefined);assert.equal(f.saved().auth,undefined);assert.equal(f.saved().locallyPaused,undefined);
 }finally{globalThis.fetch=original;}
});

async function finished(f){
 for(let i=0;i<1200&&f.saved().run?.status!=='completed';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.saved().run.status,'completed');
}
test('descoberta usa checkpoint e envia apenas URLs; extração e preço mantêm contratos independentes',async()=>{
 const original=globalThis.fetch;
 const config={rendering:{frameSelector:''},pagination:{mode:'single',noProgressLimit:1},limits:{maxPages:1,maxItems:10,requestIntervalMs:100},failures:{}};
 const f=fixture({payload:{config},result:{links:['https://shop.example.com/p?ref=one'],done:true,url:'https://shop.example.com/list'}});
 globalThis.fetch=f.fetch;
 try{
  await f.runtime.init();await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step:'discover'});await finished(f);
  const data=f.calls.find(c=>c.path.endsWith('/results')).body;assert.deepEqual(data.links,['https://shop.example.com/p?ref=one']);assert.equal(data.checkpoint.advance,false);assert.equal(data.data,undefined);
  for(const step of ['enrich','prices']){
   const g=fixture({result:{outcome:'success',data:{title:'Produto',priceCents:12000},sourceCategoryPath:['Tecnologia']}});globalThis.fetch=g.fetch;
   await g.runtime.init();await g.runtime.handle({type:'REFRESH'});await g.runtime.handle({type:'START',marketplaceId:'shop',step});await finished(g);
   const result=g.calls.find(c=>c.path.endsWith('/results')).body;assert.equal(result.data.priceCents,12000);assert.equal(result.affiliateUrl,undefined);assert.deepEqual(result.sourceCategoryPath,['Tecnologia']);
  }
 }finally{globalThis.fetch=original;}
});
test('bloqueio exige resolução e retomada explícitas na mesma execução; painel não confirma resultados',async()=>{
 let blocked='login';const f=fixture({blocked:()=>blocked}),original=globalThis.fetch;globalThis.fetch=f.fetch;
 try{
  await f.runtime.init();await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step:'convert'});
  for(let i=0;i<800&&f.saved().run?.status!=='waiting_for_human';i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.saved().run.status,'waiting_for_human');assert.equal(f.calls.some(c=>c.path.endsWith('/results')),false);
  await assert.rejects(f.runtime.handle({type:'RESUME'}),/intervenção/);
  blocked=null;await f.runtime.handle({type:'RESUME'});await finished(f);
  assert.equal(f.calls.filter(c=>c.path==='/catalog/runs').length,1);
  await f.runtime.handle({type:'LOGOUT'});await f.runtime.handle({type:'BACKEND',url:'http://localhost:4000'});assert.equal(f.saved().backendUrl,'http://localhost:4000');
 }finally{globalThis.fetch=original;}
});

test('chamadas simultâneas reutilizam uma única renovação do token de acesso',async()=>{
 const f=fixture(),original=globalThis.fetch;let refreshes=0;
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/auth/refresh')){refreshes++;return Response.json({...auth,token:'rotated-access-token'});}
  if(options.headers.Authorization==='Bearer '+auth.token)return Response.json({error:'expired'},{status:401});
  return f.fetch(url,options);
 };
 try{
  await f.runtime.init();await Promise.all([f.runtime.handle({type:'REFRESH'}),f.runtime.handle({type:'REFRESH'})]);
  assert.equal(refreshes,1);assert.equal(f.saved().auth.token,'rotated-access-token');
 }finally{globalThis.fetch=original;}
});
