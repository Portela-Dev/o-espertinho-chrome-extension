import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {spawnSync} from 'node:child_process';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {chromium} from 'playwright';

test('Chromium real executa os quatro passos configuráveis em janela própria, sem sessão no backend', {skip:process.env.TEST_NATIVE_BROWSER!=='1',timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'espertinho-native-')),extension=join(directory,'extension');
 let context,server,marketServer;let marketOrigin,challenge=false;const received=[];let run,item;
 const discovery={rendering:{frameSelector:'',readySelector:'.card',timeoutMs:1000,settleDelayMs:0},extraction:{itemSelector:'.card',linkSelector:'a',linkAttribute:'href'},pagination:{mode:'next',nextSelector:'.next',disabledSelector:'',endSelector:'',missingNextAction:'finish',noProgressLimit:1,waitAfterMs:100},limits:{maxPages:2,maxItems:10,requestIntervalMs:100}};
 const recipe={id:'fixture',name:'Fixture',loginUrl:'https://shop.example.com/product',allowedOrigins:['https://shop.example.com'],affiliateOrigins:['https://shop.example.com'],batchSize:1,intervalMs:100,steps:[{type:'request',url:'https://shop.example.com/convert',method:'POST',body:{url:'{{originalUrl}}'},responsePath:'link'}]};
 const settings={intervalMs:100,timeoutMs:1000,humanTimeoutMs:60000,categorySeparator:'>',blockRules:[{kind:'challenge',match:'selector',value:'.human-check'}],recipe};
 const profile={rules:[{field:'title',selectors:['h1'],mode:'text',required:true},{field:'price',selectors:['.price'],mode:'text',required:true},{field:'category',selectors:['nav a'],mode:'text'}]};
 const snapshot={settings,profile,market:{allowedHosts:['shop.example.com'],normalizationRules:[]}};
 try{
  await cp(new URL('../dist/',import.meta.url),extension,{recursive:true});
  await writeFile(join(extension,'background.js'),(await readFile(join(extension,'background.js'),'utf8'))+'\nglobalThis.catalogTest=runtime;\n');
  const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://shop.example.com/*','http://localhost/*','http://127.0.0.1/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
  server=createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
   const path=req.url.split('?')[0].replace('/api/extension','');let data={};
   if(path==='/catalog/config')data={marketplaces:[{id:'fixture',name:'Fixture',catalog_executor:'extension',website_url:marketOrigin,allowedOrigins:[marketOrigin],config:settings}]};
   else if(path==='/catalog/runs'&&req.method==='POST'){
    run={id:crypto.randomUUID(),marketplace_id:'fixture',step:body.step,status:'queued',total:1,completed:0,failed:0,snapshot};
    item={id:crypto.randomUUID(),lease_token:crypto.randomUUID(),payload:{url:body.step==='discover'?marketOrigin+'/list':marketOrigin+'/product',originalUrl:marketOrigin+'/product',config:discovery}};data=run;
   }else if(path.endsWith('/claim'))data={item,snapshot,step:run.step};
   else if(path.endsWith('/heartbeat'))data={ok:true};
   else if(path.endsWith('/results')){received.push({step:run.step,...body});if(run.step==='discover'&&!body.done){item.payload.checkpoint=body.checkpoint;item.lease_token=crypto.randomUUID();run.status='running';}else{run.status='completed';run.completed=1;}data={accepted:true};}
   else if(path.endsWith('/action')){run.status=body.action==='resume'?'running':body.action==='human'?'waiting_for_human':'paused_technical';data=run;}
   else if(path.startsWith('/catalog/runs/'))data=run;
   res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const keyFile=join(directory,'key.pem'),certFile=join(directory,'cert.pem');
  const cert=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=shop.example.com'],{encoding:'utf8',windowsHide:true});assert.equal(cert.status,0,'OpenSSL deve estar disponível para o certificado descartável de teste.');
  marketServer=createHttpsServer({key:await readFile(keyFile),cert:await readFile(certFile)},(req,res)=>{
   const url=new URL(req.url,marketOrigin);
   if(url.pathname==='/convert'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({link:marketOrigin+'/product?affiliate=fixture'}));return;}
   const html=challenge?'<div class="human-check">Intervenção no ambiente de teste</div>':url.pathname.startsWith('/list')?'<div class="card"><a href="/product?ref=test">Product</a></div>'+(url.pathname==='/list'?'<a class="next" href="/list2">Next</a>':''):'<nav><a>Eletrônicos</a><a>Áudio</a></nav><h1>Produto controlado</h1><div class="price">R$ 123,45</div>';
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="pt-BR"><head><title>Fixture</title></head><body>'+html+'</body></html>');
  });await new Promise(r=>marketServer.listen(0,'127.0.0.1',r));marketOrigin='https://shop.example.com:'+marketServer.address().port;
  recipe.loginUrl=marketOrigin+'/product';recipe.allowedOrigins=[marketOrigin];recipe.affiliateOrigins=[marketOrigin];recipe.steps[0].url=marketOrigin+'/convert';snapshot.market.allowedHosts=['shop.example.com:'+marketServer.address().port];
  context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',headless:true,chromiumSandbox:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--host-resolver-rules=MAP shop.example.com 127.0.0.1','--ignore-certificate-errors']});
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const backendUrl='http://localhost:'+server.address().port;
  await worker.evaluate(async({backendUrl})=>{
   await globalThis.catalogTest.init();await chrome.storage.local.set({state:{version:2,backendUrl,auth:{token:'TEST_ONLY',refreshToken:'TEST_ONLY',expiresAt:Date.now()+900000,user:{id:'fixture',email:'fixture@example.com',permissions:['affiliate_links','discovery','catalog','updates']}},markets:[],message:''}});
   await globalThis.catalogTest.init();globalThis.catalogTest.state=(await chrome.storage.local.get('state')).state;await globalThis.catalogTest.handle({type:'REFRESH'});
  },{backendUrl});
  for(const step of ['discover','convert','enrich','prices']){
   await worker.evaluate(step=>globalThis.catalogTest.handle({type:'START',step,marketplaceId:'fixture'}),step);
   const deadline=Date.now()+15000;let status;
   while(Date.now()<deadline){status=await worker.evaluate(()=>globalThis.catalogTest.state.run.status);if(status==='completed')break;if(status.startsWith('paused')||status==='waiting_for_human')throw Error(JSON.stringify(await worker.evaluate(async()=>({message:globalThis.catalogTest.state.message,tabs:(await chrome.tabs.query({})).map(t=>({url:t.url,status:t.status,window:t.windowId}))}))));await new Promise(r=>setTimeout(r,100));}
   assert.equal(status,'completed',step);
  }
  const before=received.length;challenge=true;
  await worker.evaluate(()=>globalThis.catalogTest.handle({type:'START',step:'prices',marketplaceId:'fixture'}));
  for(let i=0;i<100;i++){if(await worker.evaluate(()=>globalThis.catalogTest.state.run.status)==='waiting_for_human')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.run.status),'waiting_for_human');assert.equal(received.length,before);
  await assert.rejects(worker.evaluate(()=>globalThis.catalogTest.handle({type:'RESUME'})),/intervenção/);
  // Only our controlled fixture is changed. No real login or CAPTCHA is solved by this test.
  challenge=false;await worker.evaluate(async()=>{await chrome.tabs.reload(globalThis.catalogTest.state.tabId);});await new Promise(r=>setTimeout(r,300));
  await worker.evaluate(()=>globalThis.catalogTest.handle({type:'RESUME'}));
  for(let i=0;i<100;i++){if(await worker.evaluate(()=>globalThis.catalogTest.state.run.status)==='completed')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.run.status),'completed');
  assert.equal(received.filter(r=>r.step==='discover').length,2);
  assert.ok(received.some(r=>r.step==='convert'&&r.affiliateUrl.includes('affiliate=fixture')));
  assert.equal(received.find(r=>r.step==='enrich').data.priceCents,12345);
  assert.deepEqual(received.find(r=>r.step==='enrich').sourceCategoryPath,['Eletrônicos','Áudio']);
  assert.equal(received.find(r=>r.step==='prices').data.priceCents,12345);
  assert.doesNotMatch(JSON.stringify(received),/TEST_ONLY|cookies|refreshToken/);
 }finally{
  await context?.close();if(server)await new Promise(r=>server.close(r));if(marketServer)await new Promise(r=>marketServer.close(r));
  if(relative(resolve(tmpdir()),resolve(directory)).startsWith('..'))throw Error('Diretório de teste inválido.');
  await rm(directory,{recursive:true,force:true});
 }
});
