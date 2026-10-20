import {captureAiOffer,localAiRequest} from './local-ai.js';
import {launchDirectAi} from './direct-ai-launcher.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const option=(label:string,value:string)=>{const node=document.createElement('option');node.textContent=label;node.value=value;return node;};
export function setupLocalAi(notify:(message:string,kind?:'error'|'success')=>void){
 let busy=false,paired=false,connected=false,lastError='',loginPending=false,jobRunning=false;
 const buttons=['ai-pair','ai-login','ai-logout','ai-models','ai-capture','ai-analyze','ai-cancel'];
 const request=async(path:string,body:Record<string,unknown>={})=>{
  if(!['/status','/pair'].includes(path)){
   const reply=await chrome.runtime.sendMessage({type:'STATE'});
   if(reply.error||!reply.value?.user?.permissions?.includes('affiliate_links'))throw new Error('Entre no O Espertinho com permissão de gerar links de afiliados.');
  }
  return localAiRequest(path,body);
 };
 function render(){
  for(const id of buttons)el<HTMLButtonElement>(id).disabled=busy;
  for(const id of ['ai-login','ai-logout','ai-models','ai-analyze','ai-cancel'])el<HTMLButtonElement>(id).disabled=busy||!paired;
  el<HTMLButtonElement>('ai-analyze').disabled=busy||!connected||jobRunning||!el<HTMLSelectElement>('ai-model').value;
  el<HTMLButtonElement>('ai-cancel').disabled=busy||!jobRunning;
 }
 async function status(){
  const state=await request('/status');paired=true;connected=!!state.account?.planEnabled;loginPending=state.loginPending;jobRunning=state.analysis?.status==='running';
  el('ai-status').textContent=state.connected?`${state.account.email||'Conta ChatGPT'} · ${connected?'Usando seu plano ChatGPT':'Uso do plano não autorizado'}`:loginPending?'Aguardando login no navegador…':'ChatGPT desconectado.';
  const select=el<HTMLSelectElement>('ai-account'),selected=select.value;select.replaceChildren(option('Adicionar outra conta',''),...state.accounts.map((a:any)=>option(a.label,a.id)));select.value=selected;
  if(state.analysis?.status==='completed')el('ai-result').textContent=JSON.stringify(state.analysis.result,null,2);
  else if(jobRunning)el('ai-result').textContent='Analisando uma oferta…';
  const error=state.error||state.analysis?.error||'';if(error&&error!==lastError)notify(error);lastError=error;render();
 }
 async function act(task:()=>Promise<void>){
  if(busy)return;busy=true;render();
  try{await task();}catch(error){notify(error instanceof Error?error.message:'Falha na prova local.');}finally{busy=false;render();}
 }
 const on=(id:string,task:()=>Promise<void>)=>el(id).addEventListener('click',()=>{void act(task);});
 on('ai-pair',async()=>{
  if(!await chrome.permissions.request({origins:['http://127.0.0.1/*']}))throw new Error('Permissão local não concedida.');
  await request('/pair',{code:el<HTMLInputElement>('ai-code').value.trim()});el<HTMLInputElement>('ai-code').value='';await status();notify('Auxiliar vinculado apenas a esta extensão.','success');
 });
 on('ai-login',async()=>{
  const data=await request('/login',{accountId:el<HTMLSelectElement>('ai-account').value});
  const url=new URL(data.url);if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw new Error('Endereço de autorização inválido.');
  el<HTMLSelectElement>('ai-model').replaceChildren();await chrome.tabs.create({url:url.href,active:true});await status();
 });
 on('ai-logout',async()=>{
  const result=await request('/logout');el<HTMLSelectElement>('ai-model').replaceChildren();el('ai-result').textContent='';await status();
  notify(result.revoked?'ChatGPT desconectado.':'Sessão local encerrada; não foi possível confirmar a revogação remota. Desconecte o aplicativo nas configurações do ChatGPT.',result.revoked?'success':'error');
 });
 on('ai-models',async()=>{
  const data=await request('/models');el<HTMLSelectElement>('ai-model').replaceChildren(...data.models.map((m:any)=>option(m.name,m.id)));await status();
  if(!data.models.length)throw new Error('Nenhum modelo disponível foi retornado para esta conta.');
 });
 on('ai-capture',async()=>{
  const offer=await captureAiOffer();for(const key of ['title','description','brand','sourceCategory'] as const)el<HTMLInputElement>('ai-'+key).value=offer[key];notify('Dados básicos capturados. Confira antes de enviar à OpenAI.','success');
 });
 on('ai-analyze',async()=>{
  if(!el<HTMLInputElement>('ai-consent').checked)throw new Error('Autorize o envio dos dados desta oferta à OpenAI.');
  const offer=Object.fromEntries(['title','description','brand','sourceCategory'].map(k=>[k,el<HTMLInputElement>('ai-'+k).value]));
  if(!offer.title.trim())throw new Error('Informe o nome da oferta.');
  let products;try{products=JSON.parse(el<HTMLTextAreaElement>('ai-products').value||'[]');}catch{throw new Error('Produtos candidatos: informe uma lista JSON válida.');}
  await request('/analyze',{model:el<HTMLSelectElement>('ai-model').value,offer,categories:el<HTMLTextAreaElement>('ai-categories').value.split('\n').map(s=>s.trim()).filter(Boolean),products});el<HTMLInputElement>('ai-consent').checked=false;await status();
 });
 on('ai-cancel',async()=>{await request('/cancel');el('ai-result').textContent='Análise cancelada.';await status();});
 on('ai-direct',async()=>{await launchDirectAi();});
 el('ai-model').addEventListener('change',render);
 el('ai-proof').addEventListener('toggle',()=>{if((el('ai-proof') as HTMLDetailsElement).open)void status().catch(()=>{});});
 render();
 setInterval(()=>{if(!busy&&paired&&(loginPending||jobRunning||(el('ai-proof') as HTMLDetailsElement).open))void status().catch(error=>{paired=false;connected=false;render();notify(error instanceof Error?error.message:'Auxiliar desconectado.');});},2500);
}
