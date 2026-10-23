import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RequestHeaderMemory} from '../dist/request-header-memory.js';
import {fixture,recipe as baseRecipe} from './fixtures.mjs';
const recipe={...baseRecipe,steps:[{type:'extract',name:'csrf',source:'requestHeader',key:'x-csrf-token',sourceUrl:'https://shop.test/convert'},{type:'request',url:'https://shop.test/convert',method:'POST',headers:{'X-CSRF-Token':'{{csrf}}'},responsePath:'short_url'}]};
const event={url:'https://shop.test/convert',tabId:1,initiator:'https://shop.test',requestHeaders:[{name:'Cookie',value:'PRIVATE-COOKIE'},{name:'Authorization',value:'PRIVATE-AUTH'},{name:'X-CSRF-Token',value:'PRIVATE-CSRF'}]};

test('header csrf-token também fica restrito à aba, origem e nome declarados',async()=>{
 const f=fixture(),memory=new RequestHeaderMemory(f.browser),csrfRecipe=structuredClone(recipe);csrfRecipe.steps[0].key='csrf-token';
 await memory.arm(csrfRecipe,1);await memory.observe({...event,requestHeaders:[...event.requestHeaders,{name:'csrf-token',value:'PRIVATE-CSRF-ONLY'}]});
 assert.deepEqual(await memory.values(csrfRecipe),{csrf:'PRIVATE-CSRF-ONLY'});assert.equal(JSON.stringify(f.saved()).includes('PRIVATE'),false);
 csrfRecipe.steps[0].key='Authorization';await assert.rejects(memory.arm(csrfRecipe,1));
});
test('only the configured X header from the prepared tab is held in session memory',async()=>{
 const f=fixture(),memory=new RequestHeaderMemory(f.browser);await memory.arm(recipe,1);
 for(const bad of [{...event,tabId:2},{...event,url:'https://foreign.test/convert'},{...event,initiator:'https://foreign.test'}]){await memory.observe(bad);assert.equal(await memory.ready(recipe),false);}
 await memory.observe(event);assert.deepEqual(await memory.values(recipe),{csrf:'PRIVATE-CSRF'});assert.equal(JSON.stringify(f.saved()).includes('PRIVATE'),false);
 const stored=JSON.stringify(await f.browser.storage.session.get('affiliateRequestHeaders'));assert.ok(stored.includes('PRIVATE-CSRF'));assert.equal(stored.includes('PRIVATE-COOKIE'),false);assert.equal(stored.includes('PRIVATE-AUTH'),false);
 await memory.clear();assert.equal(await memory.ready(recipe),false);
});
