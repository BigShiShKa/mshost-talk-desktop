// SPDX-FileCopyrightText: 2026 MSHost contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

async function navigationEvidence() {
  const source = read('src/app/externalLinkHandlers.ts');
  const utils = read('src/app/utils.ts');
  const route = source.slice(source.indexOf('function tryExtractTalkRoute('), source.indexOf('/**\n * Apply external'))
    .replace('link: string', 'link');
  const navigate = source.slice(source.indexOf('async function willNavigateExternalLinkHandler('))
    .replace('event: Event<WebContentsWillNavigateEventParams>', 'event');
  const internal = utils.slice(utils.indexOf('export function isInternalUrl('), utils.indexOf('/**\n * Check whether a link is not'))
    .replace('export function', 'function').replace('url: string | URL', 'url');
  const external = utils.slice(utils.indexOf('export function isExternalUrl('), utils.indexOf('/**\n * Determine title bar'))
    .replace('export function', 'function').replace('url: string | URL', 'url');
  const regex = source.split('\n').find(line => line.startsWith('const talkPathRe ='));
  assert(regex && route && navigate && internal && external);
  const context = {
    URL, window: { location: {} },
    appData: { serverUrl: 'https://cloud.mshostcloud.org' },
    process: { env: {} }, shell: { openExternal: async () => {} }, console,
  };
  vm.createContext(context);
  vm.runInContext([regex, internal, external, route, navigate].join('\n'), context);
  let scripts = 0;
  const run = async (url, initiatorUrl = "https://cloud.mshostcloud.org/talk_desktop__window_talk/index.html") => {
    context.auditEvent = {
      url, preventDefault() {},
      initiator: {
        url: initiatorUrl,
        async executeJavaScript(code) { scripts++; vm.runInContext(code, context); },
        reload() {},
      },
    };
    await vm.runInContext('willNavigateExternalLinkHandler(auditEvent)', context);
  };
  await run('https://cloud.mshostcloud.org/call/example#ordinary');
  assert.equal(context.window.location.hash, '#/call/example#ordinary');
  assert.equal(context.auditMarker, undefined);
  await run("https://cloud.mshostcloud.org/call/example#';globalThis.auditMarker=true;//");
  assert.equal(scripts, 2);
  assert.equal(context.auditMarker, undefined);
  assert.equal(context.window.location.hash, "#/call/example#';globalThis.auditMarker=true;//");
  for (const invalid of ["/apps/spreed/extra", "/prefix/call/example", "/call/example/extra"]) {
    await run("https://cloud.mshostcloud.org" + invalid);
  }
  assert.equal(scripts, 2);
  await run('https://cloud.mshostcloud.org/call/example', 'https://untrusted.invalid/talk_desktop__window_talk/index.html');
  assert.equal(scripts, 2);
  return { originalUrlChecksUsed: true, benignControlPassed: true, injectedMarkerExecuted: false };
}

function credentialEvidence() {
  const source = read('src/app/AppData.js')
    .replace('export class AppData', 'class AppData')
    .replace('export const appData', 'const appData');
  let stored;
  const context = { localStorage: { setItem(key, value) { stored = { key, value }; } }, console };
  vm.createContext(context);
  vm.runInContext(source + "\nappData.credentials = {user:'audit-user',password:'AUDIT_SENTINEL_NOT_A_SECRET'}; appData.persist();", context);
  assert.equal(JSON.parse(stored.value).credentials.password, undefined);
  assert(!stored.value.includes('AUDIT_SENTINEL_NOT_A_SECRET'));
  return { syntheticCredentialStoredAsPlainJson: false, realProfileRead: false };
}


async function notificationAuthEvidence() {
  const store = read('src/talk/renderer/notifications/notifications.store.js');
  const call = store.slice(store.indexOf('const hasPush = listen('), store.indexOf('if (hasPush)'));
  let options;
  const sent = [];
  let preAuthRequests = 0;
  const context = {
    console, window: { _notify_push_listeners: {} },
    appData: { credentials: { user: 'synthetic', password: 'SYNTHETIC_APP_PASSWORD' } },
    _fetchAfterNotifyPush() {},
    listen(name, callback, value) { options = value; return false; },
    getCapabilities: () => ({ notify_push: { endpoints: { pre_auth: '/pre_auth', websocket: 'wss://synthetic.invalid' } } }),
    axios: { post: async url => { assert.equal(url, '/pre_auth'); preAuthRequests++; return { data: 'EPHEMERAL_TOKEN' }; } },
    WebSocket: function () { this.send = value => sent.push(value); },
  };
  vm.createContext(context);
  vm.runInContext(call, context);
  assert.equal(options?.credentials, undefined);
  const library = read('node_modules/@nextcloud/notify_push/dist/index.js');
  vm.runInContext(library.slice(library.indexOf('async function setupSocket(')), context);
  await vm.runInContext('setupSocket()', context);
  context.window._notify_push_ws.onopen();
  assert.equal(preAuthRequests, 1);
  assert.deepEqual(sent, ['', 'EPHEMERAL_TOKEN']);
  return { ephemeralPreAuthUsed: true, appPasswordSentByRenderer: false };
}

(async () => {
  console.log(JSON.stringify({ navigation: await navigationEvidence(), credentials: credentialEvidence(), notificationAuth: await notificationAuthEvidence(), realElectronOrServerUsed: false }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
