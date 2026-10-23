import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';

const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('icon behavior is restored on load, install/reload and Chrome startup without backend access',async()=>{
 const f=fixture({auth:undefined}),calls=[];let mode;
 const get=f.browser.storage.local.get,set=f.browser.storage.local.set;
 f.browser.storage.local.get=async key=>key==='displayMode'?{displayMode:mode}:get(key);
 f.browser.storage.local.set=async value=>{if('displayMode' in value)mode=value.displayMode;return set(value);};
 f.browser.sidePanel.setOptions=async value=>calls.push(['options',value]);
 f.browser.sidePanel.setPanelBehavior=async value=>calls.push(['behavior',value]);
 f.browser.action.setPopup=async value=>calls.push(['popup',value]);
 globalThis.chrome=f.browser;
 await import('../dist/background.js');await settled();
 assert.deepEqual(calls,[['options',{enabled:true}],['popup',{popup:''}],['behavior',{openPanelOnActionClick:true}]]);
 calls.length=0;mode='popup';f.listeners.installed();await settled();
 assert.ok(calls.some(([kind,value])=>kind==='popup'&&value.popup==='popup.html'));
 assert.deepEqual(calls.at(-1),['behavior',{openPanelOnActionClick:false}]);
 calls.length=0;mode='panel';f.listeners.startup();await settled();
 assert.deepEqual(calls.at(-1),['behavior',{openPanelOnActionClick:true}]);
 calls.length=0;mode='popup';await import('../dist/background.js?worker-restart');await settled();
 assert.deepEqual(calls.at(-1),['behavior',{openPanelOnActionClick:false}]);
});
