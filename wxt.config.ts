import { defineConfig } from 'wxt';
import path from 'path';

const userDataDir = path.resolve(process.cwd(), '.wxt', 'chrome-data').replace(/\\\\/g, '/');

export default defineConfig({
	manifest: {
		name: 'Citizen Hangar Pledge Sync',
		description: 'Sync Robert Space Industries (Citizen Hangar) pledges to the SCTR backend; pairing and uploads',
		manifest_version: 3,
		version: '1.3.0',
		action: {
			default_popup: 'entrypoints/popup/index.html',
		},
		icons: {
			16: 'icon/16.png',
			32: 'icon/32.png',
			48: 'icon/48.png',
			128: 'icon/128.png'
		},
		background: {
			service_worker: 'entrypoints/background.js',
		},
		permissions: ['storage', 'cookies', 'alarms', 'activeTab'],
		host_permissions: ['https://citizenhangar.space/*', 'http://localhost/*', 'http://127.0.0.1/*', 'https://robertsspaceindustries.com/*'],
		// content scripts are declared via `defineContentScript` in entrypoints/content.ts
	},
	// Persist browser profile between `wxt dev` runs (see WXT docs: Persist Data)
	webExt: {
		chromiumArgs: [`--user-data-dir=${userDataDir}`],
	},
});
