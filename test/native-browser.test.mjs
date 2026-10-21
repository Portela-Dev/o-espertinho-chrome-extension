import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {chromium} from 'playwright';
import {discoverPage} from '../dist/catalog-discovery.js';
import {generateKeyPairSync,sign} from 'node:crypto';
import {DIRECT_CALLBACK} from '../dist/ai-controller.js';

test('Chromium real executa os quatro passos configuráveis em aba própria na mesma janela, sem sessão no backend', {skip:process.env.TEST_NATIVE_BROWSER!=='1',timeout:90000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'espertinho-native-')),extension=join(directory,'extension');
 let context,server,marketServer;let marketOrigin,challenge=false;const received=[],visited=[],backendTraffic=[],aiSuggestions=[];let run,item,nativeDraft;const categoryId='65278c77-deee-463e-9ed2-d24362461234',draftId='65278c77-deee-463e-9ed2-d24362461235';
 const discovery={rendering:{frameSelector:'',readySelector:'.card',timeoutMs:1000,settleDelayMs:0},extraction:{itemSelector:'.card',linkSelector:'a',linkAttribute:'href'},pagination:{mode:'next',nextSelector:'.next',disabledSelector:'',endSelector:'',missingNextAction:'finish',noProgressLimit:1,waitAfterMs:100},limits:{maxPages:2,maxItems:10,requestIntervalMs:100}};
 const recipe={id:'fixture',name:'Fixture',loginUrl:'https://shop.example.com/product',allowedOrigins:['https://shop.example.com'],affiliateOrigins:['https://shop.example.com'],batchSize:1,intervalMs:100,steps:[{type:'extract',source:'dom',name:'csrf',selector:'meta[name="csrf-token"]',attribute:'content'},{type:'request',url:'https://shop.example.com/convert',method:'POST',headers:{'X-CSRF-Token':'{{csrf}}'},body:{url:'{{originalUrl}}'},responsePath:'link'}]};
 const settings={intervalMs:100,timeoutMs:1000,humanTimeoutMs:60000,categorySeparator:'>',blockRules:[{kind:'challenge',match:'selector',value:'.human-check'}],recipe};
 const profile={rules:[{field:'title',selectors:['h1'],mode:'text',required:true},{field:'price',selectors:['.price'],mode:'text',required:true},{field:'category',selectors:['nav a'],mode:'text'}]};
 const snapshot={settings,profile,market:{allowedHosts:['shop.example.com'],normalizationRules:[]}};
 try{
  await cp(new URL('../dist/',import.meta.url),extension,{recursive:true});
  await writeFile(join(extension,'background.js'),(await readFile(join(extension,'background.js'),'utf8'))+'\nglobalThis.catalogTest=runtime;\n');
  const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://shop.example.com/*','http://localhost/*','http://127.0.0.1/*','https://auth.openai.com/*','https://api.openai.com/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
  server=createServer(async(req,res)=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
   backendTraffic.push({url:req.url,body,authorization:req.headers.authorization});
   const path=req.url.split('?')[0].replace('/api/extension','');let data={};
   if(path==='/catalog/config')data={marketplaces:[{id:'fixture',name:'Fixture',catalog_executor:'extension',website_url:marketOrigin,allowedOrigins:[marketOrigin],config:settings}]};
   else if(path==='/catalog/stats')data={marketplaceId:'fixture',retryFailed:new URL(req.url,'http://localhost').searchParams.get('retryFailed')==='true',convert:{pending:0,completed:1,total:1},enrich:{pending:0,completed:1,total:1},prices:{pending:1,total:1},observedAt:new Date().toISOString()};
   else if(path==='/catalog/ai/config')data={settings:{version:1,categoryEnabled:true,productEnabled:true},category:{completed:0,total:1},product:{completed:0,total:1}};
   else if(path==='/catalog/ai/inventory'){const kind=new URL(req.url,'http://localhost').searchParams.get('kind');data={revision:'1',nextCursor:null,items:kind==='categories'?[{id:categoryId,path:['Áudio']}]:kind==='drafts'&&nativeDraft?[nativeDraft]:[]};}
   else if(path==='/catalog/ai/queue')data={items:[{id:'test-link',title:'Oferta aguardando revisão'}]};
   else if(path==='/catalog/ai/context')data={requestId:crypto.randomUUID(),task:body.task,instructions:'Use a categoria Áudio',offer:{title:'Produto controlado',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'},categories:['Áudio'],products:[]};
   else if(path==='/catalog/ai/suggestions'){aiSuggestions.push(body);const category=body.suggestion.action==='use_category';nativeDraft={id:draftId,name:'Produto controlado',brand:'Marca',description:'Descrição',kind:'draft'};data={applied:true,outcome:category?'categorized':'drafted',inventory:{revision:'1',categories:[],products:[],drafts:category?[]:[nativeDraft],removeDraftIds:category?[draftId]:[]}};}
   else if(path==='/catalog/ai/release')data={ok:true};
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
   if(url.pathname==='/scroll-list'){
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end('<!doctype html><div class="card"><a href="/a">A</a></div><div id="space" style="height:2400px"></div><script>let added=false;addEventListener("scroll",()=>{if(!added&&scrollY+innerHeight>=document.scrollingElement.scrollHeight-2){added=true;document.body.insertAdjacentHTML("afterbegin",\'<div class="card"><a href="/b">B</a></div>\');document.getElementById("space").style.height="3600px";}});</script>');return;
   }
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
  const lazy=await context.newPage();await lazy.goto(marketOrigin+'/scroll-list');
  const scrolling={...discovery,pagination:{...discovery.pagination,mode:'scroll',scrollStrategy:'bottom',scrollContainerSelector:''}};
  const read=()=>lazy.evaluate(discoverPage,{config:scrolling,rules:[],action:'read',page:1});
  assert.equal((await read()).links.length,1);
  await lazy.evaluate(discoverPage,{config:scrolling,rules:[],action:'advance',page:2});
  await lazy.waitForFunction(()=>document.querySelectorAll('.card').length===2);
  let lazyResult=await read();assert.equal(lazyResult.links.length,2);assert.ok(lazyResult.scroll.position+lazyResult.scroll.viewport<lazyResult.scroll.height);
  await lazy.evaluate(discoverPage,{config:scrolling,rules:[],action:'advance',page:3});
  await lazy.waitForFunction(()=>scrollY+innerHeight>=document.scrollingElement.scrollHeight-2);
  lazyResult=await read();assert.ok(lazyResult.scroll.position+lazyResult.scroll.viewport>=lazyResult.scroll.height-2);await lazy.close();
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
  assert.deepEqual(received.filter(r=>r.step==='discover').at(-1).links,[marketOrigin+'/product2']);
  assert.ok(received.some(r=>r.step==='convert'&&r.affiliateUrl.includes('affiliate=fixture')));
  assert.equal(received.find(r=>r.step==='enrich').data.priceCents,12345);
  assert.deepEqual(received.find(r=>r.step==='enrich').sourceCategoryPath,['Eletrônicos','Áudio']);
  assert.ok(visited.some(v=>v.step==='enrich'&&v.path==='/product'));assert.equal(visited.some(v=>v.step==='enrich'&&v.path==='/affiliate-product'),false);
  assert.ok(visited.some(v=>v.step==='prices'&&v.path==='/affiliate-product'));
  assert.equal(received.find(r=>r.step==='prices').data.priceCents,12345);
  assert.doesNotMatch(JSON.stringify(received),/TEST_ONLY|cookies|refreshToken/);
  const panel=await context.newPage();await panel.setViewportSize({width:400,height:1000});
  await panel.goto(new URL('popup.html?view=panel',worker.url()).href);
  await panel.locator('#workspace').waitFor();
  assert.equal(await panel.locator('.card-collapse').count(),4);assert.equal(await panel.locator('.card-collapse[open]').count(),0);
  for(const body of await panel.locator('.card-collapse > .card-content').all())assert.equal(await body.isVisible(),false);
  await panel.screenshot({path:'reports/cards-collapsed.png',fullPage:true});
  await panel.locator('#workspace > details > summary').click();
  await panel.locator('#run-status').filter({hasText:'6 — Analisar Preços'}).waitFor();
  assert.equal(await panel.locator('#step-convert').textContent(),'2 — Gerar links de afiliados · Gerados: 1 / 1');
  assert.equal(await panel.locator('#step-enrich').textContent(),'3 — Extrair informações dos produtos · Extraídos: 1 / 1');
  assert.equal(await panel.locator('#step-prices').textContent(),'6 — Analisar Preços · Pendentes (24h): 1 / 1');
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
  // Official endpoints are simulated; the browser navigates to an unserved callback.
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});let directNonce='',responses=0;const directStages=[];
  const installAiRoutes=async context=>{await context.route('https://auth.openai.com/**',async route=>{
   const url=new URL(route.request().url());
   directStages.push(url.pathname);
   if(url.pathname==='/api/accounts/authorize'){
    directNonce=url.searchParams.get('nonce');
    await route.fulfill({status:302,headers:{location:DIRECT_CALLBACK+'?'+new URLSearchParams({state:url.searchParams.get('state'),code:'DIRECT_TEST_CODE',client_id:'oaiapp_native_direct'})}});return;
   }
   if(url.pathname==='/.well-known/openid-configuration'){await route.fulfill({json:{issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/.well-known/jwks.json',revocation_endpoint:'https://auth.openai.com/revoke'}});return;}
   if(url.pathname==='/.well-known/jwks.json'){await route.fulfill({json:{keys:[{...keys.publicKey.export({format:'jwk'}),kid:'direct-fixture',alg:'RS256'}]}});return;}
   if(url.pathname==='/api/accounts/oauth/token'){
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'direct-fixture'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_native_direct',sub:'native-direct-user',email:'direct@example.test',exp:Date.now()/1000+3600,nonce:directNonce})).toString('base64url'),input=header+'.'+body;
    await route.fulfill({json:{id_token:input+'.'+sign('sha256',Buffer.from(input),keys.privateKey).toString('base64url'),access_token:'DIRECT_NATIVE_PRIVATE_ACCESS',refresh_token:'DIRECT_NATIVE_PRIVATE_REFRESH',scope:'openid chatgpt.tokens.use.direct',token_type:'Bearer',expires_in:3600}});return;
   }
   if(url.pathname==='/revoke'){await route.fulfill({status:200,body:''});return;}
   await route.abort();
  });
  await context.route('https://api.openai.com/**',async route=>{
   const url=new URL(route.request().url());
   assert.equal(route.request().headers().authorization,'Bearer DIRECT_NATIVE_PRIVATE_ACCESS');
   if(url.pathname==='/v1/models'){await route.fulfill({json:{models:[{slug:'direct-fixture',display_name:'Modelo direto de teste',visibility:'list'}]}});return;}
   if(url.pathname==='/v1/responses'){
    responses++;const input=route.request().postDataJSON();assert.equal(input.store,false);assert.equal(input.stream,true);
    const task=JSON.parse(input.input[0].content).task;
    const decision=task==='category'?{action:'use_category',categoryId,category:'Áudio',productId:null,product:null,reason:'Categoria existente'}:task==='product'?{action:'create_new',category:'',categoryId:null,productId:null,product:{name:'Produto controlado',brand:'Marca',description:'Descrição'},reason:'Nova identidade'}:{action:'needs_review',category:'Áudio',categoryId:null,productId:null,product:null,reason:'Análise direta simulada sem auxiliar.'};
    await route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(decision)}]}]}})+'\n\n'});return;
   }
   await route.abort();
  });
  };await installAiRoutes(context);
  let direct=panel;const pagesBefore=context.pages().length;await direct.locator('#account-card > details > summary').click();
  await direct.locator('#direct-login').click();
  try{await direct.getByRole('button',{name:'Desconectar IA',exact:true}).waitFor({timeout:20000});}
  catch{throw Error(JSON.stringify({phase:await direct.locator('#direct-status').textContent(),notice:await direct.locator('#error').textContent(),stages:directStages,pages:context.pages().map(page=>{const url=new URL(page.url());return url.origin+url.pathname;})}));}
  await direct.locator('#direct-models').click();await direct.locator('#direct-model option').filter({hasText:'Modelo direto de teste'}).waitFor({state:'attached'});
  assert.equal(await direct.locator('progress').count(),1);assert.equal(await direct.locator('#direct-analyze').count(),0);assert.equal(await direct.locator('#ai-workflow-consent').count(),0);await direct.locator('#limit').fill('1');
  await direct.locator('#step-product').click();await direct.locator('#workspace > details > summary').click();assert.equal(await direct.locator('#step-product').isVisible(),false);await direct.waitForFunction(()=>document.getElementById('run-status').textContent.includes('Catalogação por IA · Concluída'));
  assert.equal(aiSuggestions.length,1);assert.equal(aiSuggestions[0].suggestion.action,'create_new');await direct.locator('#workspace > details > summary').click();
  await direct.locator('#step-category').click();
  await direct.waitForFunction(()=>document.getElementById('run-status').textContent.includes('Categorização por IA · Concluída'));
  assert.equal(aiSuggestions.length,2);assert.equal(context.pages().length,pagesBefore);
  const storage=await worker.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
  assert.doesNotMatch(JSON.stringify(storage)+JSON.stringify(backendTraffic),/DIRECT_NATIVE_PRIVATE|DIRECT_TEST_CODE|id_token|access_token|refresh_token/);
  assert.equal(await direct.locator('#account-card #login').count(),1);assert.equal(await direct.locator('#account-card #direct-login').count(),1);assert.equal(await direct.locator('#account-card #direct-model').count(),1);
  assert.equal(await direct.locator('#ai-usage, #direct-callback-status, #limit-hint, #session-hint, #queue-counts').count(),0);
  for(const scheme of ['light','dark']){
   await direct.emulateMedia({colorScheme:scheme});await direct.setViewportSize({width:320,height:1000});assert.equal(await direct.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await direct.setViewportSize({width:390,height:1000});const model=await direct.locator('#direct-model').boundingBox(),button=await direct.locator('#direct-models').boundingBox();assert.ok(button.y-(model.y+model.height)>=12);
   await direct.screenshot({path:'reports/ai-panel-'+scheme+'.png',fullPage:true});
  }
  await direct.locator('#account-card > details > summary').click();assert.equal(await direct.locator('#direct-model').isVisible(),false);await direct.locator('#account-card > details > summary').focus();await direct.keyboard.press('Enter');assert.equal(await direct.locator('#direct-model').inputValue(),'direct-fixture');
  const loginsBefore=directStages.filter(s=>s==='/api/accounts/authorize').length;
  const extensionPage=new URL('popup.html?view=panel',worker.url()).href;
  const restart=async()=>{
   await context.close();context=await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',headless:true,chromiumSandbox:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--host-resolver-rules=MAP shop.example.com 127.0.0.1','--ignore-certificate-errors']});
   await installAiRoutes(context);direct=await context.newPage();await direct.goto(extensionPage);await direct.locator('#account-card > details > summary').click();
  };
  await restart();await direct.getByRole('button',{name:'Desconectar IA',exact:true}).waitFor();await direct.waitForFunction(()=>document.getElementById('direct-model').value==='direct-fixture');assert.equal(directStages.filter(s=>s==='/api/accounts/authorize').length,loginsBefore);
  await direct.getByRole('button',{name:'Desconectar IA',exact:true}).click();await direct.getByRole('button',{name:'Conectar IA',exact:true}).waitFor();
  await restart();await direct.getByRole('button',{name:'Conectar IA',exact:true}).waitFor();assert.equal(await direct.locator('#direct-model').inputValue(),'');assert.equal(directStages.filter(s=>s==='/api/accounts/authorize').length,loginsBefore);
  const resumedWorker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const cleared=await resumedWorker.evaluate(async()=>await chrome.storage.local.get('directAiSessionV1'));assert.equal(cleared.directAiSessionV1.sealed,null);
  assert.doesNotMatch(JSON.stringify(backendTraffic),/DIRECT_NATIVE_PRIVATE|DIRECT_TEST_CODE|id_token|access_token|refresh_token/);
 }finally{
  await context?.close();if(server)await new Promise(r=>server.close(r));if(marketServer)await new Promise(r=>marketServer.close(r));
  if(relative(resolve(tmpdir()),resolve(directory)).startsWith('..'))throw Error('Diretório de teste inválido.');
  await rm(directory,{recursive:true,force:true});
 }
});
