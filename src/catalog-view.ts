import type {CatalogMarket,CatalogRun} from './catalog-types.js';
import type {Account} from './contracts.js';
export interface CatalogView {backendUrl:string;user?:Account;pairing:boolean;markets:CatalogMarket[];marketplaceId?:string;run?:CatalogRun;message:string;version:string}
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export const runLabel=(status:string)=>({queued:'Aguardando início',running:'Em execução',paused_by_user:'Pausada',waiting_for_human:'Intervenção humana necessária',paused_technical:'Pausa técnica',completed:'Concluída',failed:'Falha',cancelled:'Cancelada'} as Record<string,string>)[status]??status;
export function renderCatalog(view:CatalogView,busy:boolean){
 el('account').textContent=view.user?.email??'Conta desconectada';el('status').textContent=view.message;el('version').textContent=view.version;
 el('workspace').hidden=!view.user;el('login').hidden=!!view.user;el<HTMLButtonElement>('login').disabled=busy||view.pairing;el('logout').hidden=!view.user&&!view.pairing;
 el<HTMLInputElement>('backend').disabled=!!view.user||view.pairing;el<HTMLButtonElement>('save-backend').disabled=busy||!!view.user||view.pairing;
 if(document.activeElement!==el('backend'))el<HTMLInputElement>('backend').value=view.backendUrl;
 const select=el<HTMLSelectElement>('marketplace');const selected=select.value||view.marketplaceId;
 if(JSON.stringify([...select.options].map(o=>o.value))!==JSON.stringify(view.markets.map(m=>m.id)))select.replaceChildren(...view.markets.map(m=>{const option=document.createElement('option');option.value=m.id;option.textContent=m.name+(m.catalog_executor==='extension'?'':' — extensão não ativada');return option;}));
 if(selected&&[...select.options].some(o=>o.value===selected))select.value=selected;
 const run=view.run,active=!!run&&!['completed','failed','cancelled'].includes(run.status);
 el('run-status').textContent=run?runLabel(run.status)+(run.reason?' · '+run.reason:''):'Nenhuma execução selecionada.';
 el('counts').textContent=run?`${run.completed} concluídos · ${run.failed} falhas · ${run.total} itens`:'';
 el<HTMLProgressElement>('progress').max=Math.max(1,run?.total??1);el<HTMLProgressElement>('progress').value=(run?.completed??0)+(run?.failed??0);
 const permissions:Record<string,string>={discover:'discovery',convert:'affiliate_links',enrich:'catalog',prices:'updates'};
 for(const step of Object.keys(permissions))el<HTMLButtonElement>('step-'+step).disabled=busy||active||!view.user?.permissions.includes(permissions[step]);
 el<HTMLButtonElement>('pause').disabled=busy||!run||!['queued','running'].includes(run.status);
 el<HTMLButtonElement>('resume').disabled=busy||!run||!['queued','paused_by_user','waiting_for_human','paused_technical'].includes(run.status);
 el<HTMLButtonElement>('cancel').disabled=busy||!active;el<HTMLButtonElement>('pick-elements').disabled=busy||!!run&&['queued','running'].includes(run.status);
}
