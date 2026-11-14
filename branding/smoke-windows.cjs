/* SPDX-FileCopyrightText: 2026 MSHost contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
	const root = path.resolve(__dirname, '..')
	const output = path.resolve(root, '../../Builds/TalkDesktop')
	const appDir = path.join(root, 'out/MSHost Talk-win32-x64')
	const smokeName = process.env.MSHOST_SMOKE_NAME ?? 'MSHost Talk Check'
	assert.match(smokeName, /^[A-Za-z0-9 _-]+ Check$/)
	const checkExe = path.join(appDir, `${smokeName}.exe`)
	await fs.copyFile(path.join(appDir, 'MSHost Talk.exe'), checkExe)
	const server = net.createServer()
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	const port = server.address().port
	await new Promise(resolve => server.close(resolve))
	const child = spawn(checkExe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--lang=ru'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
	let log = ''
	child.stdout.on('data', data => { log += data })
	child.stderr.on('data', data => { log += data })
	let ws
	try {
		let target
		for (let i = 0; i < 50; i++) {
			await delay(500)
			try {
				const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
				target = targets.find(t => t.type === 'page' && t.url.includes('authentication'))
				if (target) break
			} catch { /* The application is still starting. */ }
		}
		assert.ok(target, 'Authentication renderer must open')
		ws = new WebSocket(target.webSocketDebuggerUrl)
		await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
		let nextId = 0
		const pending = new Map()
		ws.addEventListener('message', event => {
			const result = JSON.parse(event.data)
			if (pending.has(result.id)) {
				pending.get(result.id)(result)
				pending.delete(result.id)
			}
		})
		async function cdp(method, params = {}) {
			const id = ++nextId
			const answer = new Promise(resolve => pending.set(id, resolve))
			ws.send(JSON.stringify({ id, method, params }))
			const result = await Promise.race([answer, delay(5000).then(() => { throw new Error(`CDP timeout: ${method}`) })])
			assert.ok(!result.error, JSON.stringify(result.error))
			return result.result
		}
		await delay(2000)
		const result = await cdp('Runtime.evaluate', { expression: '({title:document.title,text:document.body.innerText,inputs:Array.from(document.querySelectorAll("input")).map(i=>({type:i.type,value:i.value})),images:Array.from(document.images).map(i=>({loaded:i.complete&&i.naturalWidth>0,src:i.src}))})', returnByValue: true })
		const page = result.result.value
		assert.ok(page.text.includes('MSHost Talk'), 'Branded application name must be visible')
		assert.ok(page.inputs.some(input => input.value === 'https://cloud.mshostcloud.org'), 'Server address must be prefilled')
		assert.ok(page.images.some(image => image.loaded), 'Login logo must load')
		const screenshot = await cdp('Page.captureScreenshot', { format: 'png' })
		await fs.writeFile(path.join(output, 'login-smoke.png'), Buffer.from(screenshot.data, 'base64'))
		await fs.writeFile(path.join(output, 'smoke-result.json'), JSON.stringify({ passed: true, page, profile: smokeName, scope: 'Unauthenticated login screen only; calls and account login not tested' }, null, 2))
		console.log(JSON.stringify(page, null, 2))
	} finally {
		ws?.close()
		child.kill()
		await delay(1500)
		await fs.writeFile(path.join(output, 'smoke-runtime.log'), log)
		await fs.unlink(checkExe)
	}
}

main().catch(error => { console.error(error); process.exitCode = 1 })
