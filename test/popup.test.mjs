import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { renderView } from "../dist/popup-view.js";
import { configuration, account } from "./fixtures.mjs";
const window = new Window({ url: "chrome-extension://test/popup.html" });
for (const key of ["window", "document", "Event"]) {
  globalThis[key] = window[key];
}
document.write(
  await readFile(new URL("../extension/popup.html", import.meta.url), "utf8"),
);
const initial = () => ({
  backendUrl: "http://localhost:3000",
  pairing: false,
  marketplaceId: "demo",
  config: structuredClone(configuration),
  progress: {
    status: "idle",
    success: 0,
    failed: 0,
    total: 3,
    message: "Ready",
  },
  version: "0.2.0",
});
const el = (id) => document.getElementById(id);

test("popup renderiza login, pareamento, progresso e resultados sem executar HTML", () => {
  const view = initial();
  renderView(view, false);
  assert.equal(el("workspace").hidden, true);
  assert.equal(el("login").hidden, false);
  view.pairing = true;
  renderView(view, false);
  assert.equal(el("login").disabled, true);
  assert.equal(el("logout").hidden, false);
  view.user = account;
  view.pairing = false;
  view.marketplaceId = "demo";
  view.progress.status = "running";
  view.progress.currentTitle = "Current";
  view.progress.success = 1;
  view.queue = {
    items: [
      {
        id: "1",
        title: "<script>bad</script>",
        state: "done",
        affiliateUrl: "https://shop.test/one",
      },
      {
        id: "2",
        title: "Unsafe",
        state: "failed",
        affiliateUrl: "javascript:alert(1)",
      },
      { id: "3", title: "Malformed", state: "other", affiliateUrl: "invalid" },
      { id: "4", title: "Failed", state: "failed", error: "Technical error" },
    ],
  };
  renderView(view, false);
  assert.equal(el("start").disabled, true);
  assert.equal(el("progress").value, 1);
  assert.equal(el("results").querySelectorAll("script").length, 0);
  assert.equal(el("results").querySelectorAll("a").length, 1);
  view.progress.status = "paused";
  renderView(view, true);
  assert.equal(el("start").disabled, true);
  assert.equal(el("pause").disabled, true);
  const backend = el("backend");
  backend.disabled = false;
  backend.focus();
  backend.value = "https://editing.test";
  renderView(view, false);
  assert.equal(backend.value, "https://editing.test");
  view.config = undefined;
  view.queue = undefined;
  view.user = undefined;
  renderView(view, false);
  assert.equal(el("marketplace").options.length, 0);
  assert.equal(el("results").children.length, 0);
});
test("eventos da interface enviam comandos e apresentam erros da API", async () => {
  let current = initial(),
    callback,
    replyError;
  const messages = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        return replyError
          ? { error: replyError }
          : { value: structuredClone(current) };
      },
    },
    permissions: { request: async () => true },
  };
  const originalInterval = globalThis.setInterval;
  globalThis.setInterval = (fn) => {
    callback = fn;
    return 1;
  };
  try {
    await import("../dist/popup.js");
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    for (const id of [
      "login",
      "logout",
      "refresh",
      "pause",
      "reset",
      "open",
      "start",
    ]) {
      el(id).click();
      await tick();
    }
    assert.ok(
      messages.some((message) => message.type === "START"),
      JSON.stringify({
        commands: messages.map((m) => m.type),
        error: el("error").textContent,
        disabled: el("start").disabled,
      }),
    );
    assert.ok(messages.some((message) => message.type === "OPEN"));
    el("backend").value = "https://api.test";
    el("settings").dispatchEvent(
      new window.Event("submit", { cancelable: true }),
    );
    await tick();
    assert.ok(messages.some((message) => message.type === "BACKEND"));
    replyError = "Denied";
    el("refresh").click();
    await tick();
    assert.equal(el("error").hidden, false);
    assert.equal(el("error").textContent, "Denied");
    replyError = undefined;
    chrome.permissions.request = async () => false;
    el("start").click();
    await tick();
    assert.equal(el("error").hidden, false);
    current = { ...current, config: undefined };
    callback();
    await tick();
    el("open").click();
    await tick();
    assert.equal(el("error").hidden, false);
    current.progress.status='idle';callback();await tick();let injections=0,closed=0;
    chrome.tabs={query:async()=>[{id:12,url:'https://shop.test/products'}]};
    chrome.scripting={executeScript:async()=>{injections++;}};
    window.close=()=>{closed++;};
    el('pick-elements').click();await tick();assert.equal(injections,1);assert.equal(closed,1);
    chrome.tabs.query=async()=>[{id:12,url:'chrome://extensions'}];el('pick-elements').click();await tick();assert.equal(el('error').hidden,false);
    await tick();
  } finally {
    globalThis.setInterval = originalInterval;
  }
});
