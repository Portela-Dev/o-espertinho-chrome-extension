import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {OpenAISession,verifyIdentity} from '../extension/shared/openai-session.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'}]};
const clientId='oaiapp_fixture',now=1800000000000;
const jwt=claims=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:clientId,sub:'user-fixture',email:'admin@example.test',exp:now/1000+3600,nonce:'nonce',...claims})).toString('base64url');return header+'.'+body+'.'+sign('sha256',Buffer.from(header+'.'+body),privateKey).toString('base64url');};
const metadata={issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'};
function fixture(){
 let current=now,refreshes=0;const requests=[],persisted=[];
 const session=new OpenAISession({hostId:'urn:uuid:fixture',now:()=>current,saveRegistrations:async rows=>{persisted.push(JSON.stringify(rows));},fetcher:async(url,options={})=>{
  requests.push({url,options});
  if(url.endsWith('openid-configuration'))return Response.json(metadata);
  if(url.endsWith('/jwks'))return Response.json(jwks);
  if(url.endsWith('/revoke'))return new Response('',{status:200});
  if(url.endsWith('/models'))return Response.json({models:[{visibility:'list',slug:'fixture-model',display_name:'Fixture'},{visibility:'hidden',slug:'hidden',display_name:'Hidden'}]});
  if(url.endsWith('/oauth/token')){
   const refreshing=options.body.get('grant_type')==='refresh_token';if(refreshing)refreshes++;
   return Response.json({access_token:refreshing?'renewed-private-token':'private-access-token',refresh_token:'private-refresh-token',id_token:jwt({nonce:session.pendingNonce}),token_type:'Bearer',expires_in:3600,scope:'openid chatgpt.tokens.use.direct'});
  }
  throw Error('Unexpected endpoint');
 }});
 const login=async()=>{const url=new URL(await session.begin('http://127.0.0.1:18765/auth/callback'));session.pendingNonce=url.searchParams.get('nonce');await session.callback(new URLSearchParams({state:url.searchParams.get('state'),client_id:clientId,code:'one-time-code'}));return url;};
 return {session,requests,persisted,login,advance:()=>{current+=3590000;},refreshes:()=>refreshes};
}
test('OAuth usa PKCE e nonce, valida assinatura e mantém tokens fora dos registros/status',async()=>{
 const f=fixture(),url=await f.login();assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));assert.ok(f.session.status().account.planEnabled);
 const exchange=f.requests.find(r=>r.url.endsWith('/oauth/token'));assert.equal(exchange.options.body.get('client_id'),clientId);assert.equal(exchange.options.body.get('redirect_uri'),'http://127.0.0.1:18765/auth/callback');assert.ok(exchange.options.body.get('code_verifier'));assert.equal(exchange.options.body.has('client_secret'),false);
 assert.doesNotMatch(JSON.stringify(f.session.status())+f.persisted.join(''),/private-access-token|private-refresh-token|id_token|access_token|refresh_token/);
 assert.equal((await f.session.models())[0].id,'fixture-model');assert.equal((await f.session.models()).length,1);
 f.advance();assert.deepEqual(await Promise.all([f.session.token(),f.session.token()]),['renewed-private-token','renewed-private-token']);assert.equal(f.refreshes(),1);
 assert.equal(new URL(await f.session.begin('http://127.0.0.1:18765/auth/callback',clientId)).searchParams.get('client_id'),clientId);
 assert.equal((await f.session.signout()).revoked,true);await assert.rejects(()=>f.session.token(),/Entre com ChatGPT/);
});
test('identidade rejeita audience, nonce, issuer, assinatura e expiração inválidos',async()=>{
 const options={jwks,issuer:metadata.issuer,clientId,nonce:'nonce',now};
 for(const claims of [{aud:'other'},{nonce:'other'},{iss:'https://evil.test'},{exp:1},{sub:''},{aud:[clientId,'other'],azp:'other'}])await assert.rejects(()=>verifyIdentity(jwt(claims),options),/não passou/);
 const valid=jwt({});await assert.rejects(()=>verifyIdentity(valid.slice(0,-8)+'AAAAAAAA',options),/não passou/);assert.equal((await verifyIdentity(valid,options)).subject,'user-fixture');
});
test('callback rejeita state falso, cancelamento e registro incompleto; escopo ausente bloqueia análise',async()=>{
 const f=fixture(),start=new URL(await f.session.begin('http://127.0.0.1:18765/auth/callback'));
 await assert.rejects(()=>f.session.callback(new URLSearchParams({state:'wrong'})),/inválido/);
 await assert.rejects(()=>f.session.callback(new URLSearchParams({state:start.searchParams.get('state'),error:'access_denied'})),/recusada/);
 const again=new URL(await f.session.begin('http://127.0.0.1:18765/auth/callback'));await assert.rejects(()=>f.session.callback(new URLSearchParams({state:again.searchParams.get('state'),code:'code'})),/incompleto/);
 await f.login();f.session.active.scope='openid';await assert.rejects(()=>f.session.token(),/não autorizou/);
 f.session.fetcher=async()=>{throw Error('offline')};assert.equal((await f.session.signout()).revoked,false);assert.equal(f.session.status().connected,false);
});
