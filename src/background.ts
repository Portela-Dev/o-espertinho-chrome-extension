import { ExtensionRuntime } from "./runtime.js";
const runtime = new ExtensionRuntime();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  ) {
    respond({ error: "Origem não autorizada." });
    return false;
  }
  runtime
    .handle(message)
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
