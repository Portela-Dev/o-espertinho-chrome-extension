import {ReviewAiWorkflow,type AiTask} from './review-ai-workflow.js';
import type {CatalogView} from './catalog-view.js';
import {AiController} from './ai-controller.js';
import {captureAiOffer} from './offer-metadata.js';
export async function setupAiPanel(notify:(message:string,kind?:'error'|'success')=>void,isPanel:boolean,create:()=>Promise<AiController>=()=>AiController.create(),hooks?:{view:()=>CatalogView|undefined;busy:(value:boolean)=>void}){
const panel=document.getElementById('ai-panel-content')!;
panel.hidden=!isPanel;
document.getElementById('ai-popup-hint')!.hidden=isPanel;
if(!isPanel){document.getElementById('ai-open-panel')!.addEventListener('click',()=>document.getElementById('display-mode')!.click());return ()=>{};}
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const option=(label:string,value:string)=>{const node=document.createElement('option');node.textContent=label;node.value=value;return node;};
const labels:Record<string,string>={idle:'ChatGPT desconectado.',waiting_for_login:'Aguardando autorização na aba de login…',validating_identity:'Retorno capturado. Validando identidade diretamente com a OpenAI…',connected:'Conta conectada diretamente pela extensão.',analyzing:'Analisando uma oferta diretamente com a OpenAI…',completed:'Análise concluída.',failed:'Não foi possível concluir a operação.'};
let app:AiController,busy=false,lastError='',workflow:ReviewAiWorkflow|undefined;
let refreshing=false,refreshedAt=0,configError='';
function renderWorkflow(){
 const view=hooks?.view(),marketplaceId=view?.marketplaceId||view?.markets[0]?.id||'',state=app?.status(),config=workflow?.marketplaceId===marketplaceId?workflow.config:undefined;
 const active=!!view?.run&&!['completed','failed','cancelled'].includes(view.run.status),permissions=view?.user?.permissions??[];
 for(const task of ['category','product'] as const){
  const button=el<HTMLButtonElement>('step-'+task),value=config?.[task];
  const reason=!isPanel?'abra o painel lateral':!permissions.includes('catalog')||!permissions.includes('affiliate_links')?'sem permissão de catálogo':!config?'atualize configurações':!config.settings[task==='category'?'categoryEnabled':'productEnabled']?'desativado no admin':!state?.account?.planEnabled?'entre no ChatGPT':!el<HTMLSelectElement>('direct-model').value?'escolha um modelo':active?'outra execução em andamento':'';
  button.textContent=(task==='category'?'5 — Categorizar produtos':'4 — Catalogar produtos')+' · '+(value?value.completed+' / '+value.total:'— / —')+(reason?' · '+reason:'');
  button.title=task==='category'?'Links com categoria do produto definida / links já catalogados.':'Links identificados por produto ou rascunho / total de links da revisão.';
  button.disabled=!!reason||busy||!!workflow?.busy||['analyzing','waiting_for_login','validating_identity'].includes(state?.phase??'');
 }
 if(workflow){const p=workflow.progress;
  el('ai-batch-status').textContent=p.status==='idle'?'':(p.task==='category'?'Categorização':'Catalogação')+' por IA · '+({running:'Em execução',completed:'Concluída',cancelled:'Cancelada',failed:'Interrompida'}[p.status]??p.status)+' · '+p.completed+'/'+p.total+' decisões aplicadas · '+p.pending+' pendências · '+p.failed+' falhas'+(p.status==='running'&&p.title?' · '+p.title:'');
  const progress=el<HTMLProgressElement>('ai-batch-progress');progress.hidden=p.status==='idle';progress.max=Math.max(1,p.total);progress.value=p.completed+p.failed;
  el<HTMLButtonElement>('ai-batch-cancel').hidden=!workflow.busy;
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
 el('direct-account-info').textContent=state.account?`${state.account.email||'Conta ChatGPT'} · ${state.account.planEnabled?'Usando seu plano ChatGPT':'Uso do plano não autorizado'}`:'';
 el('direct-callback-status').textContent=state.callbackObserved?'Retorno do login reconhecido neste painel.':'Nenhum retorno de login recebido nesta sessão.';
 const accounts=el<HTMLSelectElement>('direct-account'),selected=accounts.value;
 accounts.replaceChildren(option('Adicionar outra conta',''),...state.accounts.map((r:any)=>option(r.label,r.id)));accounts.value=selected;
 for(const id of ['direct-login','direct-models','direct-capture','direct-analyze'])el<HTMLButtonElement>(id).disabled=busy||running||!!workflow?.busy;
 el<HTMLButtonElement>('direct-models').disabled=busy||running||!!workflow?.busy||!state.account?.planEnabled;
 el<HTMLButtonElement>('direct-analyze').disabled=busy||running||!!workflow?.busy||!state.account?.planEnabled||!el<HTMLSelectElement>('direct-model').value;
 el<HTMLButtonElement>('direct-cancel').disabled=!running;
 el<HTMLButtonElement>('direct-logout').disabled=busy||running||!!workflow?.busy;
 el<HTMLSelectElement>('direct-model').disabled=!!workflow?.busy;
 el('ai-usage').textContent='Nesta sessão: '+(state.usage?.requests??0)+' análises · '+(state.usage?.tokenReports?(state.usage.totalTokens+' tokens informados'):'tokens não informados pela OpenAI')+'. O saldo total do plano não é disponibilizado por esta integração.';
 if(state.result)el('direct-result').textContent=JSON.stringify(state.result,null,2);
 if(state.error&&state.error!==lastError)notify(state.error);lastError=state.error;
}
async function act(task:()=>Promise<void>){
 if(busy)return;busy=true;render();
 try{await task();}catch(error){notify(error instanceof Error?error.message:'A operação direta não foi concluída.');}finally{busy=false;render();}
}
const on=(id:string,task:()=>Promise<void>)=>el(id).addEventListener('click',()=>{void act(task);});
on('direct-login',async()=>{el<HTMLSelectElement>('direct-model').replaceChildren();el('direct-result').textContent='';await app.login(el<HTMLSelectElement>('direct-account').value||undefined);});
on('direct-models',async()=>{const models=await app.models();el<HTMLSelectElement>('direct-model').replaceChildren(...models.map(m=>option(m.name,m.id)));if(!models.length)notify('Nenhum modelo foi disponibilizado para esta conta.');});
on('direct-logout',async()=>{const result=await app.logout();el<HTMLSelectElement>('direct-model').replaceChildren();el('direct-result').textContent='';notify(result.revoked?'ChatGPT desconectado.':'Sessão local encerrada; revogação remota não confirmada. Desconecte nas configurações do ChatGPT.',result.revoked?'success':'error');});
async function captureOffer(){
 const data=await captureAiOffer();
 for(const key of ['title','description','brand','sourceCategory'] as const)el<HTMLInputElement>('direct-'+key).value=typeof data[key]==='string'?data[key]:'';
}
on('direct-capture',captureOffer);
on('direct-analyze',async()=>{
 if(!el<HTMLInputElement>('direct-consent').checked)throw new Error('Autorize o envio dos dados desta oferta à OpenAI.');
 let products;try{products=JSON.parse(el<HTMLTextAreaElement>('direct-products').value||'[]');}catch{throw new Error('Informe uma lista JSON válida de produtos candidatos.');}
 const body={model:el<HTMLSelectElement>('direct-model').value,offer:Object.fromEntries(['title','description','brand','sourceCategory'].map(key=>[key,el<HTMLInputElement>('direct-'+key).value])),categories:el<HTMLTextAreaElement>('direct-categories').value.split('\n').map(s=>s.trim()).filter(Boolean),products};
 el<HTMLInputElement>('direct-consent').checked=false;el('direct-result').textContent='';await app.analyze(body);
});
// Cancellation remains available while the analysis promise is pending.
el('direct-cancel').addEventListener('click',()=>{app?.cancelAnalysis();void app?.cancelLogin().then(render);});
el('direct-model').addEventListener('change',render);
const onHide=()=>{workflow?.cancel();app?.dispose();};window.addEventListener('pagehide',onHide);
try{app=await create();
 if(hooks){
  workflow=new ReviewAiWorkflow(async(operation,payload)=>{const reply=await chrome.runtime.sendMessage({type:'AI_REVIEW',operation,payload});if(reply.error)throw new Error(reply.error);return reply.value;},input=>app.analyze(input),()=>{hooks.busy(!!workflow?.busy);render();});
  for(const task of ['category','product'] as const)el('step-'+task).addEventListener('click',()=>{void (async()=>{
   try{const view=hooks.view();if(!view?.user||!app.status().account?.planEnabled)throw new Error('Entre no Espertinho e no ChatGPT para continuar.');
    const consent=el<HTMLInputElement>('ai-workflow-consent').checked;el<HTMLInputElement>('ai-workflow-consent').checked=false;
    await workflow!.run(task,el<HTMLSelectElement>('marketplace').value,Number(el<HTMLInputElement>('limit').value),el<HTMLSelectElement>('direct-model').value,consent);
    notify('Decisões válidas aplicadas. Revise as pendências e publique pelo admin.','success');
   }catch(e){notify(e instanceof Error?e.message:'Não foi possível concluir a revisão por IA.');}
  })();});
  el('ai-batch-cancel').addEventListener('click',()=>{workflow?.cancel();app.cancelAnalysis();});
  el('logout').addEventListener('click',()=>{workflow?.cancel();void app.logout();});
  document.addEventListener('catalog-config-updated',()=>{void refreshWorkflow();});
 }
 render();}catch{notify('Não foi possível iniciar a sessão direta da extensão. Reabra o painel.');}
const timer=setInterval(render,700);
return ()=>{clearInterval(timer);window.removeEventListener('pagehide',onHide);app?.dispose();};
}
