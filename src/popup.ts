import {launchSelectorPicker} from './picker-launcher.js';
import { backendOrigin } from "./contracts.js";
import { renderView, type View } from "./popup-view.js";
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let view: View | undefined;
let busy = false;
async function send(type: string, extra: Record<string, unknown> = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...extra });
  if (reply.error) throw new Error(reply.error);
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
element('pick-elements').addEventListener('click',()=>{void act(async()=>{await launchSelectorPicker();window.close();});});
await act(() => send("STATE"));
setInterval(() => {
  if (!busy)
    void send("STATE").catch(() => {
      /* A próxima consulta tentará reconectar ao worker. */
    });
}, 2000);
