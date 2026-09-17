import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE } from '../src/shared/constants.js';
import { webSearch, run } from '../src/background/actions.js';

// actions.js reads `chrome` off the global at call time, so a fresh mock per
// test is enough; no need to re-import the module.
beforeEach(() => {
  globalThis.chrome = {
    search: {
      query: async () => {},
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 10 }],
      create: async () => {},
      update: async () => {},
    },
    windows: {
      getLastFocused: async () => ({ id: 10 }),
      update: async () => {},
      create: async () => {},
    },
  };
});

test('webSearch opens the current tab when the disposition is "current"', async () => {
  const calls = [];
  chrome.search.query = async (options) => calls.push(options);

  await webSearch('brave', 'current');

  assert.deepEqual(calls, [{ text: 'brave', disposition: 'CURRENT_TAB' }]);
});

test('webSearch opens a new tab when the disposition is "newTab"', async () => {
  const calls = [];
  chrome.search.query = async (options) => calls.push(options);

  await webSearch('brave', 'newTab');

  assert.deepEqual(calls, [{ text: 'brave', disposition: 'NEW_TAB' }]);
});

test('webSearch opens a new window when the disposition is "newWindow"', async () => {
  const calls = [];
  chrome.search.query = async (options) => calls.push(options);

  await webSearch('brave', 'newWindow');

  assert.deepEqual(calls, [{ text: 'brave', disposition: 'NEW_WINDOW' }]);
});

test('webSearch falls back to the current tab when chrome.search.query throws and the disposition is "current"', async () => {
  chrome.search.query = async () => {
    throw new Error('search API unavailable');
  };
  const updates = [];
  chrome.tabs.update = async (tabId, changeInfo) => updates.push([tabId, changeInfo]);
  chrome.tabs.create = async () => assert.fail('should not open a new tab');

  await webSearch('brave', 'current');

  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 1);
  assert.match(updates[0][1].url, /search\.brave\.com/);
});

test('webSearch falls back to a new tab when chrome.search.query throws and the disposition is "newTab"', async () => {
  chrome.search.query = async () => {
    throw new Error('search API unavailable');
  };
  const created = [];
  chrome.tabs.create = async (options) => created.push(options);
  chrome.tabs.update = async () => assert.fail('should not update the current tab');

  await webSearch('brave', 'newTab');

  assert.equal(created.length, 1);
  assert.match(created[0].url, /search\.brave\.com/);
});

// This is the regression covered by the "home panel falls back to a web
// search and always opens a new tab" bug: run() must pass the disposition it
// was given through to webSearch instead of dropping it.
test('run() passes the disposition through to webSearch for a search result', async () => {
  const calls = [];
  chrome.search.query = async (options) => calls.push(options);

  await run({ result: { type: SOURCE.SEARCH, query: 'brave' }, disposition: 'current' });

  assert.deepEqual(calls, [{ text: 'brave', disposition: 'CURRENT_TAB' }]);
});

test('run() still opens a new tab for a search result when the disposition is "newTab"', async () => {
  const calls = [];
  chrome.search.query = async (options) => calls.push(options);

  await run({ result: { type: SOURCE.SEARCH, query: 'brave' }, disposition: 'newTab' });

  assert.deepEqual(calls, [{ text: 'brave', disposition: 'NEW_TAB' }]);
});
