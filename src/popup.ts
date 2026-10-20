import {launchSelectorPicker} from './picker-launcher.js';
import { backendOrigin } from "./contracts.js";
import { renderView, type View } from "./popup-view.js";
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let view: View | undefined;
let busy = false;
const isPanel = new URLSearchParams(window.location.search).get('view') === 'panel';
document.body.classList.toggle('side-panel', isPanel);
element<HTMLInputElement>('display-mode').checked = isPanel;
element('display-mode').addEventListener('change', () => {
  void act(async () => {
    const mode = element<HTMLInputElement>('display-mode').checked ? 'panel' : 'popup';
    if (mode === (isPanel ? 'panel' : 'popup')) return;
    if (mode === 'panel') {
      const currentWindow = await chrome.windows.getCurrent();
      if (currentWindow.id === undefined) throw new Error('Janela do navegador não encontrada.');
      // Open while the user gesture is active; enabling is needed after popup mode.
      await chrome.sidePanel.setOptions({ enabled: true });
      await chrome.sidePanel.open({ windowId: currentWindow.id });
    }
    const reply = await chrome.runtime.sendMessage({ type: 'DISPLAY_MODE', mode });
    if (reply.error) throw new Error(reply.error);
    window.close();
  }).finally(() => { element<HTMLInputElement>('display-mode').checked = isPanel; });
});
async function send(type: string, extra: Record<string, unknown> = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...extra });
  if (reply.error) throw new Error(type==='PROOF_BATCH'&&reply.error==='Operação desconhecida.'?'Recarregue a extensão em chrome://extensions para atualizar o serviço de segundo plano e iniciar o lote.':reply.error);
  view = reply.value as View;
  render();
}
function render() {
  element<HTMLButtonElement>('pick-elements').disabled=busy||view?.progress.status==='running';
  if (view) {
    renderView(view, busy);
  }
}
async function act(callback: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  element("error").hidden = true;
  render();
  try {
    await callback();
  } catch (error) {
    element("error").textContent =
      error instanceof Error ? error.message : "Não foi possível concluir.";
    element("error").hidden = false;
  } finally {
    busy = false;
    render();
  }
}
const marketplace = () => element<HTMLSelectElement>("marketplace").value;
async function grantOrigins(origins: string[]) {
  if (
    !(await chrome.permissions.request({
      origins: origins.map((o) => `${o}/*`),
    }))
  )
    throw new Error("Permissão de acesso aos domínios não concedida.");
}
element("login").addEventListener("click", () => {
  void act(() => send("LOGIN"));
});
element("logout").addEventListener("click", () => {
  void act(() => send("LOGOUT"));
});
element("refresh").addEventListener("click", () => {
  void act(() => send("REFRESH"));
});
element("pause").addEventListener("click", () => {
  void act(() => send("PAUSE"));
});
element("reset").addEventListener("click", () => {
  void act(() => send("RESET"));
});
element("open").addEventListener("click", () => {
  void act(async () => {
    const recipe = view?.config?.marketplaces.find(
      (m) => m.id === marketplace(),
    );
    if (!recipe) throw new Error("Escolha um marketplace.");
    await grantOrigins(recipe.allowedOrigins);
    await send("OPEN", { marketplaceId: recipe.id });
  });
});
element("start").addEventListener("click", () => {
  void act(async () => {
    const recipe = view?.config?.marketplaces.find(
      (m) => m.id === marketplace(),
    );
    if (!recipe) throw new Error("Escolha um marketplace.");
    await grantOrigins(recipe.allowedOrigins);
    await send("START", { marketplaceId: recipe.id });
  });
});
element("settings").addEventListener("submit", (event) => {
  event.preventDefault();
  void act(async () => {
    const url = backendOrigin(element<HTMLInputElement>("backend").value);
    await grantOrigins([url]);
    await send("BACKEND", { url });
  });
});
element('pick-elements').addEventListener('click',()=>{void act(async()=>{await launchSelectorPicker();if(!isPanel)window.close();});});
const proofMarket=()=>view?.proofMarkets?.find(m=>m.id===element<HTMLSelectElement>('proof-marketplace').value);
const affiliateMarket=()=>view?.affiliateConfig?.marketplaces.find(m=>m.id===element<HTMLSelectElement>('affiliate-marketplace').value);
element('affiliate-load').addEventListener('click',()=>{void act(()=>send('AFFILIATE_LOAD'));});
element('affiliate-arm').addEventListener('click',()=>{void act(async()=>{const recipe=affiliateMarket();if(!recipe)throw new Error('Escolha um marketplace.');await grantOrigins(recipe.allowedOrigins);await send('AFFILIATE_ARM',{marketplaceId:recipe.id});});});
element('affiliate-start').addEventListener('click',()=>{void act(()=>send('AFFILIATE_START',{marketplaceId:affiliateMarket()?.id}));});
element('affiliate-enrich').addEventListener('click',()=>{void act(()=>send('AFFILIATE_ENRICH'));});
element('affiliate-refresh').addEventListener('click',()=>{void act(()=>send('AFFILIATE_REFRESH'));});
element('affiliate-reset').addEventListener('click',()=>{void act(()=>send('AFFILIATE_RESET'));});
element('proof-batch').addEventListener('change',render);
element('proof-load').addEventListener('click',()=>{void act(()=>send('PROOF_MARKETS'));});
element('proof-marketplace').addEventListener('change',()=>{element<HTMLInputElement>('proof-url').value=proofMarket()?.testUrl||'';element<HTMLInputElement>('proof-consent').checked=false;render();});
element('proof-open').addEventListener('click',()=>{void act(async()=>{const market=proofMarket();if(!market)throw new Error('Escolha um marketplace.');await grantOrigins(market.allowedOrigins);await send('PROOF_OPEN',{marketplaceId:market.id});});});
element('proof-capture').addEventListener('click',()=>{void act(async()=>{
 const market=proofMarket();if(!market)throw new Error('Escolha um marketplace.');
 if(!element<HTMLInputElement>('proof-consent').checked)throw new Error('Confirme o envio temporário da sessão para este teste.');
 if(!await chrome.permissions.request({permissions:['cookies'],origins:market.allowedOrigins.map(o=>o+'/*')}))throw new Error('Permissão de cookies e domínios não concedida.');
 await send(element<HTMLInputElement>('proof-batch').checked?'PROOF_BATCH':'PROOF_CAPTURE',{marketplaceId:market.id,url:element<HTMLInputElement>('proof-url').value,consent:true,includeStorage:element<HTMLInputElement>('proof-storage').checked});
 element<HTMLInputElement>('proof-consent').checked=false;
});});
await act(() => send("STATE"));
setInterval(() => {
  if (!busy)
    void send("STATE").catch(() => {
      /* A próxima consulta tentará reconectar ao worker. */
    });
}, 2000);
