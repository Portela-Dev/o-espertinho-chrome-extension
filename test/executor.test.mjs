import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../src/executor.ts',import.meta.url),'utf8');
const compiled=stripTypeScriptTypes(source).replace('export async function','async function')+'\nglobalThis.executeRecipe=executeRecipe;';
const recipe={id:'example',allowedOrigins:['https://shop.test'],affiliateOrigins:['https://shop.test'],steps:[{type:'extract',source:'dom',name:'csrf',selector:'meta',attribute:'content'},{type:'request',url:'https://shop.test/convert',method:'POST',headers:{'X-CSRF':'{{csrf}}'},body:{url:'{{originalUrl}}'},responsePath:'data.link'}]};
const item={id:'1',title:'Teste',originalUrl:'https://shop.test/product/1'};
function executor(fetch,element={getAttribute:()=> 'private-session-value'}){const context={Object,URL,URLSearchParams,AbortSignal,Event,location:{origin:'https://shop.test'},document:{querySelector:()=>element},fetch};vm.runInNewContext(compiled,context);return context.executeRecipe;}
test('receita genérica usa o token apenas na origem e devolve somente o link',async()=>{
 let sent;const execute=executor(async(url,options)=>{sent={url,options};return {ok:true,status:200,text:async()=>JSON.stringify({data:{link:'https://shop.test/affiliate/1'}})};});
 const result=await execute(recipe,item);assert.equal(result.affiliateUrl,'https://shop.test/affiliate/1');assert.equal(sent.options.headers['X-CSRF'],'private-session-value');assert.equal(sent.options.credentials,'include');assert.equal(JSON.stringify(result).includes('private-session-value'),false);
});
test('bloqueia envio de valores locais a outra origem e redirecionamentos',async()=>{
 let called=false;const execute=executor(async()=>{called=true;});const foreign=structuredClone(recipe);foreign.steps[1].url='https://other.test/convert';
 assert.ok((await execute(foreign,item)).error);assert.equal(called,false);
});
test('ausência de sessão ou HTTP 403 pausa o processamento para login',async()=>{
 const missing=await executor(()=>assert.fail('Não deveria chamar fetch'),null)(recipe,item);assert.equal(missing.needsLogin,true);
 const denied=await executor(async()=>({status:403}))(recipe,item);assert.equal(denied.needsLogin,true);
});
test('resposta inválida não expõe payload nem tokens no erro',async()=>{
 const result=await executor(async()=>({ok:true,status:200,text:async()=>JSON.stringify({data:{link:'javascript:private-session-value'}})}))(recipe,item);assert.ok(result.error);assert.equal(JSON.stringify(result).includes('private-session-value'),false);
});
