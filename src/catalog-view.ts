import type { CatalogMarket, CatalogRun,CatalogStats } from './catalog-types.js';
import type { Account } from './contracts.js';
export interface CatalogView {
    backendUrl: string;
    user?: Account;
    pairing: boolean;
    markets: CatalogMarket[];
    marketplaceId?: string;
    retryFailed?:boolean;stats?:CatalogStats;statsError?:string;
    run?: CatalogRun;
    message: string;
    error?: string;
    version: string;
}
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const runLabel = (status: string) => ({
    queued: 'Aguardando início', running: 'Em execução', paused_by_user: 'Pausada', waiting_for_human: 'Intervenção humana necessária', paused_technical: 'Pausa técnica', completed: 'Concluída', failed: 'Falha', cancelled: 'Cancelada'
} as Record<string, string>)[status] ?? status;
export const stepLabel=(step:string)=>({discover:'1 — Extrair links',convert:'2 — Gerar links de afiliados',enrich:'3 — Extrair informações dos produtos',prices:'4 — Atualizar preços',preview:'Prévia manual',selector_test:'Teste de seletores'} as Record<string,string>)[step]??step;
function renderQueue(view:CatalogView,marketplaceId:string){
    const stats=view.stats?.marketplaceId===marketplaceId?view.stats:undefined;
    for(const step of ['convert','enrich','prices'] as const){
        const value=stats?.[step],button=el<HTMLButtonElement>('step-'+step);
        const count=step==='prices'?stats?.prices?.pending:stats?.[step]?.completed;
        const label={convert:'Gerados',enrich:'Extraídos',prices:'Pendentes (24h)'}[step];
        button.textContent=stepLabel(step)+' · '+label+': '+(value&&count!==undefined?`${count} / ${value.total}`:'— / —');
        button.title=step==='prices'?'Sem verificação bem-sucedida nas últimas 24h / ofertas publicadas com link de afiliado. A execução manual continua permitindo verificar todas as ofertas.':'Concluídos / total de links descobertos não arquivados. Falhas não contam como conclusão. Independente do limite por execução.';
    }
    el('queue-counts').textContent='Conversão e extração: concluídos / links não arquivados. Preços: pendentes de verificação nas últimas 24h / ofertas publicadas.';
}
export function renderCatalog(view: CatalogView, busy: boolean) {
    el('account').textContent = view.user?.email ?? 'Conta desconectada';
    el('status').textContent = view.message;
    el('version').textContent = view.version;
    el('workspace').hidden = !view.user;
    el('login').hidden = !!view.user;
    el<HTMLButtonElement>('login').disabled = busy || view.pairing;
    el('logout').hidden = !view.user && !view.pairing;
    el<HTMLInputElement>('backend').disabled = !!view.user || view.pairing;
    el<HTMLButtonElement>('save-backend').disabled = busy || !!view.user || view.pairing;
    if (document.activeElement !== el('backend'))
        el<HTMLInputElement>('backend').value = view.backendUrl;
    const select = el<HTMLSelectElement>('marketplace');
    const selected = view.marketplaceId || select.value || view.markets[0]?.id;
    select.disabled=busy;el<HTMLInputElement>('retry-failed').disabled=busy;
    if (JSON.stringify([...select.options].map(o => o.value)) !== JSON.stringify(view.markets.map(m => m.id)))
        select.replaceChildren(...view.markets.map(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = m.name + (m.catalog_executor === 'extension' ? '' : ' — extensão não ativada');
            return option;
        }));
    if (selected && [...select.options].some(o => o.value === selected))
        select.value = selected;
    if(document.activeElement!==el('retry-failed'))el<HTMLInputElement>('retry-failed').checked=view.retryFailed??false;
    renderQueue(view,select.value);
    const run = view.run, active = !!run && !['completed', 'failed', 'cancelled'].includes(run.status);
    let status = 'Nenhuma execução selecionada.';
    if (run) {
        status = stepLabel(run.step)+' · '+(view.markets.find(m=>m.id===run.marketplace_id)?.name??run.marketplace_id??'')+' · '+runLabel(run.status);
        if (run.reason)
            status += ' · ' + run.reason;
    }
    el('run-status').textContent = status;
    el('counts').textContent = run ? `${run.completed} concluídos · ${run.failed} falhas · ${run.total} itens` : '';
    el<HTMLProgressElement>('progress').max = Math.max(1, run?.total ?? 1);
    el<HTMLProgressElement>('progress').value = (run?.completed ?? 0) + (run?.failed ?? 0);
    const permissions: Record<string, string> = {
        discover: 'discovery', convert: 'affiliate_links', enrich: 'catalog', prices: 'updates'
    };
    for (const step of Object.keys(permissions))
        el<HTMLButtonElement>('step-' + step).disabled = busy || active || !view.user?.permissions.includes(permissions[step]);
    el<HTMLButtonElement>('prepare').disabled = busy || !!run && ['queued', 'running'].includes(run.status);
    el<HTMLButtonElement>('pause').disabled = busy || !run || !['queued', 'running'].includes(run.status);
    el<HTMLButtonElement>('resume').disabled = busy || !run || !['queued', 'paused_by_user', 'waiting_for_human', 'paused_technical'].includes(run.status);
    el<HTMLButtonElement>('cancel').disabled = busy || !active;
    el<HTMLButtonElement>('pick-elements').disabled = busy || !!run && ['queued', 'running'].includes(run.status);
}
