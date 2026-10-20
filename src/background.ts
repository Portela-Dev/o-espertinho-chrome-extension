import { CatalogRuntime } from "./catalog-runtime.js";
import { restoreDisplayMode, saveDisplayMode } from "./display-mode.js";
const runtime = new CatalogRuntime();
// MV3 service workers must register listeners synchronously, without top-level await.
async function restoreModeSafely(){
  try { await restoreDisplayMode(); } catch { console.error("Não foi possível restaurar a visualização da extensão."); }
}
void restoreModeSafely();
chrome.webRequest.onBeforeSendHeaders.addListener(details=>{void runtime.observeAffiliateHeaders(details).catch(()=>{});},{urls:['https://*/*'],types:['xmlhttprequest']},['requestHeaders']);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  ) {
    respond({ error: "Origem não autorizada." });
    return false;
  }
  const result = message?.type === "DISPLAY_MODE"
    ? saveDisplayMode(message.mode)
    : runtime.handle(message);
  result
    .then((value) => respond({ value }))
    .catch((error) =>
      respond({
        error:
          error instanceof Error ? error.message : "Operação não concluída.",
      }),
    );
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "worker") {
    void runtime.pump();
  }
});
chrome.runtime.onStartup.addListener(() => {
  void runtime.pump();
});
chrome.runtime.onInstalled.addListener(() => {
  void runtime.init();
});
