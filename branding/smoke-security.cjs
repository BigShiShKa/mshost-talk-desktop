/* SPDX-FileCopyrightText: 2026 MSHost contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later */
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mshost-security-'))
app.setPath('userData', profile)
app.whenReady().then(async () => {
	let window
	try {
		const { CredentialStore } = require('../src/app/credentialStore.js')
		const store = new CredentialStore()
		const account = { server: 'https://cloud.mshostcloud.org', user: 'synthetic', password: 'SYNTHETIC_DPAPI_SECRET' }
		store.set(account)
		assert(!fs.readFileSync(store.file, 'utf8').includes(account.password))
		assert.equal(new CredentialStore().get(account.server).password, account.password)
		store.clear()
		const partition = session.fromPartition('mshost-security')
		partition.protocol.handle('https', () => new Response('<!doctype html><title>Security test</title>'))
		window = new BrowserWindow({ show: false, webPreferences: { session: partition, contextIsolation: true, sandbox: true } })
		const module = { exports: {} }
		const source = fs.readFileSync(path.join(__dirname, '../src/app/externalLinkHandlers.ts'), 'utf8')
		const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
		const external = url => {
			const parsed = new URL(url)
			return parsed.origin !== account.server || !parsed.pathname.startsWith('/talk_desktop__')
		}
		const opened = []
		new Function('require', 'exports', 'module', code)(name => {
			if (name === 'electron') return { shell: { openExternal: async url => opened.push(url) } }
			if (name === './AppData.js') return { appData: { serverUrl: account.server } }
			if (name === './utils.ts') return { isExternalUrl: external }
			throw new Error('Unexpected dependency')
		}, module.exports, module)
		module.exports.applyExternalLinkHandler(window)
		await window.loadURL(account.server + '/talk_desktop__window_talk/index.html')
		const url = account.server + "/call/example#';globalThis.auditMarker=true;//"
		await window.webContents.executeJavaScript(`window.location.href = ${JSON.stringify(url)}`)
		await new Promise(resolve => setTimeout(resolve, 1500))
		assert.equal(await window.webContents.executeJavaScript('window.location.hash'), "#/call/example#';globalThis.auditMarker=true;//")
		assert.equal(await window.webContents.executeJavaScript('globalThis.auditMarker'), undefined)
		assert.equal(opened.length, 0)
		console.log('PASS: real Electron safeStorage round-trip and isolated renderer navigation; no server or real account used')
	} catch (error) {
		console.error(error)
		process.exitCode = 1
	} finally {
		window?.destroy()
		app.quit()
	}
})
