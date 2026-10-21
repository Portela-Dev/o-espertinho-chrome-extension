import test from 'node:test';import assert from 'node:assert/strict';
import {AiVault,AI_VAULT_KEY,emptyAiSession} from '../dist/ai-vault.js';import {AiSessionBroker} from '../dist/ai-session-broker.js';
function fixture(){const saved={},messages=[];let clock=1700000000000,refreshes=0,mode='ok',pause;
 const browser={storage:{local:{setAccessLevel:async value=>messages.push(value),get:async key=>({[key]:structuredClone(saved[key])}),set:async value=>Object.assign(saved,structuredClone(value))}}};
 const key=crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const vault=()=>new AiVault(browser,()=>key);
 const fetcher=async(url,options={})=>{if(url.endsWith('/oauth/token')){refreshes++;if(pause)await pause;if(mode==='revoked')return Response.json({error:'invalid_grant'},{status:400});if(mode==='offline')throw Error('offline');return Response.json({access_token:'NEW_ACCESS_'+refreshes,refresh_token:'NEW_REFRESH_'+refreshes,token_type:'bearer',scope:'openid chatgpt.tokens.use.direct',expires_in:3600});}if(url.endsWith('/models')&&mode==='models-offline')throw Error('models unavailable');if(url.endsWith('/models'))return Response.json({models:[{slug:'model-a',display_name:'Modelo A',visibility:'list'},{slug:'model-b',display_name:'Modelo B',visibility:'list'}]});if(url.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/jwks',revocation_endpoint:'https://auth.openai.com/revoke'});if(url.endsWith('/revoke'))return new Response('',{status:200});throw Error('Unexpected request');};
 let permitted=true;const broker=()=>new AiSessionBroker(async()=>{if(!permitted)throw Error('Permission denied');},vault(),fetcher,()=>clock);
 const credentials={clientId:'oaiapp_test',subject:'user',email:'admin@example.test',access_token:'PRIVATE_ACCESS',refresh_token:'PRIVATE_REFRESH',scope:'openid chatgpt.tokens.use.direct',token_type:'Bearer',expires_in:3600,expiresAt:clock+3600000};
 return {saved,messages,vault,broker,credentials,advance:()=>clock+=3600000,get refreshes(){return refreshes;},mode:v=>mode=v,deny:()=>permitted=false,pause:p=>pause=p};
}
async function login(f,b){const s=await b.handle('snapshot');return b.handle('install',{revision:s.revision,credentials:f.credentials});}
test('cofre cifra credenciais com chave não exportável; conta/modelo sobrevivem recriação e renovação usa o token substituto',async()=>{
 const f=fixture(),b=f.broker(),s=await login(f,b);await b.handle('models',{sessionId:s.sessionId});await b.handle('selectModel',{sessionId:s.sessionId,model:'model-b'});
 const raw=JSON.stringify(f.saved);assert.doesNotMatch(raw,/PRIVATE_|access_token|refresh_token|admin@example/);assert.equal(f.saved[AI_VAULT_KEY].version,1);assert.ok(f.saved[AI_VAULT_KEY].sealed);assert.ok(f.messages.every(m=>m.accessLevel==='TRUSTED_CONTEXTS'));
 const restarted=f.broker(),state=await restarted.handle('snapshot');assert.equal(state.model,'model-b');assert.equal(state.account.email,'admin@example.test');assert.doesNotMatch(JSON.stringify(state),/PRIVATE_|access_token|refresh_token/);
 f.advance();const tokens=await Promise.all([restarted.handle('token',{sessionId:s.sessionId}),restarted.handle('token',{sessionId:s.sessionId})]);assert.equal(f.refreshes,1);assert.equal(tokens[0].accessToken,'NEW_ACCESS_1');assert.equal(tokens[1].accessToken,'NEW_ACCESS_1');assert.equal((await f.vault().load()).credentials.refresh_token,'NEW_REFRESH_1');
 assert.equal((await f.broker().handle('snapshot')).model,'model-b');
});
test('desconectar apaga credenciais/modelo e recusa callbacks e solicitações antigos, inclusive após recriar broker',async()=>{
 const f=fixture(),b=f.broker(),s=await login(f,b),before=await b.handle('snapshot');assert.equal((await b.handle('disconnect')).revoked,true);const result=await f.broker().handle('snapshot');assert.equal(result.account,null);assert.equal(result.model,'');assert.equal(f.saved[AI_VAULT_KEY].sealed,null);
 await assert.rejects(()=>b.handle('token',{sessionId:s.sessionId}),/encerrada/);await assert.rejects(()=>b.handle('install',{revision:before.revision,credentials:f.credentials}),/alterada/);
 assert.equal((await f.vault().load()).credentials,null);
});
test('revogação limpa sessão; falha transitória mantém credenciais; permissões e modelos inventados são recusados',async()=>{
 const f=fixture(),b=f.broker(),s=await login(f,b);await assert.rejects(()=>b.handle('selectModel',{sessionId:s.sessionId,model:'invented'}),/disponível/);f.advance();f.mode('offline');await assert.rejects(()=>b.handle('token',{sessionId:s.sessionId}));assert.ok((await b.handle('snapshot')).account);f.mode('revoked');await assert.rejects(()=>b.handle('token',{sessionId:s.sessionId}),/revogada/);assert.equal((await b.handle('snapshot')).account,null);
 f.deny();await assert.rejects(()=>login(f,b),/Permission/);await assert.rejects(()=>b.handle('snapshot',{credentials:'forbidden'}),/inválida/);
});
test('dados cifrados adulterados são descartados sem tentar usar credenciais',async()=>{
 const f=fixture(),b=f.broker();await login(f,b);f.saved[AI_VAULT_KEY].sealed='invalid';await assert.rejects(()=>f.vault().load(),/recuperada/);assert.equal((await f.vault().load()).credentials,null);
});

test('renovação é persistida mesmo se a consulta posterior de modelos falhar',async()=>{
 const f=fixture(),b=f.broker(),s=await login(f,b);f.advance();f.mode('models-offline');await assert.rejects(()=>b.handle('models',{sessionId:s.sessionId}));assert.equal((await f.vault().load()).credentials.refresh_token,'NEW_REFRESH_1');
 f.mode('ok');assert.equal((await f.broker().handle('token',{sessionId:s.sessionId})).accessToken,'NEW_ACCESS_1');assert.equal(f.refreshes,1);
});
