import { launchSelectorPicker } from './picker-launcher.js';
import { setupAiPanel } from './ai-panel.js';
import { backendOrigin } from './contracts.js';
import { renderCatalog, runLabel,stepLabel, type CatalogView } from './catalog-view.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let view: CatalogView | undefined, busy = false, page = 1, total = 0;
let notificationTimer: ReturnType<typeof setTimeout> | undefined;
let aiBusy=false,aiProgressSuppressed=false;
let aiProgress: import('./review-ai-workflow.js').ReviewAiWorkflow['progress']|undefined;
let lastBackgroundError = '', lastPollingError = '';
function hideNotification() {
    clearTimeout(notificationTimer);
    element('notification').hidden = true;
    element('error').hidden = true;
    element('success').hidden = true;
}
function notify(message: string, kind: 'error' | 'success' = 'error') {
    hideNotification();
    element(kind).textContent = message;
    element(kind).hidden = false;
    element('notification').dataset.kind = kind;
    element('notification').hidden = false;
    notificationTimer = setTimeout(hideNotification, kind === 'error' ? 10000 : 4500);
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir.';
element('dismiss-notification').addEventListener('click', hideNotification);
const isPanel = new URLSearchParams(window.location.search).get('view') === 'panel';
void setupAiPanel(notify,isPanel,undefined,{view:()=>view,progress:value=>{if(value?.status==='running')aiProgressSuppressed=false;if(!aiProgressSuppressed)aiProgress=value;},busy:value=>{aiBusy=value;render();}}).catch(()=>notify('Não foi possível iniciar a IA no painel.'));
document.body.classList.toggle('side-panel', isPanel);
function syncDisplayIcon() {
    const button=element<HTMLButtonElement>('display-mode'),label=isPanel?'Usar popup':'Abrir painel lateral';
    button.setAttribute('aria-label',label);button.title=label;
    element('display-icon-panel').toggleAttribute('hidden',isPanel);
    element('display-icon-popup').toggleAttribute('hidden',!isPanel);
}
syncDisplayIcon();
function render() {
    element<HTMLButtonElement>('display-mode').disabled=busy||aiBusy;
    if (view) {
        renderCatalog(view, busy||aiBusy,aiProgress);
        const message = [view.error, view.statsError].filter(Boolean).join(' ');
        if (message && message !== lastBackgroundError) notify(message);
        lastBackgroundError = message;
    }
}
async function act(callback: () => Promise<unknown>) {
    if (busy||aiBusy)
        return;
    busy = true;
    hideNotification();
    render();
    try {
        await callback();
    }
    catch (error) {
        notify(errorMessage(error));
    }
    finally {
        busy = false;
        render();
    }
}
async function request(type: string, extra: Record<string, unknown> = {}) {
    const current=['PREPARE','START','FOCUS','ATTACH'].includes(type)?await chrome.windows.getCurrent():undefined;
    const reply = await chrome.runtime.sendMessage({
        type, ...extra,...(current?.id!==undefined?{hostWindowId:current.id}:{})
    });
    if (reply.error)
        throw new Error(reply.error);
    return reply.value;
}
async function send(type: string, extra: Record<string, unknown> = {}) {
    if(['START','ATTACH'].includes(type)){aiProgress=undefined;aiProgressSuppressed=true;}
    view = await request(type, extra);
    render();
    if(type==='REFRESH')document.dispatchEvent(new window.Event('catalog-config-updated'));
    if (type === 'REFRESH' && !view?.error && !view?.statsError) notify('Configurações atualizadas.', 'success');
}
element('display-mode').addEventListener('click', () => {
    void act(async () => {
        const mode = isPanel ? 'popup' : 'panel';
        if (mode === 'panel') {
            const current = await chrome.windows.getCurrent();
            if (current.id === undefined)
                throw new Error('Janela não encontrada.');
            await chrome.sidePanel.setOptions({
                enabled: true
            });
            await chrome.sidePanel.open({
                windowId: current.id
            });
        }
        await request('DISPLAY_MODE', {
            mode
        });
        window.close();
    }).finally(() => {
        syncDisplayIcon();
    });
});
for (const [id, type] of Object.entries({
    login: 'LOGIN', logout: 'LOGOUT', refresh: 'REFRESH', pause: 'PAUSE', resume: 'RESUME', focus: 'FOCUS'
}))
    element(id).addEventListener('click', () => {
        void act(() => send(type));
    });
element('cancel').addEventListener('click',()=>{if(aiBusy)document.dispatchEvent(new Event('cancel-ai-review'));else void act(()=>send('CANCEL'));});
const marketplace = () => element<HTMLSelectElement>('marketplace').value;
for(const id of ['marketplace','retry-failed'])element(id).addEventListener('change',()=>{const marketplaceId=marketplace(),retryFailed=element<HTMLInputElement>('retry-failed').checked;void act(()=>send('FILTER',{marketplaceId,retryFailed}));});
async function grant() {
    const market = view?.markets.find(m => m.id === marketplace());
    if (!market)
        throw new Error('Escolha um marketplace.');
    if (!await chrome.permissions.request({
        origins: market.allowedOrigins.map(o => o + '/*')
    }))
        throw new Error('Permissão de acesso não concedida.');
}
element('prepare').addEventListener('click', () => {
    void act(async () => {
        await grant();
        await send('PREPARE', {
            marketplaceId: marketplace()
        });
    });
});
for (const step of ['discover', 'convert', 'enrich', 'prices'])
    element('step-' + step).addEventListener('click', () => {
        void act(async () => {
            const limit = Number(element<HTMLInputElement>('limit').value);
            if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
                throw new Error('Informe um limite entre 1 e 10000.');
            await grant();
            await send('START', {
                step, marketplaceId: marketplace(), limit, retryFailed: element<HTMLInputElement>('retry-failed').checked
            });
        });
    });
element('pick-elements').addEventListener('click', () => {
    void act(async () => {
        await launchSelectorPicker();
        if (!isPanel)
            window.close();
    });
});
element('settings').addEventListener('submit', event => {
    event.preventDefault();
    void act(async () => {
        const url = backendOrigin(element<HTMLInputElement>('backend').value);
        if (!await chrome.permissions.request({
            origins: [url + '/*']
        }))
            throw new Error('Permissão não concedida.');
        await send('BACKEND', {
            url
        });
    });
});
async function runs() {
    const size = Number(element<HTMLSelectElement>('runs-size').value), data = await request('RUNS', {
        page, pageSize: size
    });
    page = data.page;
    total = data.total;
    element('runs-page').textContent = `${page} / ${Math.max(1, Math.ceil(total / size))}`;
    element<HTMLButtonElement>('runs-previous').disabled = page <= 1;
    element<HTMLButtonElement>('runs-next').disabled = page * size >= total;
    element('runs').replaceChildren(...data.items.map((run: any) => {
        const row = document.createElement('li'), button = document.createElement('button');
        button.className = 'secondary';
        button.textContent = stepLabel(run.step) + ' · ' + runLabel(run.status) + ' · ' + new Date(run.created_at).toLocaleString('pt-BR');
        button.addEventListener('click', () => {
            void act(() => send('ATTACH', {
                runId: run.id
            }));
        });
        row.append(button);
        return row;
    }));
}
element('load-runs').addEventListener('click', () => {
    void act(runs);
});
element('runs-previous').addEventListener('click', () => {
    page = Math.max(1, page - 1);
    void act(runs);
});
element('runs-next').addEventListener('click', () => {
    page++;
    void act(runs);
});
element('runs-size').addEventListener('change', () => {
    page = 1;
    void act(runs);
});
await act(() => send('STATE'));
setInterval(() => {
    if (!busy)
        void send('STATE').then(() => { lastPollingError = ''; }).catch(error => {
            const message = errorMessage(error);
            if (message !== lastPollingError) notify(message);
            lastPollingError = message;
        });
}, 2000);
