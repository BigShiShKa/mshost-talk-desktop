/* SPDX-FileCopyrightText: 2026 MSHost contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')

async function main() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mshost-credentials-'))
	const key = crypto.randomBytes(32)
	let available = true
	const safeStorage = {
		isEncryptionAvailable: () => available,
		encryptString(value) {
			const iv = crypto.randomBytes(16)
			const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
			return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()])
		},
		decryptString(value) {
			const cipher = crypto.createDecipheriv('aes-256-cbc', key, value.subarray(0, 16))
			return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString('utf8')
		},
	}
	const module = { exports: {} }
	const context = { module, Buffer, process, URL, require: name => name === 'electron'
		? { app: { getPath: () => directory }, safeStorage } : require(name) }
	try {
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/app/credentialStore.js'), 'utf8'), context)
		const { CredentialStore } = module.exports
		const store = new CredentialStore()
		const credentials = { server: 'https://cloud.mshostcloud.org', user: 'test', password: 'SYNTHETIC_SECRET_123' }
		const metadata = store.set(credentials)
		assert.equal(metadata.password, undefined)
		assert(!fs.readFileSync(store.file, 'utf8').includes(credentials.password))
		assert.equal(new CredentialStore().get(credentials.server).password, credentials.password)
		assert.equal(store.get('https://other.invalid'), null)
		available = false
		assert.throws(() => store.set(credentials), /unavailable/)
		assert.throws(() => store.get(credentials.server), /unavailable/)
		available = true
		assert.throws(() => store.set({ ...credentials, server: 'http://insecure.invalid' }), /Invalid/)

		let local = JSON.stringify({ credentials, serverUrl: credentials.server })
		const appContext = { console, localStorage: { getItem: () => local, setItem: (key, value) => { local = value } },
			window: { TALK_DESKTOP: { restoreCredentials: async (server, legacy) => store.set(legacy) } } }
		const source = fs.readFileSync(path.join(__dirname, '../src/app/AppData.js'), 'utf8')
			.replace('export class AppData', 'class AppData').replace('export const appData', 'const appData')
		vm.createContext(appContext)
		vm.runInContext(source, appContext)
		await vm.runInContext('appData.restore()', appContext)
		assert(!local.includes(credentials.password))
		assert.equal(JSON.parse(local).credentials.user, credentials.user)
		assert.equal(vm.runInContext('appData.credentials.password', appContext), undefined)
		assert.equal(store.get(credentials.server).password, credentials.password)
		store.clear()
		assert.equal(store.get(credentials.server), null)
		console.log('PASS: encrypted persistence, restart, metadata-only renderer, legacy migration, unavailable encryption, logout')
	} finally {
		fs.rmSync(directory, { recursive: true, force: true })
	}
}
main().catch(error => { console.error(error); process.exitCode = 1 })
