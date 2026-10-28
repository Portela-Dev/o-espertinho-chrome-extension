import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogRuntime} from '../dist/catalog-runtime.js';
import {recipe,auth} from './fixtures.mjs';
function fixture(options={}){
 let saved={backendUrl:'http://localhost:3000',auth,proofTest:{secret:'obsolete'},progress:{status:'running'}};let run;
 const calls=[],navigations=[],settings={intervalMs:100,timeoutMs:1000,humanTimeoutMs:60000,blockRules:[],recipe:{...recipe,allowedOrigins:['https://shop.example.com'],affiliateOrigins:['https://shop.example.com'],loginUrl:'https://shop.example.com'}},market={id:'shop',name:'Shop',catalog_executor:'extension',website_url:'https://shop.example.com',allowedOrigins:['https://shop.example.com'],config:settings};
 const browser={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'})},storage:{local:{setAccessLevel:async()=>{},get:async()=>({state:saved}),set:async({state})=>{saved=structuredClone(state);}},session:{get:async()=>({}),setAccessLevel:async()=>{},set:async()=>{},remove:async()=>{}}},alarms:{create:async()=>{}},permissions:{contains:async()=>true},windows:{getLastFocused:async()=>({id:9,type:'normal'}),get:async id=>({id,type:'normal'}),update:async()=>{}},tabs:{get:async()=>({id:4,windowId:9,url:'https://shop.example.com',status:'complete'}),update:async(id,options)=>{if(options.url)navigations.push(options.url);},create:async options=>{navigations.push(options.url);return {id:4,windowId:9};}},scripting:{executeScript:async call=>[{result:call.func.name==='checkPageState'?(options.blocked?.()??null):(options.result??{affiliateUrl:'https://shop.example.com/p?affiliate=1'})}]}};
 const fetch=async(url,requestOptions)=>{const path=new URL(url).pathname.replace('/api/extension','');const body=requestOptions.body?JSON.parse(requestOptions.body):undefined;calls.push({path,body});
  if(path==='/catalog/stats')return Response.json({marketplaceId:new URL(url).searchParams.get('marketplaceId'),retryFailed:new URL(url).searchParams.get('retryFailed')==='true',convert:{pending:3,completed:2,total:5},enrich:{pending:2,completed:1,total:5},prices:{pending:1,total:4},observedAt:new Date().toISOString()});
  if(path==='/catalog/config')return Response.json({marketplaces:[market]});
  if(path==='/catalog/runs'){run={id:'run',marketplace_id:'shop',status:'queued',step:body.step,total:1,completed:0,failed:0,snapshot:{market:{allowedHosts:['shop.example.com']},settings,profile:null}};return Response.json(run);}
  if(path.endsWith('/claim'))return Response.json({item:{id:'item',lease_token:'lease',payload:{url:'https://shop.example.com/p',originalUrl:'https://shop.example.com/p',...options.payload}},snapshot:run.snapshot,step:run.step});
  if(path.endsWith('/heartbeat'))return Response.json({ok:true});
  if(path.endsWith('/results')){run.status='completed';run.completed=1;return Response.json({accepted:true});}
  if(path.endsWith('/action')){run.status=body.action==='resume'?'running':body.action==='human'?'waiting_for_human':body.action==='cancel'?'cancelled':'paused_by_user';return Response.json(run);}
  if(path==='/catalog/runs/run')return Response.json(run);
  if(path==='/auth/logout')return Response.json({ok:true});
  throw Error('unexpected '+path);
 };
 return {runtime:new CatalogRuntime(browser,options.environments),browser,fetch,calls,navigations,saved:()=>saved};
}

const environments = [{id:'local',label:'Local',url:'http://localhost:3000'},{id:'production',label:'Produção',url:'https://production.example.test'}];
test('troca de ambiente revoga somente no servidor anterior, limpa dados e persiste a escolha',async()=>{
 const f=fixture({environments}),original=globalThis.fetch,traffic=[];
 globalThis.fetch=async(url,options)=>{traffic.push({url,authorization:options.headers.Authorization});return f.fetch(url,options);};
 try{
  await f.runtime.init();
  f.runtime.state.markets=[{id:'old'}];f.runtime.state.marketplaceId='old';f.runtime.state.tabId=4;
  f.runtime.state.pair={deviceCode:'old'};f.runtime.state.run={id:'old',status:'completed'};
  f.runtime.state.pendingResult={secret:'old'};f.runtime.state.claim={item:{id:'old'}};
  const view=await f.runtime.handle({type:'ENVIRONMENT',environmentId:'production'});
  assert.equal(view.backendUrl,environments[1].url);assert.equal(view.environmentId,'production');
  for(const key of ['auth','pair','claim','run','tabId','marketplaceId','pendingResult'])assert.equal(f.saved()[key],undefined,key);
  assert.deepEqual(view.markets,[]);assert.equal(view.user,undefined);assert.equal(view.stats,undefined);
  assert.deepEqual(traffic,[{url:'http://localhost:3000/api/extension/auth/logout',authorization:'Bearer '+auth.token}]);
  const restarted=new CatalogRuntime(f.browser,environments);await restarted.init();
  assert.equal(restarted.state.environmentId,'production');assert.equal(restarted.state.backendUrl,environments[1].url);
  await assert.rejects(restarted.handle({type:'REFRESH'}),/Entre/);
  await assert.rejects(restarted.handle({type:'AI_REVIEW',environmentUrl:environments[0].url,operation:'result',payload:{}}),/ambiente mudou/);
 }finally{globalThis.fetch=original;}
});
test('troca recusa ambiente arbitrário e execução ativa inclusive pausada',async()=>{
 const f=fixture({environments});await f.runtime.init();
 await assert.rejects(f.runtime.handle({type:'ENVIRONMENT',environmentId:'https://attacker.test'}),/configurado/);
 for(const status of ['queued','running','waiting_for_human','paused_technical','paused_by_user']){
  f.runtime.state.run={id:'active',status};
  await assert.rejects(f.runtime.handle({type:'ENVIRONMENT',environmentId:'production'}),/Conclua ou cancele/);
  assert.equal(f.saved().backendUrl,environments[0].url);
 }
});
test('servidor anterior offline não impede sair localmente nem transfere credenciais',async()=>{
 const f=fixture({environments}),original=globalThis.fetch,urls=[];
 globalThis.fetch=async url=>{urls.push(url);throw Error('offline');};
 try{await f.runtime.init();const view=await f.runtime.handle({type:'ENVIRONMENT',environmentId:'production'});
  assert.equal(view.backendUrl,environments[1].url);assert.equal(f.saved().auth,undefined);
  assert.match(view.message,/não confirmada/);assert.ok(urls.every(url=>url.startsWith(environments[0].url+'/')));
 }finally{globalThis.fetch=original;}
});
test('resposta atrasada do ambiente anterior é descartada após a troca',async()=>{
 const f=fixture({environments}),original=globalThis.fetch;let release;
 globalThis.fetch=async(url,options)=>url.endsWith('/late')?new Promise(resolve=>{release=()=>resolve(Response.json({old:true}));}):f.fetch(url,options);
 try{await f.runtime.init();const pending=f.runtime.request('/late');
  await f.runtime.handle({type:'ENVIRONMENT',environmentId:'production'});
  release();await assert.rejects(pending,/interrompida/);
  assert.equal(f.saved().backendUrl,environments[1].url);assert.equal(f.saved().auth,undefined);
 }finally{globalThis.fetch=original;}
});

test('HTTP 403 da conversão pausa por acesso negado com status local, sem repetir nem salvar resultado',async()=>{
 const f=fixture({result:{blocked:'access_denied',httpStatus:403}}),original=globalThis.fetch;globalThis.fetch=f.fetch;
 try{await f.runtime.init();await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step:'convert'});
 for(let i=0;i<800&&f.saved().run?.status!=='waiting_for_human';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.saved().run.status,'waiting_for_human');assert.match(f.saved().message,/HTTP 403.*access_denied/);assert.equal(f.calls.filter(c=>c.path.endsWith('/results')).length,0);assert.deepEqual(f.calls.find(c=>c.path.endsWith('/action')).body,{action:'human',reason:'access_denied'});
 }finally{globalThis.fetch=original;}
});

test('contexto MAIN é aplicado só à receita de conversão e não recebe credenciais do backend',async()=>{
 const f=fixture(),original=globalThis.fetch,baseFetch=f.fetch;let conversion;
 globalThis.fetch=async(url,options)=>{const response=await baseFetch(url,options);const data=await response.json();if(url.endsWith('/catalog/config'))data.marketplaces[0].config.recipe.executionWorld='MAIN';if(data.snapshot?.settings?.recipe)data.snapshot.settings.recipe.executionWorld='MAIN';return Response.json(data);};
 const execute=f.browser.scripting.executeScript;f.browser.scripting.executeScript=async call=>{if(call.func.name==='executeRecipe')conversion=call;else assert.equal(call.world,'ISOLATED');return execute(call);};
 try{await f.runtime.init();await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step:'convert'});await finished(f);assert.equal(conversion.world,'MAIN');assert.doesNotMatch(JSON.stringify(conversion.args),/refreshToken|TEST_ONLY|Bearer/);}finally{globalThis.fetch=original;}
});

test('atualizar configurações independe da execução salva; acompanhamento limpa somente referências locais de execução removida',async()=>{
 const f=fixture(),original=globalThis.fetch;let lookups=0;
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/catalog/runs/removed')){lookups++;return Response.json({error:'Execução não encontrada.'},{status:404});}
  return f.fetch(url,options);
 };
 try{
  await f.runtime.init();
  f.runtime.state.run={id:'removed',marketplace_id:'shop',step:'enrich',status:'running'};
  f.runtime.state.claim={item:{id:'old'}};f.runtime.state.pendingResult={itemId:'old'};f.runtime.state.nextAt=0;
  const view=await f.runtime.handle({type:'REFRESH'});
  assert.equal(lookups,0);assert.equal(view.markets[0].id,'shop');assert.equal(view.message,'Configurações atualizadas.');assert.equal(view.run.id,'removed');
  await f.runtime.pump();
  assert.equal(lookups,1);assert.equal(f.saved().run,undefined);assert.equal(f.saved().claim,undefined);assert.equal(f.saved().pendingResult,undefined);assert.equal(f.saved().nextAt,undefined);assert.equal(f.saved().locallyPaused,undefined);assert.ok(f.saved().auth);
  assert.match(f.saved().message,/iniciar uma nova execução/);assert.equal(f.calls.some(c=>c.path.endsWith('/results')||c.path.endsWith('/action')),false);
  f.runtime.state.run={id:'removed',status:'completed'};await f.runtime.pump();assert.equal(lookups,1);
 }finally{globalThis.fetch=original;}
});

for(const priorStatus of ['waiting_for_human','running'])test('reabrir aba fechada preserva execução e exige continuar: '+priorStatus,async()=>{
 let blocked='login';const f=fixture({blocked:()=>blocked}),original=globalThis.fetch;globalThis.fetch=f.fetch;
 try{
  await f.runtime.init();await f.runtime.handle({type:'REFRESH'});
  await f.runtime.handle({type:'START',marketplaceId:'shop',step:'enrich'});
  for(let i=0;i<800&&f.saved().run?.status!=='waiting_for_human';i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.saved().run.status,'waiting_for_human');
  f.runtime.state.run.status=priorStatus;
  const runId=f.saved().run.id;let exists=false,created=0;
  f.browser.tabs.get=async()=>{if(!exists)throw Error('No tab with id');return {id:7,windowId:12,status:'complete',url:'https://shop.example.com'};};
  f.browser.windows.getLastFocused=async()=>({id:12,type:'normal'});
  f.browser.tabs.create=async()=>{exists=true;created++;return {id:7,windowId:12};};
  await f.runtime.handle({type:'FOCUS'});
  assert.equal(created,1);assert.equal(f.saved().tabId,7);assert.equal(f.saved().windowId,12);
  assert.equal(f.saved().run.id,runId);assert.equal(f.saved().run.status,priorStatus==='running'?'paused_by_user':'waiting_for_human');
  assert.match(f.saved().message,/Continuar/);assert.equal(f.calls.some(c=>c.path.endsWith('/results')),false);
  await f.runtime.handle({type:'FOCUS'});assert.equal(created,1);
  exists=false;blocked=null;await f.runtime.handle({type:'RESUME'});await finished(f);
  assert.equal(created,2);
  assert.equal(f.calls.filter(c=>c.path==='/catalog/runs').length,1);
 }finally{globalThis.fetch=original;}
});

test('abrir aba sem execução cria uma aba própria e não inicia lote',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;
 try{
  await f.runtime.init();await f.runtime.handle({type:'REFRESH'});
  f.runtime.state.marketplaceId='shop';
  await f.runtime.handle({type:'FOCUS'});
  assert.equal(f.saved().tabId,4);assert.equal(f.saved().windowId,9);
  assert.equal(f.calls.some(c=>c.path==='/catalog/runs'),false);
 }finally{globalThis.fetch=original;}
});
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
  const data=f.calls.find(c=>c.path.endsWith('/results')).body;assert.deepEqual(data.links,['https://shop.example.com/p']);assert.equal(data.checkpoint.advance,false);assert.equal(data.data,undefined);
  for(const step of ['enrich','prices']){
   const g=fixture({payload:{url:'https://shop.example.com/affiliate',originalUrl:'https://shop.example.com/p'},result:{outcome:'success',data:{title:'Produto',priceCents:12000},sourceCategoryPath:['Tecnologia']}});globalThis.fetch=g.fetch;
   await g.runtime.init();await g.runtime.handle({type:'REFRESH'});await g.runtime.handle({type:'START',marketplaceId:'shop',step});await finished(g);
   const result=g.calls.find(c=>c.path.endsWith('/results')).body;assert.equal(result.data.priceCents,12000);assert.equal(result.affiliateUrl,undefined);assert.deepEqual(result.sourceCategoryPath,['Tecnologia']);assert.equal(g.navigations[0],'https://shop.example.com/p');
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
  await f.runtime.handle({type:'LOGOUT'});await assert.rejects(f.runtime.handle({type:'BACKEND',url:'http://localhost:4000'}),/Operação desconhecida/);assert.equal(f.saved().backendUrl,'http://localhost:3000');
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

test('contadores respeitam o filtro, usam cache e falha não encerra a sessão',async()=>{
 const f=fixture(),original=globalThis.fetch;let unavailable=false;
 globalThis.fetch=async(url,options)=>url.includes('/catalog/stats')&&unavailable?Response.json({error:'offline'},{status:503}):f.fetch(url,options);
 try{
  await f.runtime.handle({type:'REFRESH'});let view=await f.runtime.handle({type:'STATE'});assert.equal(view.stats.convert.pending,3);
  await f.runtime.handle({type:'STATE'});assert.equal(f.calls.filter(c=>c.path==='/catalog/stats').length,1);
  await f.runtime.handle({type:'FILTER',marketplaceId:'shop',retryFailed:true});view=await f.runtime.handle({type:'STATE'});assert.equal(view.stats.retryFailed,true);assert.equal(f.calls.filter(c=>c.path==='/catalog/stats').length,2);
  unavailable=true;view=await f.runtime.handle({type:'REFRESH'});assert.equal(view.stats,undefined);assert.match(view.statsError,/indisponíveis/);assert.ok(view.user);
  await f.runtime.handle({type:'LOGOUT'});view=await f.runtime.handle({type:'STATE'});assert.equal(view.stats,undefined);assert.equal(view.user,undefined);
 }finally{globalThis.fetch=original;}
});

for(const step of ['convert','enrich','prices'])test('iniciar '+step+' recria aba fechada automaticamente',async()=>{
 const f=fixture({result:{outcome:'success',data:{title:'Produto',priceCents:12000},affiliateUrl:'https://shop.example.com/affiliate'}}),original=globalThis.fetch;globalThis.fetch=f.fetch;
 try{
  await f.runtime.init();await f.runtime.handle({type:'REFRESH'});
  f.runtime.state.tabId=44;f.runtime.state.windowId=9;
  const get=f.browser.tabs.get;f.browser.tabs.get=async id=>{if(id===44)throw Error('No tab');return get(id);};
  await f.runtime.handle({type:'START',marketplaceId:'shop',step});await finished(f);
  assert.equal(f.saved().tabId,4);assert.equal(f.calls.some(c=>c.path.endsWith('/results')),true);
 }finally{globalThis.fetch=original;}
});

 test('backend do build substitui servidor antigo sem reutilizar credenciais ou execuções',async()=>{
 const f=fixture();f.browser.storage.local.get=async()=>({state:{version:2,backendUrl:'https://old.example.com',auth,markets:[{id:'old'}],run:{id:'old-run'},pair:{id:'old-pair'}}});
 await f.runtime.init();assert.equal(f.saved().backendUrl,'http://localhost:3000');assert.equal(f.saved().auth,undefined);assert.equal(f.saved().run,undefined);assert.equal(f.saved().pair,undefined);assert.deepEqual(f.saved().markets,[]);
 });

for(const step of ['enrich','prices'])test('interação de preço usa segunda fase isolada em '+step,async()=>{
 const f=fixture(),original=globalThis.fetch,calls=[];globalThis.fetch=f.fetch;
 f.browser.scripting.executeScript=async call=>{
  if(call.func.name==='checkPageState')return [{result:null}];
  calls.push(call);return [{result:call.args[0].revealPrice?{outcome:'success',data:{title:'Produto',priceCents:32100},sourceCategoryPath:[]}:{needsPriceReveal:true}}];
 };
 try{await f.runtime.init();await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step});await finished(f);
  assert.equal(calls.length,2);assert.equal(calls[0].args[0].revealPrice,undefined);assert.equal(calls[1].args[0].revealPrice,true);assert.ok(calls.every(call=>call.world==='ISOLATED'));
  assert.equal(f.calls.find(c=>c.path.endsWith('/results')).body.data.priceCents,32100);
 }finally{globalThis.fetch=original;}
});
for(const action of ['PAUSE','CANCEL'])test(action+' durante espera impede o clique pendente',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;let release,reveals=0;
 f.browser.scripting.executeScript=async call=>{
  if(call.func.name==='checkPageState')return [{result:null}];
  if(call.args[0].revealPrice){reveals++;return [{result:{outcome:'success'}}];}
  return new Promise(resolve=>{release=()=>resolve([{result:{needsPriceReveal:true}}]);});
 };
 try{await f.runtime.init();await f.runtime.handle({type:'REFRESH'});await f.runtime.handle({type:'START',marketplaceId:'shop',step:'prices'});
  for(let i=0;i<800&&!release;i++)await new Promise(r=>setTimeout(r,5));assert.equal(typeof release,'function');
  await f.runtime.handle({type:action});release();await new Promise(r=>setTimeout(r,20));
  assert.equal(reveals,0);assert.equal(f.calls.some(c=>c.path.endsWith('/results')),false);assert.equal(f.saved().run.status,action==='CANCEL'?'cancelled':'paused_by_user');
 }finally{globalThis.fetch=original;}
});
