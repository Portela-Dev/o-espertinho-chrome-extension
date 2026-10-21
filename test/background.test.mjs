import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.mjs";

test("eventos do Chrome aceitam somente paginas internas e encaminham erros", async () => {
  const f = fixture({ auth: undefined });
  globalThis.chrome = f.browser;
  await import("../dist/background.js");
  const call = (message, sender) =>
    new Promise((resolve) => {
      f.listeners.message(message, sender, resolve);
    });
  const valid = {
    id: f.browser.runtime.id,
    url: `chrome-extension://${f.browser.runtime.id}/popup.html`,
  };
  assert.equal(
    (await call({ type: "STATE" }, { id: "other", url: "https://evil.test" }))
      .error,
    "Origem não autorizada.",
  );
  assert.equal((await call({ type: "STATE" }, valid)).value.version, "0.2.0");
  assert.equal((await call({type:'AI_SESSION',operation:'token',payload:{sessionId:'fake'}},{id:f.browser.runtime.id,url:'https://evil.test'})).error,'Origem não autorizada.');
  assert.match((await call({type:'AI_SESSION',operation:'unknown'},valid)).error,/inválida/);
  assert.ok((await call({ type: "UNKNOWN" }, valid)).error);
  assert.equal((await call({ type: "DISPLAY_MODE", mode: "popup" }, valid)).error, undefined);
  assert.match((await call({ type: "DISPLAY_MODE", mode: "invalid" }, valid)).error, /inválida/);
  f.listeners.installed();
  f.listeners.startup();
  f.listeners.alarm({ name: "other" });
  f.listeners.alarm({ name: "worker" });
  await new Promise((resolve) => setImmediate(resolve));
});
