/* SPDX-FileCopyrightText: 2026 MSHost contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later */
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const icongen = require('icon-gen')

async function main() {
	const root = path.resolve(__dirname, '..')
	const logo = await fs.readFile(path.join(__dirname, 'talk-logo-mt.svg'))
	const metadata = await sharp(logo).metadata()
	const width = 800
	const height = Math.round(width * metadata.height / metadata.width)
	const inner = logo.toString().replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><svg x="112" y="${(1024 - height) / 2}" width="${width}" height="${height}" viewBox="0 100 1024 700">${inner}</svg></svg>\n`
	const images = await fs.readdir(path.join(root, 'img'))
	for (const file of images.filter(name => /^talk-(icon|logo).*\.svg$/.test(name) || name === 'server-logo-plain.svg')) {
		await fs.writeFile(path.join(root, 'img', file), svg)
	}
	const output = path.join(root, 'img/icons')
	await fs.mkdir(output, { recursive: true })
	const sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
	for (const name of ['icon', 'IconTrayWin32', 'IconTrayWin32Light', 'IconTrayWin32Dark']) {
		await icongen(path.join(root, 'img/talk-icon-rounded.svg'), output, { ico: { name, sizes } })
	}
	await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(output, 'icon.png'))
	const loading = await sharp(Buffer.from(svg)).resize(128, 128).gif().toBuffer()
	await fs.writeFile(path.join(root, 'img/squirrel-install-loading.gif'), loading)
	console.log('MSHost application, tray and installer assets prepared')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
