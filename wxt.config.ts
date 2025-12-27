import { defineConfig } from 'wxt';
import path from 'path';

const userDataDir = path.resolve(process.cwd(), '.wxt', 'chrome-data').replace(/\\\\/g, '/');

export default defineConfig({
	manifest: {
		name: 'SCTR / Starhoppers',
		description: 'Sync Citizen Hangar pledges to SCTR backend; pairing + uploads',
		manifest_version: 3,
		version: '1.0.0',
		action: {
			default_popup: 'entrypoints/popup/index.html',
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
