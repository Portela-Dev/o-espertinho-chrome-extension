import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

test('selecionar elementos mantém painel aberto e alternância solicita popup ao worker', async () => {
  const page = new Window({ url: 'chrome-extension://test/popup.html?view=panel' });
  globalThis.window = page;
  globalThis.document = page.document;
  document.write(await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  let injected = 0, closed = 0;
  const messages = [];
  const view = { backendUrl: 'http://localhost:3000', pairing: false,
    progress: { status: 'idle', success: 0, failed: 0, total: 0, message: '' }, version: '0.2.0' };
  globalThis.chrome = {
    runtime: { sendMessage: async message => { messages.push(message); return { value: view }; } },
    tabs: { query: async () => [{ id: 12, url: 'https://shop.test/products' }] },
    scripting: { executeScript: async () => { injected++; } },
    permissions: { request: async () => true },
  };
  page.close = () => { closed++; };
  const originalInterval = globalThis.setInterval;
  globalThis.setInterval = () => 1;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  try {
    await import('../dist/popup.js');
    assert.equal(document.body.classList.contains('side-panel'), true);
    assert.equal(document.getElementById('display-mode').value, 'panel');
    document.getElementById('pick-elements').click();
    await tick();
    assert.equal(injected, 1);
    assert.equal(closed, 0);
    document.getElementById('display-mode').value = 'popup';
    document.getElementById('apply-display-mode').click();
    await tick();
    assert.ok(messages.some(message => message.type === 'DISPLAY_MODE' && message.mode === 'popup'));
    assert.equal(closed, 1);
  } finally {
    globalThis.setInterval = originalInterval;
  }
});
