import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureSession} from '../dist/session-proof.js';
import {fixture} from './fixtures.mjs';
const market={id:'generic',name:'Loja genérica',loginUrl:'https://shop.example.com',allowedOrigins:['https://shop.example.com','https://example.com'],cookieDomains:['shop.example.com','example.com'],testUrl:'https://shop.example.com/product'};
const cookie={name:'session',value:'PRIVATE-COOKIE',domain:'.example.com',path:'/account',httpOnly:true,secure:true,sameSite:'lax'};
function configure(f){f.browser.tabs.query=async()=>[{id:1,url:market.testUrl,incognito:false}];f.browser.cookies={getAll:async query=>{assert.ok(query.domain);assert.equal(query.url,undefined);return [cookie,{...cookie,name:'foreign',domain:'.foreign.com'},{...cookie,name:'expired',expirationDate:1},{...cookie,name:'partitioned',partitionKey:{topLevelSite:'https://example.com'}}];}};}
test('capture scopes cookies to registered domains, deduplicates, preserves HttpOnly and makes storage opt-in',async()=>{
 const f=fixture();configure(f);
 const captured=await captureSession(f.browser,market,false);assert.equal(captured.session.cookies.length,1);assert.equal(captured.session.cookies[0].value,cookie.value);assert.equal(captured.session.cookies[0].httpOnly,true);assert.equal(captured.session.cookies[0].expires,-1);assert.equal(captured.session.cookies[0].sameSite,'Lax');assert.deepEqual(captured.session.origins,[]);
 f.browser.scripting.executeScript=async options=>{assert.equal(options.world,'ISOLATED');return [{result:{origin:'https://shop.example.com',localStorage:[{name:'token',value:'PRIVATE-STORAGE'}]}}];};
 assert.equal((await captureSession(f.browser,market,true)).session.origins[0].localStorage[0].value,'PRIVATE-STORAGE');
 f.browser.tabs.query=async()=>[{id:1,url:'https://foreign.com'}];await assert.rejects(()=>captureSession(f.browser,market,false),/marketplace/);
 f.browser.tabs.query=async()=>[{id:1,url:market.testUrl,incognito:true}];await assert.rejects(()=>captureSession(f.browser,market,false),/aba normal/);
});
test('runtime requires consent and host/cookie permission; sends session only to authenticated proof endpoint',async()=>{
 const f=fixture({proofMarkets:[market]});configure(f);
 await assert.rejects(()=>f.runtime.handle({type:'PROOF_CAPTURE',marketplaceId:market.id,url:market.testUrl}),/Confirme/);
 f.controls.permission=false;await assert.rejects(()=>f.runtime.handle({type:'PROOF_CAPTURE',marketplaceId:market.id,url:market.testUrl,consent:true}),/Autorize/);f.controls.permission=true;
 f.controls.fetch=(path,body,options)=>{
  if(path==='/session-proof/tests'){assert.equal(body.session.cookies[0].value,'PRIVATE-COOKIE');assert.ok(options.headers.Authorization);return Response.json({id:'proof-id',status:'running',expiresAt:Date.now()+300000},{status:202});}
  if(path==='/session-proof/tests/proof-id')return Response.json({id:'proof-id',status:'completed',expiresAt:Date.now()+300000,result:{status:'technical_failure',reason:'incomplete',title:null,priceCents:null,finalUrl:'https://shop.example.com/login',navigationStatuses:[302,200],missing:['price'],cookiesImported:1,storageOriginsImported:0}});
  if(path==='/session-proof/marketplaces')return Response.json({marketplaces:[market]});
 };
 await f.runtime.handle({type:'PROOF_MARKETS'});const view=await f.runtime.handle({type:'PROOF_CAPTURE',marketplaceId:market.id,url:market.testUrl,consent:true});assert.equal(view.proofTest.status,'running');
 assert.equal(JSON.stringify([view,f.saved()]).includes('PRIVATE-COOKIE'),false);
 await assert.rejects(()=>f.runtime.handle({type:'PROOF_CAPTURE',marketplaceId:market.id,url:market.testUrl,consent:true}),/Aguarde/);
 await f.runtime.pump();assert.equal(f.saved().proofTest.status,'completed');
 await f.runtime.handle({type:'LOGOUT'});assert.equal(f.saved().proofTest,undefined);assert.equal(f.saved().proofMarkets,undefined);
});
