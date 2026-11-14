/*!
 * SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { LoginFlowV2 } from './loginFlowV2.ts'

import { BrowserWindow } from 'electron'
import { getAppConfig } from '../app/AppConfig.ts'
import { applyContextMenu } from '../app/applyContextMenu.js'
import { credentialStore } from '../app/credentialStore.js'
import { applyZoom, buildTitle, getScaledWindowSize, getTitleBarSymbolColor, getWindowUrl } from '../app/utils.ts'
import { enableWebRequestInterceptor } from '../app/webRequestInterceptor.js'
import { TITLE_BAR_HEIGHT } from '../constants.js'
import { getBrowserWindowIcon } from '../shared/icons.utils.js'
import { createLoginFlowV2 } from './loginFlowV2.ts'

/**
 * Create the authentication window
 */
export function createAuthenticationWindow() {
	const zoomFactor = getAppConfig('zoomFactor')
	const window = new BrowserWindow({
		title: buildTitle(),
		...getScaledWindowSize({
			width: 450,
			height: 500,
		}),
		show: false,
		maximizable: false,
		resizable: false,
		fullscreenable: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: TALK_DESKTOP__WINDOW_AUTHENTICATION_PRELOAD_WEBPACK_ENTRY,
		},
		icon: getBrowserWindowIcon(),
		titleBarStyle: getAppConfig('systemTitleBar') ? 'default' : 'hidden',
		titleBarOverlay: {
			color: '#FFFFFF00',
			symbolColor: getTitleBarSymbolColor(),
			height: Math.round(TITLE_BAR_HEIGHT * zoomFactor),
		},
		// Position of the top left corner of the traffic light on Mac
		trafficLightPosition: {
			x: 12, // Same as on Talk Window
			y: Math.round((TITLE_BAR_HEIGHT * zoomFactor - 16) / 2), // 16 is the default traffic light button diameter
		},
	})

	// TODO: return this on release
	// if (process.env.NODE_ENV === 'production') {
	// window.removeMenu()
	// }

	applyContextMenu(window)
	applyZoom(window)

	let flow: LoginFlowV2 | null = null

	window.webContents.ipc.handle('authentication:loginFlowV2:init', async (event, serverUrl: string) => {
		if (event.senderFrame?.url !== getWindowUrl('authentication')) {
			throw new Error('Untrusted login initialization')
		}
		flow?.abort()
		flow = await createLoginFlowV2(serverUrl, (isPolling) => {
			if (!window.isDestroyed()) {
				window.webContents.send('authentication:loginFlowV2:polling:change', isPolling)
			}
		})
		return flow.loginUrl
	})

	window.webContents.ipc.handle('authentication:loginFlowV2:login', async (event) => {
		if (event.senderFrame?.url !== getWindowUrl('authentication')) {
			throw new Error('Untrusted login completion')
		}
		if (!flow) {
			throw new Error('Unexpected loginFlowV2 login attempt before init')
		}
		try {
			const credentials = await flow.login()
			if (credentials instanceof Error) {
				return credentials
			}
			const account = credentialStore.set(credentials)
			enableWebRequestInterceptor(credentials.server, { credentials })
			return account
		} finally {
			flow = null
		}
	})

	window.webContents.ipc.on('authentication:loginFlowV2:open', () => flow?.open())
	window.webContents.ipc.on('authentication:loginFlowV2:refresh', () => flow?.refresh())
	window.webContents.ipc.on('authentication:loginFlowV2:abort', () => flow?.abort())

	window.loadURL(getWindowUrl('authentication'))

	window.addListener('closed', () => flow?.abort())

	return window
}
