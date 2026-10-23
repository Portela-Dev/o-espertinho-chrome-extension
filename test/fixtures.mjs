import {CatalogRuntime} from '../dist/catalog-runtime.js';
export const account = {
  id: "admin",
  email: "admin@example.test",
  name: "Admin",
  permissions: ["affiliate_links"],
};
export const auth = {
  token: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 900000,
  user: account,
};
export const recipe = {
  id: "demo",
  name: "Demo",
  loginUrl: "https://shop.test/login",
  allowedOrigins: ["https://shop.test"],
  affiliateOrigins: ["https://shop.test"],
  batchSize: 2,
  intervalMs: 100,
  steps: [
    {
      type: "request",
      url: "https://shop.test/convert",
      method: "POST",
      responsePath: "link",
    },
  ],
};
export const configuration = { version: 1, marketplaces: [recipe] };
export function fixture(initial={}){
 let saved={backendUrl:'http://localhost:3000',auth:structuredClone(auth),...initial};const listeners={},values={};
 const browser={
  sidePanel:{setOptions:async()=>{},setPanelBehavior:async()=>{}},action:{setPopup:async()=>{}},
  webRequest:{onBeforeSendHeaders:{addListener:fn=>{listeners.requestHeaders=fn;}}},
  storage:{session:{setAccessLevel:async()=>{},get:async key=>({[key]:structuredClone(values[key])}),set:async v=>Object.assign(values,structuredClone(v)),remove:async key=>{delete values[key];}},local:{setAccessLevel:async()=>{},get:async()=>({state:structuredClone(saved)}),set:async({state})=>{if(state!==undefined)saved=structuredClone(state);}}},
  runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'}),onMessage:{addListener:fn=>{listeners.message=fn;}},onStartup:{addListener:fn=>{listeners.startup=fn;}},onInstalled:{addListener:fn=>{listeners.installed=fn;}}},
  alarms:{create:async()=>{},onAlarm:{addListener:fn=>{listeners.alarm=fn;}}},
 };
 return {browser,listeners,saved:()=>saved,runtime:new CatalogRuntime(browser)};
}
