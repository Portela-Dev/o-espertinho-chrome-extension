import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign} from 'node:crypto';
import {AiController,DIRECT_CALLBACK} from '../dist/ai-controller.js';import {AiSessionBroker} from '../dist/ai-session-broker.js';import {AiVault} from '../dist/ai-vault.js';
test('controlador restaura conta/modelo sem nova autorização e desconexão sobrevive recriação sem vazar credenciais ao backend',async()=>{
 const saved={},messages=[],backend=[],tabs=[],keys=generateKeyPairSync('rsa',{modulusLength:2048}),key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);let nonce='',modelRemoved=false;
 const browser={storage:{local:{setAccessLevel:async()=>{},get:async id=>({[id]:saved[id]}),set:async v=>Object.assign(saved,v)}},permissions:{request:async()=>true},webRequest:{onBeforeRequest:{addListener(){},removeListener(){}}},tabs:{onRemoved:{addListener(){},removeListener(){}},create:async()=>({id:7}),update:async(_id,data)=>{tabs.push(data);nonce=new URL(data.url).searchParams.get('nonce');},remove:async()=>{}},runtime:{sendMessage:async message=>{messages.push(message);if(message.type==='STATE'){backend.push(message);return {value:{user:{permissions:['affiliate_links']}}};}try{return {value:await broker.handle(message.operation,message.payload)};}catch(e){return {error:e.message};}}}};
 const fetcher=async(url,options={})=>{
  if(url.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'});
  if(url.endsWith('/jwks'))return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256'}]});
  if(url.endsWith('/oauth/token')){const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),claims=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_restore',sub:'user',email:'restored@example.test',exp:Date.now()/1000+3600,nonce})).toString('base64url'),input=header+'.'+claims;return Response.json({id_token:input+'.'+sign('sha256',Buffer.from(input),keys.privateKey).toString('base64url'),access_token:'PRIVATE_RESTORE_ACCESS',refresh_token:'PRIVATE_RESTORE_REFRESH',token_type:'Bearer',scope:'openid chatgpt.tokens.use.direct',expires_in:3600});}
  if(url.endsWith('/models'))return Response.json({models:[{slug:'model-a',display_name:'Modelo A',visibility:'list'},...modelRemoved?[]:[{slug:'model-b',display_name:'Modelo B',visibility:'list'}]]});
  if(url.endsWith('/revoke'))return new Response('',{status:200});throw Error('Unexpected request');
 };
 const broker=new AiSessionBroker(async()=>{},new AiVault(browser,async()=>key),fetcher),original=globalThis.fetch;globalThis.fetch=fetcher;let app,restored,disconnected;
 try{
  app=await AiController.create(browser);await app.login();const url=new URL(tabs.at(-1).url);await app.receive({tabId:7,frameId:0,url:DIRECT_CALLBACK+'?'+new URLSearchParams({state:url.searchParams.get('state'),client_id:'oaiapp_restore',code:'test-code'})});
  assert.equal(app.status().connected,true);await app.models();await app.selectModel('model-b');app.dispose();
  restored=await AiController.create(browser);assert.equal(restored.status().account.email,'restored@example.test');assert.equal(restored.status().selectedModel,'model-b');assert.equal(tabs.length,1);assert.doesNotMatch(JSON.stringify(saved)+JSON.stringify(backend)+JSON.stringify(restored.status()),/PRIVATE_RESTORE|access_token|refresh_token|id_token|test-code/);
  modelRemoved=true;await restored.models();assert.equal(restored.status().selectedModel,'');
  await restored.logout();disconnected=await AiController.create(browser);assert.equal(disconnected.status().connected,false);assert.equal(disconnected.status().selectedModel,'');assert.equal(tabs.length,1);assert.equal(saved.directAiSessionV1.sealed,null);
  assert.ok(messages.some(m=>m.type==='AI_SESSION'&&m.operation==='install'));assert.ok(backend.every(m=>m.type==='STATE'));
 }finally{app?.dispose();restored?.dispose();disconnected?.dispose();globalThis.fetch=original;}
});
