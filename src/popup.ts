import {backendOrigin,type Configuration,type Progress,type Account} from './contracts.js';
interface View {backendUrl:string;user?:Account;pairing:boolean;config?:Configuration;marketplaceId?:string;progress:Progress;queue?:{items:{id:string;title:string;state:string;affiliateUrl?:string;error?:string}[]};version:string}
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let view:View|undefined;let busy=false;
async function send(type:string,extra:Record<string,unknown>={}){
 const reply=await chrome.runtime.sendMessage({type,...extra});if(reply.error)throw new Error(reply.error);view=reply.value as View;render();
}
function render(){
 if(!view)return;const connected=!!view.user,running=view.progress.status==='running';
 element('version').textContent=view.version;element('account').textContent=view.user?.email??'Conta desconectada';
 element('status').textContent=view.progress.message;element('mode').textContent=view.config?.mock?'Ambiente demonstrativo':'Conexão administrativa';
 element('login').hidden=connected;element<HTMLButtonElement>('login').disabled=view.pairing;
 element('logout').hidden=!connected&&!view.pairing;element('logout').textContent=view.pairing?'Cancelar conexão':'Sair';element('workspace').hidden=!connected;
 const backend=element<HTMLInputElement>('backend');if(document.activeElement!==backend)backend.value=view.backendUrl;backend.disabled=connected;
 element<HTMLButtonElement>('save-backend').disabled=connected;
 const select=element<HTMLSelectElement>('marketplace'),selected=select.value||view.marketplaceId;
 if(JSON.stringify(Array.from(select.options,o=>o.value))!==JSON.stringify(view.config?.marketplaces.map(m=>m.id)??[])){
  select.replaceChildren(...(view.config?.marketplaces??[]).map(m=>{const option=document.createElement('option');option.value=m.id;option.textContent=m.name;return option;}));
 }
 if(selected&&Array.from(select.options).some(o=>o.value===selected))select.value=selected;select.disabled=running;
 element<HTMLButtonElement>('start').disabled=running||busy||!select.value;
 element('start').textContent=view.progress.status==='paused'?'Continuar geração':'Gerar links pendentes';
 element<HTMLButtonElement>('pause').disabled=!running;
 element<HTMLButtonElement>('refresh').disabled=running;
 element<HTMLButtonElement>('reset').disabled=running;element('reset').hidden=!view.config?.mock;
 const processed=view.progress.success+view.progress.failed,progress=element<HTMLProgressElement>('progress');progress.max=Math.max(1,view.progress.total);progress.value=processed;
 element('counts').textContent=`${processed} de ${view.progress.total} processados · ${view.progress.success} concluídos · ${view.progress.failed} falhas`;
 element('current').textContent=view.progress.currentTitle??'';
 element('results').replaceChildren(...(view.queue?.items??[]).map(item=>{
  const row=document.createElement('li'),name=document.createElement('strong');name.textContent=item.title;row.append(name,document.createElement('br'));
  const detail=document.createElement('span');detail.textContent=item.error??({pending:'Pendente',leased:'Em processamento',done:'Link gerado',failed:'Falhou'}[item.state]??item.state);row.append(detail);
  if(item.affiliateUrl){try{const u=new URL(item.affiliateUrl);if(['http:','https:'].includes(u.protocol)){const link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Ver link';row.append(' · ',link);}}catch{/* Resultado inválido não vira link clicável. */}}
  return row;
 }));
}
async function act(callback:()=>Promise<unknown>){
 if(busy)return;busy=true;element('error').hidden=true;render();
 try{await callback();}catch(error){element('error').textContent=error instanceof Error?error.message:'Não foi possível concluir.';element('error').hidden=false;}finally{busy=false;render();}
}
const marketplace=()=>element<HTMLSelectElement>('marketplace').value;
async function grantOrigins(origins:string[]){if(!await chrome.permissions.request({origins:origins.map(o=>`${o}/*`)}))throw new Error('Permissão de acesso aos domínios não concedida.');}
element('login').addEventListener('click',()=>{void act(()=>send('LOGIN'));});
element('logout').addEventListener('click',()=>{void act(()=>send('LOGOUT'));});
element('refresh').addEventListener('click',()=>{void act(()=>send('REFRESH'));});
element('pause').addEventListener('click',()=>{void act(()=>send('PAUSE'));});
element('reset').addEventListener('click',()=>{void act(()=>send('RESET'));});
element('open').addEventListener('click',()=>{void act(async()=>{const recipe=view?.config?.marketplaces.find(m=>m.id===marketplace());if(!recipe)throw new Error('Escolha um marketplace.');await grantOrigins(recipe.allowedOrigins);await send('OPEN',{marketplaceId:recipe.id});});});
element('start').addEventListener('click',()=>{void act(async()=>{const recipe=view?.config?.marketplaces.find(m=>m.id===marketplace());if(!recipe)throw new Error('Escolha um marketplace.');await grantOrigins(recipe.allowedOrigins);await send('START',{marketplaceId:recipe.id});});});
element('settings').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{const url=backendOrigin(element<HTMLInputElement>('backend').value);await grantOrigins([url]);await send('BACKEND',{url});});});
void act(()=>send('STATE'));
setInterval(()=>{if(!busy)void send('STATE').catch(()=>{/* A próxima consulta tentará reconectar ao worker. */});},2000);
