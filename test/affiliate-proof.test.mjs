import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RequestHeaderMemory} from '../dist/request-header-memory.js';
import {fixture,recipe as baseRecipe} from './fixtures.mjs';
const recipe={...baseRecipe,steps:[{type:'extract',name:'csrf',source:'requestHeader',key:'x-csrf-token',sourceUrl:'https://shop.test/convert'},{type:'request',url:'https://shop.test/convert',method:'POST',headers:{'X-CSRF-Token':'{{csrf}}'},responsePath:'short_url'}]};
const event={url:'https://shop.test/convert',tabId:1,initiator:'https://shop.test',requestHeaders:[{name:'Cookie',value:'PRIVATE-COOKIE'},{name:'Authorization',value:'PRIVATE-AUTH'},{name:'X-CSRF-Token',value:'PRIVATE-CSRF'}]};
test('only the configured X header from the prepared tab is held in session memory',async()=>{
 const f=fixture(),memory=new RequestHeaderMemory(f.browser);await memory.arm(recipe,1);
 for(const bad of [{...event,tabId:2},{...event,url:'https://foreign.test/convert'},{...event,initiator:'https://foreign.test'}]){await memory.observe(bad);assert.equal(await memory.ready(recipe),false);}
 await memory.observe(event);assert.deepEqual(await memory.values(recipe),{csrf:'PRIVATE-CSRF'});assert.equal(JSON.stringify(f.saved()).includes('PRIVATE'),false);
 const stored=JSON.stringify(await f.browser.storage.session.get('affiliateRequestHeaders'));assert.ok(stored.includes('PRIVATE-CSRF'));assert.equal(stored.includes('PRIVATE-COOKIE'),false);assert.equal(stored.includes('PRIVATE-AUTH'),false);
 await memory.clear();assert.equal(await memory.ready(recipe),false);
});
test('conversion proof sends only generated links, resumes locally and then requests the job',async()=>{
 const f=fixture(),items=[{id:'one',title:'One',originalUrl:'https://shop.test/product/one'},{id:'two',title:'Two',originalUrl:'https://shop.test/product/two'}];
 f.controls.fetch=(path,body)=>{
  if(path==='/affiliate-proof/config')return Response.json({version:1,mock:false,marketplaces:[recipe]});
  if(path==='/affiliate-proof/tests')return Response.json({id:'proof',expiresAt:Date.now()+1800000,recipe,items});
  if(path==='/affiliate-proof/tests/proof/results'){assert.equal(JSON.stringify(body).includes('PRIVATE'),false);assert.ok(body.results[0].affiliateUrl);return Response.json({accepted:1});}
  if(path==='/affiliate-proof/tests/proof/enrich')return Response.json({id:'run',status:'queued',total:2},{status:202});
  if(path==='/affiliate-proof/tests/proof')return Response.json({run:{id:'run',status:'completed',total:2},runItems:items.map(i=>({link_id:i.id,status:'completed'}))});
 };
 f.controls.execute=async options=>{assert.equal(options.args[2].csrf,'PRIVATE-CSRF');return [{result:{affiliateUrl:'https://shop.test/affiliate/'+options.args[1].id}}];};
 await f.runtime.handle({type:'AFFILIATE_LOAD'});await f.runtime.handle({type:'AFFILIATE_ARM',marketplaceId:recipe.id});await f.runtime.observeAffiliateHeaders(event);
 await f.runtime.handle({type:'AFFILIATE_START',marketplaceId:recipe.id});
 for(let i=0;i<30&&f.runtime.state.affiliateProof.results.length<1;i++)await new Promise(ok=>setTimeout(ok,2));
 f.runtime.state.affiliateProof.nextAt=0;await f.runtime.pump();
 assert.equal(f.runtime.state.affiliateProof.status,'converted');assert.equal(JSON.stringify(f.saved()).includes('PRIVATE'),false);
 await f.runtime.handle({type:'AFFILIATE_ENRICH'});await f.runtime.handle({type:'AFFILIATE_REFRESH'});assert.equal(f.runtime.state.affiliateProof.status,'complete');assert.equal(f.runtime.state.affiliateProof.runItems.length,2);
 await f.runtime.handle({type:'LOGOUT'});assert.equal((await f.browser.storage.session.get('affiliateRequestHeaders')).affiliateRequestHeaders,undefined);
});
