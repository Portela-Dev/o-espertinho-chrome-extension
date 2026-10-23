import test from 'node:test';
import assert from 'node:assert/strict';
import { configureDisplayMode, restoreDisplayMode, saveDisplayMode } from '../dist/display-mode.js';

test('painel padrão, preferência persistida e restauração do popup após reinício', async () => {
  const saved = {}, calls = [];
  const browser = {
    storage: { local: {
      get: async () => saved,
      set: async value => { Object.assign(saved, value); calls.push(['saved', value]); },
    } },
    sidePanel: {
      setOptions: async value => calls.push(['options', value]),
      setPanelBehavior: async value => calls.push(['behavior', value]),
    },
    action: { setPopup: async value => calls.push(['popup', value]) },
  };
  await restoreDisplayMode(browser);
  assert.deepEqual(calls, [
    ['options', { enabled: true }], ['popup', { popup: '' }],
    ['behavior', { openPanelOnActionClick: true }],
  ]);
  calls.length = 0;
  await saveDisplayMode('popup', browser);
  assert.equal(saved.displayMode, 'popup');
  assert.equal(calls[0][0], 'saved');
  assert.deepEqual(calls.at(-1), ['behavior', { openPanelOnActionClick: false }]);
  calls.length = 0;
  await restoreDisplayMode(browser);
  assert.deepEqual(calls[1], ['popup', { popup: 'popup.html' }]);
  await saveDisplayMode('panel', browser);
  assert.equal(saved.displayMode, 'panel');
  await assert.rejects(saveDisplayMode('invalid', browser), /inválida/);
  await assert.rejects(configureDisplayMode('invalid', browser), /inválida/);
  assert.equal(saved.displayMode, 'panel');
});
