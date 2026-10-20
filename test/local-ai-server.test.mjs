import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createLocalServer} from '../local-ai/server.mjs';
const origin='chrome-extension://'+'a'.repeat(32);
test('auxiliar só aceita loopback, extensão vinculada e chave; nenhuma credencial sai no protocolo',async()=>{
 const session={status:()=>({account:{planEnabled:true},connected:true}),begin:()=> 'https://auth.openai.com/api/accounts/authorize?state=fixture',signout:async()=>({revoked:true}),models:async()=>[{id:'fixture'}],callback:async()=>{}};
 let finish;const local=createLocalServer({session,port:0,pairCode:'test-only-pair',analysis:async()=>new Promise(resolve=>{finish=resolve;})});const address=await local.listen(),base='http://127.0.0.1:'+address.port;
 const call=(path,data={},key='',extra={})=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(key?{'X-Espertinho-Local':key}:{}),...extra},body:JSON.stringify(data)});
 try{
  assert.equal((await call('/status')).status,401);assert.equal((await call('/pair',{code:'bad'})).status,400);
  assert.equal((await call('/pair',{code:'test-only-pair'},'',{Origin:'https://evil.test'})).status,403);
  const invalidHost=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/status',{method:'POST',headers:{Host:'evil.test',Origin:origin,'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});assert.equal(invalidHost,403);
  const paired=await (await call('/pair',{code:'test-only-pair'})).json();assert.ok(paired.key);
  assert.equal((await call('/status',{},paired.key,{Origin:'chrome-extension://'+'b'.repeat(32)})).status,403);
  assert.equal((await call('/status',{},paired.key)).status,200);
  const started=await call('/analyze',{offer:{title:'X'}},paired.key);assert.equal(started.status,202);assert.equal((await call('/analyze',{},paired.key)).status,400);
  finish({action:'needs_review',reason:'fixture'});await new Promise(r=>setImmediate(r));
  const status=await (await call('/status',{},paired.key)).json();assert.equal(status.analysis.status,'completed');assert.doesNotMatch(JSON.stringify(status),/access_token|refresh_token|id_token/);
  assert.equal((await call('/unknown',{},paired.key)).status,404);assert.equal((await call('/cancel',{},paired.key)).status,200);assert.equal((await call('/logout',{},paired.key)).status,200);
  const preflight=await fetch(base+'/status',{method:'OPTIONS',headers:{Origin:origin}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await fetch(base+'/status',{headers:{Origin:origin}})).status,405);
  assert.equal((await fetch(base+'/auth/callback?state=fixture')).status,200);
 }finally{await local.close();}
});
