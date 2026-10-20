import {DirectAi} from './direct-ai.js';
export async function setupDirectAiPage(create:()=>Promise<DirectAi>=()=>DirectAi.create()){
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const option=(label:string,value:string)=>{const node=document.createElement('option');node.textContent=label;node.value=value;return node;};
const labels:Record<string,string>={idle:'ChatGPT desconectado.',waiting_for_login:'Aguardando autorização na aba de login…',validating_identity:'Retorno capturado. Validando identidade diretamente com a OpenAI…',connected:'Conta conectada diretamente pela extensão.',analyzing:'Analisando uma oferta diretamente com a OpenAI…',completed:'Análise concluída.',failed:'Não foi possível concluir a operação.'};
let app:DirectAi,busy=false,lastError='';
function notify(message:string){el('direct-notice').textContent=message;el('direct-notification').hidden=false;}
function render(){
 if(!app)return;const state=app.status(),running=['waiting_for_login','validating_identity','analyzing'].includes(state.phase);
 el('direct-status').textContent=labels[state.phase]??state.phase;
 el('direct-account-info').textContent=state.account?`${state.account.email||'Conta ChatGPT'} · ${state.account.planEnabled?'Usando seu plano ChatGPT':'Uso do plano não autorizado'}`:'';
 el('direct-callback-status').textContent=state.callbackObserved?'Retorno do login reconhecido nesta aba de teste.':'Nenhum retorno de login recebido nesta sessão.';
 const accounts=el<HTMLSelectElement>('direct-account'),selected=accounts.value;
 accounts.replaceChildren(option('Adicionar outra conta',''),...state.accounts.map((r:any)=>option(r.label,r.id)));accounts.value=selected;
 for(const id of ['direct-login','direct-models','direct-capture','direct-analyze'])el<HTMLButtonElement>(id).disabled=busy||running;
 el<HTMLButtonElement>('direct-models').disabled=busy||running||!state.account?.planEnabled;
 el<HTMLButtonElement>('direct-analyze').disabled=busy||running||!state.account?.planEnabled||!el<HTMLSelectElement>('direct-model').value;
 el<HTMLButtonElement>('direct-cancel').disabled=!running;
 el<HTMLButtonElement>('direct-logout').disabled=busy&&!running;
 if(state.result)el('direct-result').textContent=JSON.stringify(state.result,null,2);
 if(state.error&&state.error!==lastError)notify(state.error);lastError=state.error;
}
async function act(task:()=>Promise<void>){
 if(busy)return;busy=true;render();
 try{await task();}catch(error){notify(error instanceof Error?error.message:'A operação direta não foi concluída.');}finally{busy=false;render();}
}
const on=(id:string,task:()=>Promise<void>)=>el(id).addEventListener('click',()=>{void act(task);});
el('direct-dismiss').addEventListener('click',()=>{el('direct-notification').hidden=true;});
on('direct-login',async()=>{el<HTMLSelectElement>('direct-model').replaceChildren();el('direct-result').textContent='';await app.login(el<HTMLSelectElement>('direct-account').value||undefined);});
on('direct-models',async()=>{const models=await app.models();el<HTMLSelectElement>('direct-model').replaceChildren(...models.map(m=>option(m.name,m.id)));if(!models.length)notify('Nenhum modelo foi disponibilizado para esta conta.');});
on('direct-logout',async()=>{const result=await app.logout();el<HTMLSelectElement>('direct-model').replaceChildren();el('direct-result').textContent='';notify(result.revoked?'ChatGPT desconectado.':'Sessão local encerrada; revogação remota não confirmada. Desconecte nas configurações do ChatGPT.');});
async function loadDraft(){
 const data=(await chrome.storage.session.get('directAiOfferDraft')).directAiOfferDraft as any;
 if(!data?.title)throw new Error('Para trazer os dados, abra o painel sobre uma página de produto e use Testar sem auxiliar. Você também pode preencher os campos manualmente.');
 for(const key of ['title','description','brand','sourceCategory'] as const)el<HTMLInputElement>('direct-'+key).value=typeof data[key]==='string'?data[key]:'';
}
on('direct-capture',loadDraft);
on('direct-analyze',async()=>{
 if(!el<HTMLInputElement>('direct-consent').checked)throw new Error('Autorize o envio dos dados desta oferta à OpenAI.');
 let products;try{products=JSON.parse(el<HTMLTextAreaElement>('direct-products').value||'[]');}catch{throw new Error('Informe uma lista JSON válida de produtos candidatos.');}
 const body={model:el<HTMLSelectElement>('direct-model').value,offer:Object.fromEntries(['title','description','brand','sourceCategory'].map(key=>[key,el<HTMLInputElement>('direct-'+key).value])),categories:el<HTMLTextAreaElement>('direct-categories').value.split('\n').map(s=>s.trim()).filter(Boolean),products};
 el<HTMLInputElement>('direct-consent').checked=false;el('direct-result').textContent='';await app.analyze(body);
});
// Cancellation remains available while the analysis promise is pending.
el('direct-cancel').addEventListener('click',()=>{app?.cancelAnalysis();void app?.cancelLogin().then(render);});
el('direct-model').addEventListener('change',render);
const onHide=()=>{app?.dispose();};window.addEventListener('pagehide',onHide);
try{app=await create();await loadDraft().catch(()=>{});render();}catch{notify('Não foi possível iniciar a sessão direta da extensão. Recarregue esta aba.');}
const timer=setInterval(render,700);
return ()=>{clearInterval(timer);window.removeEventListener('pagehide',onHide);app?.dispose();};
}
