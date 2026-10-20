import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogRuntime} from '../dist/catalog-runtime.js';
import {recipe,auth} from './fixtures.mjs';
function fixture(){
 let saved={backendUrl:'http://localhost:3000',auth,proofTest:{secret:'obsolete'},progress:{status:'running'}};let run;
 const calls=[],settings={intervalMs:100,timeoutMs:1000,humanTimeoutMs:60000,blockRules:[],recipe:{...recipe,allowedOrigins:['https://shop.example.com'],affiliateOrigins:['https://shop.example.com'],loginUrl:'https://shop.example.com'}},market={id:'shop',name:'Shop',catalog_executor:'extension',website_url:'https://shop.example.com',allowedOrigins:['https://shop.example.com'],config:settings};
 const browser={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'})},storage:{local:{setAccessLevel:async()=>{},get:async()=>({state:saved}),set:async({state})=>{saved=structuredClone(state);}},session:{get:async()=>({}),setAccessLevel:async()=>{},set:async()=>{},remove:async()=>{}}},alarms:{create:async()=>{}},permissions:{contains:async()=>true},windows:{create:async()=>({id:9,tabs:[{id:4,windowId:9}]}),update:async()=>{}},tabs:{get:async()=>({id:4,windowId:9,url:'https://shop.example.com',status:'complete'}),update:async()=>{},create:async()=>({id:4})},scripting:{executeScript:async options=>[{result:options.func.name==='checkPageState'?null:{affiliateUrl:'https://shop.example.com/p?affiliate=1'}}]}};
 const fetch=async(url,options)=>{const path=new URL(url).pathname.replace('/api/extension','');const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});
  if(path==='/catalog/config')return Response.json({marketplaces:[market]});
  if(path==='/catalog/runs'){run={id:'run',status:'queued',step:body.step,total:1,completed:0,failed:0,snapshot:{market:{allowedHosts:['shop.example.com']},settings,profile:null}};return Response.json(run);}
  if(path.endsWith('/claim'))return Response.json({item:{id:'item',lease_token:'lease',payload:{url:'https://shop.example.com/p',originalUrl:'https://shop.example.com/p'}},snapshot:run.snapshot,step:run.step});
  if(path.endsWith('/heartbeat'))return Response.json({ok:true});
  if(path.endsWith('/results')){run.status='completed';run.completed=1;return Response.json({accepted:true});}
  if(path.endsWith('/action')){run.status=body.action==='cancel'?'cancelled':'paused_technical';return Response.json(run);}
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
