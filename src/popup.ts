import { launchSelectorPicker } from './picker-launcher.js';
import { backendOrigin } from './contracts.js';
import { renderCatalog, runLabel,stepLabel, type CatalogView } from './catalog-view.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let view: CatalogView | undefined, busy = false, page = 1, total = 0;
const isPanel = new URLSearchParams(window.location.search).get('view') === 'panel';
document.body.classList.toggle('side-panel', isPanel);
function syncDisplayIcon() {
    const button=element<HTMLButtonElement>('display-mode'),label=isPanel?'Usar popup':'Abrir painel lateral';
    button.setAttribute('aria-label',label);button.title=label;
    element('display-icon-panel').toggleAttribute('hidden',isPanel);
    element('display-icon-popup').toggleAttribute('hidden',!isPanel);
}
syncDisplayIcon();
function render() {
    element<HTMLButtonElement>('display-mode').disabled=busy;
    if (view)
        renderCatalog(view, busy);
}
async function act(callback: () => Promise<unknown>) {
    if (busy)
        return;
    busy = true;
    element('error').hidden = true;
    render();
    try {
        await callback();
    }
    catch (error) {
        element('error').textContent = error instanceof Error ? error.message : 'Não foi possível concluir.';
        element('error').hidden = false;
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
    view = await request(type, extra);
    render();
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
    login: 'LOGIN', logout: 'LOGOUT', refresh: 'REFRESH', pause: 'PAUSE', resume: 'RESUME', cancel: 'CANCEL', focus: 'FOCUS'
}))
    element(id).addEventListener('click', () => {
        void act(() => send(type));
    });
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
        void send('STATE').catch(() => {
        });
}, 2000);
