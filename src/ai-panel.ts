import {ReviewAiWorkflow,type AiTask} from './review-ai-workflow.js';
import type {CatalogView} from './catalog-view.js';
import {AiController} from './ai-controller.js';
export async function setupAiPanel(notify:(message:string,kind?:'error'|'success')=>void,isPanel:boolean,create:()=>Promise<AiController>=()=>AiController.create(),hooks?:{view:()=>CatalogView|undefined;busy:(value:boolean)=>void;progress?:(value:ReviewAiWorkflow['progress']|undefined)=>void}){
const panel=document.getElementById('ai-panel-content')!;
panel.hidden=!isPanel;
document.getElementById('ai-popup-hint')!.hidden=isPanel;
if(!isPanel){document.getElementById('ai-open-panel')!.addEventListener('click',()=>document.getElementById('display-mode')!.click());return ()=>{};}
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const option=(label:string,value:string)=>{const node=document.createElement('option');node.textContent=label;node.value=value;return node;};
const labels:Record<string,string>={idle:'Desconectado',waiting_for_login:'Aguardando login…',validating_identity:'Validando login…',connected:'Conectado',analyzing:'Em análise',completed:'Conectado',failed:'Falha na operação'};
let app:AiController,busy=false,lastError='',workflow:ReviewAiWorkflow|undefined;
let refreshing=false,refreshedAt=0,configError='',lastAccountId='';
function renderWorkflow(){
 const view=hooks?.view(),marketplaceId=view?.marketplaceId||view?.markets[0]?.id||'',state=app?.status(),config=workflow?.marketplaceId===marketplaceId?workflow.config:undefined;
 if(workflow?.busy&&!state?.account&&workflow.progress.status==='running')workflow.cancel();
 const active=!!view?.run&&!['completed','failed','cancelled'].includes(view.run.status),permissions=view?.user?.permissions??[];
 for(const task of ['category','product'] as const){
  const button=el<HTMLButtonElement>('step-'+task),value=config?.[task];
  const reason=!isPanel?'abra o painel lateral':!permissions.includes('catalog')||!permissions.includes('affiliate_links')?'sem permissão de catálogo':!config?'atualize configurações':!config.settings[task==='category'?'categoryEnabled':'productEnabled']?'desativado no admin':!state?.account?.planEnabled?'entre no ChatGPT':!el<HTMLSelectElement>('direct-model').value?'escolha um modelo':active?'outra execução em andamento':'';
  button.textContent=(task==='category'?'5 — Categorizar produtos':'4 — Catalogar produtos')+' · '+(value?value.completed+' / '+value.total:'— / —')+(reason?' · '+reason:'');
  button.title=task==='category'?'Links com categoria do produto definida / links já catalogados.':'Links identificados por produto ou rascunho / total de links da revisão.';
  button.disabled=!!reason||busy||!!workflow?.busy||['analyzing','waiting_for_login','validating_identity'].includes(state?.phase??'');
 }
 if(!refreshing&&!workflow?.busy&&hooks&&permissions.includes('catalog')&&permissions.includes('affiliate_links')&&marketplaceId&&(Date.now()-refreshedAt>10000||workflow?.marketplaceId!==marketplaceId))void refreshWorkflow();
}
async function refreshWorkflow(){
 const view=hooks?.view(),marketplaceId=view?.marketplaceId||view?.markets[0]?.id;if(!workflow||!marketplaceId||refreshing)return;
 refreshing=true;refreshedAt=Date.now();try{await workflow.refresh(marketplaceId);configError='';}catch(e){workflow.config=undefined;const message=e instanceof Error?e.message:'Falha ao carregar IA.';if(configError!==message)notify(message);configError=message;}finally{refreshing=false;refreshedAt=Date.now();}
}
function render(){
 if(!app)return;renderWorkflow();const state=app.status(),running=['waiting_for_login','validating_identity','analyzing'].includes(state.phase);
 el('direct-status').textContent=labels[state.phase]??state.phase;
 el('direct-account-info').textContent=state.account?.email||'';el('direct-account-info').hidden=!state.account?.email;
 const model=el<HTMLSelectElement>('direct-model');
 if(JSON.stringify([...model.options].map(o=>o.value))!==JSON.stringify(state.models.map((m:any)=>m.id)))model.replaceChildren(...state.models.map((m:any)=>option(m.name,m.id)));
 model.value=state.selectedModel||'';
 const accounts=el<HTMLSelectElement>('direct-account'),selected=accounts.value;
 accounts.replaceChildren(option('Adicionar outra conta',''),...state.accounts.map((r:any)=>option(r.label,r.id)));accounts.value=state.activeAccountId!==lastAccountId?(state.activeAccountId||''):selected;lastAccountId=state.activeAccountId||'';
 for(const id of ['direct-login','direct-models'])el<HTMLButtonElement>(id).disabled=busy||running||!!workflow?.busy;
 el<HTMLButtonElement>('direct-models').disabled=busy||running||!!workflow?.busy||!state.account?.planEnabled;
 el<HTMLButtonElement>('direct-cancel').hidden=!['waiting_for_login','validating_identity'].includes(state.phase);
 el<HTMLButtonElement>('direct-login').textContent=state.account?'Desconectar IA':'Conectar IA';
 el<HTMLSelectElement>('direct-model').disabled=!!workflow?.busy;
 if(state.error&&state.error!==lastError)notify(state.error);lastError=state.error;
}
async function act(task:()=>Promise<void>){
 if(busy)return;busy=true;render();
 try{await task();}catch(error){notify(error instanceof Error?error.message:'A operação direta não foi concluída.');}finally{busy=false;render();}
}
const on=(id:string,task:()=>Promise<void>)=>el(id).addEventListener('click',()=>{void act(task);});
on('direct-login',async()=>{
 if(app.status().account){
  const result=await app.logout();el<HTMLSelectElement>('direct-model').replaceChildren();notify(result.revoked?'IA desconectada.':'Sessão local encerrada; revogação remota não confirmada. Desconecte nas configurações do ChatGPT.',result.revoked?'success':'error');
 }else{el<HTMLSelectElement>('direct-model').replaceChildren();await app.login(el<HTMLSelectElement>('direct-account').value||undefined);}
});
on('direct-models',async()=>{const models=await app.models();if(models.length&&!app.status().selectedModel)await app.selectModel(models[0].id);if(!models.length)notify('Nenhum modelo foi disponibilizado para esta conta.');});
// Cancellation remains available while the analysis promise is pending.
el('direct-cancel').addEventListener('click',()=>{app?.cancelAnalysis();void app?.cancelLogin().then(render);});
el('direct-model').addEventListener('change',()=>{const model=el<HTMLSelectElement>('direct-model').value;void act(()=>app.selectModel(model));});
const cancelWorkflow=()=>{workflow?.cancel();app?.cancelAnalysis();};
const onHide=()=>{workflow?.cancel();app?.dispose();};window.addEventListener('pagehide',onHide);
try{app=await create();
 if(hooks){
  workflow=new ReviewAiWorkflow(async(operation,payload)=>{const reply=await chrome.runtime.sendMessage({type:'AI_REVIEW',operation,payload});if(reply.error)throw new Error(reply.error);return reply.value;},input=>app.analyze(input),()=>{hooks.progress?.(workflow?.progress);hooks.busy(!!workflow?.busy);render();});
  for(const task of ['category','product'] as const)el('step-'+task).addEventListener('click',()=>{void (async()=>{
   try{const view=hooks.view();if(!view?.user||!app.status().account?.planEnabled)throw new Error('Entre no Espertinho e no ChatGPT para continuar.');
    await workflow!.run(task,el<HTMLSelectElement>('marketplace').value,Number(el<HTMLInputElement>('limit').value),el<HTMLSelectElement>('direct-model').value);
    notify('Decisões válidas aplicadas. Revise as pendências e publique pelo admin.','success');
   }catch(e){notify(e instanceof Error?e.message:'Não foi possível concluir a revisão por IA.');}
  })();});
  document.addEventListener('cancel-ai-review',cancelWorkflow);
  el('logout').addEventListener('click',()=>{workflow?.cancel();void app.logout();});
  document.addEventListener('catalog-config-updated',()=>{void refreshWorkflow();});
 }
 render();}catch{notify('Não foi possível iniciar a sessão direta da extensão. Reabra o painel.');}
const timer=setInterval(()=>{void app?.sync().then(render).catch(()=>{});},700);
return ()=>{document.removeEventListener('cancel-ai-review',cancelWorkflow);clearInterval(timer);window.removeEventListener('pagehide',onHide);app?.dispose();};
}
