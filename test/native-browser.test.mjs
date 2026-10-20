import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {chromium} from 'playwright';

test('Chromium real executa os quatro passos configuráveis em aba própria na mesma janela, sem sessão no backend', {skip:process.env.TEST_NATIVE_BROWSER!=='1',timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'espertinho-native-')),extension=join(directory,'extension');
 let context,server,marketServer;let marketOrigin,challenge=false;const received=[],visited=[];let run,item;
 const discovery={rendering:{frameSelector:'',readySelector:'.card',timeoutMs:1000,settleDelayMs:0},extraction:{itemSelector:'.card',linkSelector:'a',linkAttribute:'href'},pagination:{mode:'next',nextSelector:'.next',disabledSelector:'',endSelector:'',missingNextAction:'finish',noProgressLimit:1,waitAfterMs:100},limits:{maxPages:2,maxItems:10,requestIntervalMs:100}};
 const recipe={id:'fixture',name:'Fixture',loginUrl:'https://shop.example.com/product',allowedOrigins:['https://shop.example.com'],affiliateOrigins:['https://shop.example.com'],batchSize:1,intervalMs:100,steps:[{type:'extract',source:'dom',name:'csrf',selector:'meta[name="csrf-token"]',attribute:'content'},{type:'request',url:'https://shop.example.com/convert',method:'POST',headers:{'X-CSRF-Token':'{{csrf}}'},body:{url:'{{originalUrl}}'},responsePath:'link'}]};
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
   else if(path==='/catalog/stats')data={marketplaceId:'fixture',retryFailed:new URL(req.url,'http://localhost').searchParams.get('retryFailed')==='true',convert:{pending:0,completed:1,total:1},enrich:{pending:0,completed:1,total:1},prices:{pending:1,total:1},observedAt:new Date().toISOString()};
   else if(path==='/catalog/runs'&&req.method==='POST'){
    run={id:crypto.randomUUID(),marketplace_id:'fixture',step:body.step,status:'queued',total:1,completed:0,failed:0,snapshot};
    item={id:crypto.randomUUID(),lease_token:crypto.randomUUID(),payload:{url:body.step==='discover'?marketOrigin+'/list':['enrich','prices'].includes(body.step)?marketOrigin+'/affiliate-product':marketOrigin+'/product',originalUrl:marketOrigin+'/product',config:discovery}};data=run;
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
   if(['/product','/affiliate-product'].includes(url.pathname))visited.push({step:run?.step,path:url.pathname});
   if(url.pathname==='/convert'){
    if(req.headers['x-csrf-token']!=='TEST_ONLY_CSRF'){res.writeHead(403);res.end('{}');return;}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({link:marketOrigin+'/product?affiliate=fixture'}));return;
   }
   const html=challenge?'<div class="human-check">Intervenção no ambiente de teste</div>':url.pathname.startsWith('/list')?'<div class="card"><a href="'+(url.pathname==='/list'?'/product?ref=test':'/product2?ref=test')+'">Product</a></div>'+(url.pathname==='/list'?'<button class="next" onclick="location.href=&quot;/list2&quot;">Next</button>':''):(url.pathname==='/product'?'<nav><a>Eletrônicos</a><a>Áudio</a></nav>':'')+'<h1>Produto controlado</h1><div class="price">R$ 123,45</div>';
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="pt-BR"><head><title>Fixture</title><meta name="csrf-token" content="TEST_ONLY_CSRF"></head><body>'+html+'</body></html>');
  });await new Promise(r=>marketServer.listen(0,'127.0.0.1',r));marketOrigin='https://shop.example.com:'+marketServer.address().port;
  recipe.loginUrl=marketOrigin+'/product';recipe.allowedOrigins=[marketOrigin];recipe.affiliateOrigins=[marketOrigin];recipe.steps[1].url=marketOrigin+'/convert';snapshot.market.allowedHosts=['shop.example.com:'+marketServer.address().port];
  context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',headless:true,chromiumSandbox:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--host-resolver-rules=MAP shop.example.com 127.0.0.1','--ignore-certificate-errors']});
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const backendUrl='http://localhost:'+server.address().port;
  await worker.evaluate(async({backendUrl})=>{
   await globalThis.catalogTest.init();await chrome.storage.local.set({state:{version:2,backendUrl,auth:{token:'TEST_ONLY',refreshToken:'TEST_ONLY',expiresAt:Date.now()+900000,user:{id:'fixture',email:'fixture@example.com',permissions:['affiliate_links','discovery','catalog','updates']}},markets:[],message:''}});
   await globalThis.catalogTest.init();globalThis.catalogTest.state=(await chrome.storage.local.get('state')).state;await globalThis.catalogTest.handle({type:'REFRESH'});
  },{backendUrl});
  const owner=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});globalThis.catalogTest.state.hostWindowId=tabs[0].windowId;return {tabId:tabs[0].id,windowId:tabs[0].windowId,url:tabs[0].url,windows:(await chrome.windows.getAll()).length};});
  for(const step of ['discover','convert','enrich','prices']){
   await worker.evaluate(step=>globalThis.catalogTest.handle({type:'START',step,marketplaceId:'fixture'}),step);
   const deadline=Date.now()+15000;let status;
   while(Date.now()<deadline){status=await worker.evaluate(()=>globalThis.catalogTest.state.run.status);if(status==='completed')break;if(status.startsWith('paused')||status==='waiting_for_human')throw Error(JSON.stringify(await worker.evaluate(async()=>({message:globalThis.catalogTest.state.message,tabs:(await chrome.tabs.query({})).map(t=>({url:t.url,status:t.status,window:t.windowId}))}))));await new Promise(r=>setTimeout(r,100));}
   assert.equal(status,'completed',step);
   const current=await worker.evaluate(async owner=>({tab:await chrome.tabs.get(owner.tabId),windowId:globalThis.catalogTest.state.windowId,windows:(await chrome.windows.getAll()).length}),owner);
   assert.equal(current.windowId,owner.windowId);assert.equal(current.windows,owner.windows);assert.equal(current.tab.url,owner.url);
   if(step==='discover'){
    assert.equal(current.tab.active,false);
    assert.equal(await worker.evaluate(async()=> (await chrome.tabs.get(globalThis.catalogTest.state.tabId)).active),true);
    // After the initial focus, let the user return to their own tab. Later navigation must respect that choice.
    await worker.evaluate(async owner=>chrome.tabs.update(owner.tabId,{active:true}),owner);
   }else assert.equal(current.tab.active,true);
  }
  const before=received.length;challenge=true;
  await worker.evaluate(()=>globalThis.catalogTest.handle({type:'START',step:'prices',marketplaceId:'fixture'}));
  for(let i=0;i<100;i++){if(await worker.evaluate(()=>globalThis.catalogTest.state.run.status)==='waiting_for_human')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.run.status),'waiting_for_human');assert.equal(received.length,before);
  await assert.rejects(worker.evaluate(()=>globalThis.catalogTest.handle({type:'RESUME'})),/intervenção/);
  // Only our controlled fixture is changed. No real login or CAPTCHA is solved by this test.
  challenge=false;
  const previousTab=await worker.evaluate(()=>globalThis.catalogTest.state.tabId);
  const previousRun=await worker.evaluate(()=>globalThis.catalogTest.state.run.id);
  await worker.evaluate(async()=>{await chrome.tabs.remove(globalThis.catalogTest.state.tabId);});
  await worker.evaluate(()=>globalThis.catalogTest.handle({type:'FOCUS'}));
  assert.notEqual(await worker.evaluate(()=>globalThis.catalogTest.state.tabId),previousTab);
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.windowId),owner.windowId);
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.run.id),previousRun);
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.run.status),'waiting_for_human');
  assert.equal(received.length,before);
  await worker.evaluate(()=>globalThis.catalogTest.handle({type:'RESUME'}));
  for(let i=0;i<100;i++){if(await worker.evaluate(()=>globalThis.catalogTest.state.run.status)==='completed')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await worker.evaluate(()=>globalThis.catalogTest.state.run.status),'completed');
  assert.equal(received.filter(r=>r.step==='discover').length,2);
  assert.deepEqual(received.filter(r=>r.step==='discover').at(-1).links,[marketOrigin+'/product2?ref=test']);
  assert.ok(received.some(r=>r.step==='convert'&&r.affiliateUrl.includes('affiliate=fixture')));
  assert.equal(received.find(r=>r.step==='enrich').data.priceCents,12345);
  assert.deepEqual(received.find(r=>r.step==='enrich').sourceCategoryPath,['Eletrônicos','Áudio']);
  assert.ok(visited.some(v=>v.step==='enrich'&&v.path==='/product'));assert.equal(visited.some(v=>v.step==='enrich'&&v.path==='/affiliate-product'),false);
  assert.ok(visited.some(v=>v.step==='prices'&&v.path==='/affiliate-product'));
  assert.equal(received.find(r=>r.step==='prices').data.priceCents,12345);
  assert.doesNotMatch(JSON.stringify(received),/TEST_ONLY|cookies|refreshToken/);
  const panel=await context.newPage();await panel.setViewportSize({width:400,height:1000});
  await panel.goto(new URL('popup.html?view=panel',worker.url()).href);
  await panel.locator('#run-status').filter({hasText:'4 — Atualizar preços'}).waitFor();
  assert.equal(await panel.locator('#step-convert').textContent(),'2 — Gerar links de afiliados · Gerados: 1 / 1');
  assert.equal(await panel.locator('#step-enrich').textContent(),'3 — Extrair informações dos produtos · Extraídos: 1 / 1');
  assert.equal(await panel.locator('#step-prices').textContent(),'4 — Atualizar preços · Pendentes (24h): 1 / 1');
  assert.equal(await panel.locator('#display-mode').getAttribute('aria-label'),'Usar popup');
  assert.equal(await panel.locator('#display-icon-popup').isVisible(),true);
  assert.equal(await panel.locator('#display-icon-panel').isVisible(),false);
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mkdir('reports',{recursive:true});
  await panel.screenshot({path:'reports/catalog-panel.png',fullPage:true});
  await panel.locator('#refresh').click();
  await panel.locator('#success').filter({hasText:'Configurações atualizadas.'}).waitFor();
  await panel.locator('#limit').fill('0');await panel.locator('#step-discover').click();
  await panel.locator('#error').filter({hasText:'Informe um limite entre 1 e 10000.'}).waitFor();
  const toast=await panel.locator('#notification').evaluate(node=>({position:getComputedStyle(node).position,bottom:innerHeight-node.getBoundingClientRect().bottom}));
  assert.equal(toast.position,'fixed');assert.equal(toast.bottom,16);
  await panel.emulateMedia({colorScheme:'dark'});await panel.screenshot({path:'reports/catalog-error-toast.png'});
  await panel.locator('#dismiss-notification').click();assert.equal(await panel.locator('#notification').isVisible(),false);
 }finally{
  await context?.close();if(server)await new Promise(r=>server.close(r));if(marketServer)await new Promise(r=>marketServer.close(r));
  if(relative(resolve(tmpdir()),resolve(directory)).startsWith('..'))throw Error('Diretório de teste inválido.');
  await rm(directory,{recursive:true,force:true});
 }
});
