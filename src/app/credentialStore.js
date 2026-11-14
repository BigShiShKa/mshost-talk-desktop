/**
 * SPDX-FileCopyrightText: 2026 MSHost contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

class CredentialStore {
	constructor(file) {
		this.filePath = file
	}

	get file() {
		return this.filePath ?? path.join(app.getPath('userData'), 'credentials.enc.json')
	}

	assertEncryption() {
		if (!safeStorage.isEncryptionAvailable()
			|| (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
			throw new Error('Secure credential storage is unavailable')
		}
	}

	set(credentials) {
		this.assertEncryption()
		if (typeof credentials?.password !== 'string' || !credentials.password
			|| typeof credentials.user !== 'string' || !credentials.user
			|| new URL(credentials.server).protocol !== 'https:') {
			throw new Error('Invalid credentials')
		}
		const record = {
			server: credentials.server,
			user: credentials.user,
			password: safeStorage.encryptString(credentials.password).toString('base64'),
		}
		fs.mkdirSync(path.dirname(this.file), { recursive: true })
		fs.writeFileSync(this.file + '.tmp', JSON.stringify(record), { mode: 0o600 })
		fs.renameSync(this.file + '.tmp', this.file)
		return { server: record.server, user: record.user }
	}

	get(server) {
		if (!fs.existsSync(this.file)) {
			return null
		}
		this.assertEncryption()
		const record = JSON.parse(fs.readFileSync(this.file, 'utf8'))
		if (record.server !== server) {
			return null
		}
		return { server: record.server, user: record.user, password: safeStorage.decryptString(Buffer.from(record.password, 'base64')) }
	}

	clear() {
		fs.rmSync(this.file, { force: true })
		fs.rmSync(this.file + '.tmp', { force: true })
	}
}

const credentialStore = new CredentialStore()
module.exports = { CredentialStore, credentialStore }
