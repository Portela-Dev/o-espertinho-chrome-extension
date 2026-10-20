import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryPolicy,failureKind} from '../dist/catalog-policy.js';
test('retries são finitos, respeitam backoff e preservam ação configurada',()=>{
 const config={failures:{timeout:{action:'skip_page',retries:2,delayMs:2000,backoffMultiplier:2}}};
 assert.deepEqual(discoveryPolicy(config,'timeout',0),{action:'skip_page',retry:true,delayMs:2000});
 assert.deepEqual(discoveryPolicy(config,'timeout',2),{action:'skip_page',retry:false,delayMs:8000});
 assert.equal(discoveryPolicy({},'navigation',0).retry,false);assert.equal(failureKind('incomplete'),'timeout');assert.equal(failureKind('invalidItem'),'invalidItem');
});
