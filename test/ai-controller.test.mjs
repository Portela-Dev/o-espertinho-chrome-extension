import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {AiController,DIRECT_CALLBACK} from '../dist/ai-controller.js';
import {OpenAISession} from '../dist/shared/openai-session.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
function fixture(){
 const saved={},calls=[],updates=[],messages=[],listeners={};let allowed=true,permitted=true;
 const event=name=>({addListener:fn=>listeners[name]=fn,removeListener:fn=>{if(listeners[name]===fn)delete listeners[name];}});
 const browser={permissions:{request:async()=>allowed},runtime:{getURL:path=>'chrome-extension://'+'a'.repeat(32)+'/'+path,sendMessage:async message=>{messages.push(message);return {value:{user:{permissions:permitted?['affiliate_links']:[]}}};}},storage:{local:{setAccessLevel:async()=>{},get:async key=>({[key]:saved[key]}),set:async v=>Object.assign(saved,v)},session:{setAccessLevel:async()=>{},set:async v=>Object.assign(saved,v),remove:async key=>delete saved[key]}},webRequest:{onBeforeRequest:event('request')},tabs:{onRemoved:event('removed'),create:async data=>{updates.push(data);return {id:77};},update:async(id,data)=>updates.push({id,...data}),remove:async id=>updates.push({removed:id}),query:async()=>[{id:20,url:'https://shop.test/p'}]},scripting:{executeScript:async()=>[{result:{title:'Produto',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'}}]}};
 let session;
 const fetcher=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'});
  if(url.endsWith('/jwks'))return Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256'}]});
  if(url.endsWith('/oauth/token')){
   const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url'),claims=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_direct',sub:'direct-user',email:'admin@example.test',nonce:session.nonceFixture,exp:Date.now()/1000+3600})).toString('base64url'),input=header+'.'+claims;
   return Response.json({id_token:input+'.'+sign('sha256',Buffer.from(input),privateKey).toString('base64url'),access_token:'DIRECT_PRIVATE_ACCESS',refresh_token:'DIRECT_PRIVATE_REFRESH',token_type:'Bearer',scope:'openid chatgpt.tokens.use.direct',expires_in:3600});
  }
  if(url.endsWith('/models'))return Response.json({models:[{visibility:'list',slug:'fixture',display_name:'Fixture'}]});
  if(url.endsWith('/revoke'))return new Response('',{status:200});
  if(url.endsWith('/responses'))return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({action:'needs_review',category:'Áudio',productId:null,product:null,reason:'Confira o modelo.'})}]}]}})+'\n\n');
  throw Error('Unexpected URL');
 };
 session=new OpenAISession({hostId:'urn:uuid:test',fetcher,saveRegistrations:async registrations=>{saved.registrations=registrations;}});
 const app=new AiController(session,browser);
 const login=async()=>{await app.login();session.nonceFixture=session.pending.nonce;return DIRECT_CALLBACK+'?'+new URLSearchParams({state:session.pending.state,code:'test-only-code',client_id:'oaiapp_direct'});};
 return {app,session,browser,saved,calls,messages,updates,listeners,login,deny:()=>{allowed=false;},denyAdmin:()=>{permitted=false;}};
}
test('login direto aceita somente aba, frame, callback e state próprios; nenhum token é persistido ou enviado ao backend',async()=>{
 const f=fixture();try{
  const callback=await f.login();assert.equal(f.app.status().phase,'waiting_for_login');
  const authUrl=new URL(f.updates.find(v=>v.url?.startsWith('https:')).url);assert.equal(authUrl.searchParams.get('redirect_uri'),DIRECT_CALLBACK);assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');
  for(const details of [{tabId:88,frameId:0,url:callback},{tabId:77,frameId:2,url:callback},{tabId:77,frameId:0,url:callback.replace('18766','18765')},{tabId:77,frameId:0,url:callback.replace('/auth/callback','/wrong')},{tabId:77,frameId:0,url:callback+'&state=duplicate'}])assert.equal(await f.app.receive(details),false);
  assert.equal(f.calls.length,0);assert.equal(await f.app.receive({tabId:77,frameId:0,url:callback}),true);assert.equal(f.app.status().connected,true);assert.equal(f.app.status().callbackObserved,true);assert.ok(f.updates.some(v=>v.removed===77));
  assert.equal(await f.app.receive({tabId:77,frameId:0,url:callback}),false);assert.equal((await f.app.models())[0].id,'fixture');
  await f.app.analyze({model:'fixture',offer:{title:'Produto'}});assert.equal(f.app.status().phase,'completed');assert.equal(f.app.status().result.action,'needs_review');
  assert.ok(f.calls.every(c=>/^https:\/\/(auth|api)\.openai\.com\//.test(c.url)));assert.ok(f.messages.every(m=>m.type==='STATE'));
  assert.doesNotMatch(JSON.stringify(f.saved)+JSON.stringify(f.app.status())+JSON.stringify(f.updates),/DIRECT_PRIVATE|access_token|refresh_token|id_token|test-only-code/);
  assert.equal((await f.app.logout()).revoked,true);assert.equal(f.app.status().connected,false);
 }finally{f.app.dispose();}
});
test('cancelar login invalida a tentativa e fechar a aba de login deixa erro controlado',async()=>{
 const f=fixture();try{
  const callback=await f.login();await f.app.cancelLogin();assert.equal(await f.app.receive({tabId:77,frameId:0,url:callback}),false);
  await f.login();f.listeners.removed(77);assert.match(f.app.status().error,/fechada/);assert.equal(f.session.pending,null);
  f.denyAdmin();await assert.rejects(()=>f.app.login(),/permissão/);
  f.deny();await assert.rejects(()=>f.app.login(),/Autorize/);
 }finally{f.app.dispose();assert.equal(f.listeners.request,undefined);}
});
test('create salva somente registro não secreto',async()=>{
 const f=fixture();f.app.dispose();
 const app=await AiController.create(f.browser);try{assert.match(f.saved.directAiRegistrationV1.hostId,/^urn:uuid:/);assert.equal(app.status().connected,false);assert.doesNotMatch(JSON.stringify(f.saved.directAiRegistrationV1),/token|verifier|nonce/);}finally{app.dispose();}
});

test('encerrar painel invalida login e fecha somente a aba de autorização criada pela sessão',async()=>{
 const f=fixture();const callback=await f.login();f.app.dispose();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.session.pending,null);assert.equal(f.session.active,null);assert.equal(f.listeners.request,undefined);assert.equal(f.listeners.removed,undefined);
 assert.deepEqual(f.updates.filter(v=>v.removed!==undefined),[{removed:77}]);assert.equal(await f.app.receive({tabId:77,frameId:0,url:callback}),false);
});
