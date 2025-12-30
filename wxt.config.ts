import { defineConfig, type ConfigEnv, type UserManifest } from 'wxt';
import path from 'path';

const userDataDir = path.resolve(process.cwd(), '.wxt', 'chrome-data').replace(/\\/g, '/');

export default defineConfig({
  manifest: (env: ConfigEnv) => {
    // Treat presence of FIREFOX_JWT_ISSUER as production indicator.
    // If the env var exists, consider this a production build and do not include local hosts.
    const hasFirefoxJwtIssuer = typeof process.env.FIREFOX_JWT_ISSUER === 'string' && process.env.FIREFOX_JWT_ISSUER.trim() !== '';
    const isDev = !hasFirefoxJwtIssuer;
    const hostPermissionsBase = [
      'https://citizenhangar.space/*',
      'https://robertsspaceindustries.com/*',
    ];
    const host_permissions = isDev
      ? [...hostPermissionsBase, 'http://localhost/*', 'http://127.0.0.1/*']
      : hostPermissionsBase;

    const manifest: UserManifest = {
      name: 'Citizen Hangar Pledge Sync',
      description:
        'Sync Robert Space Industries pledges to the Citizen Hangar backend; pairing and uploads',
      manifest_version: 3,
      version: '1.3.4',
      action: {
        default_popup: 'entrypoints/popup/index.html',
      },
      icons: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
      background: {
        service_worker: 'entrypoints/background.js',
      },
      // Firefox-specific manifest field recommended by AMO
      browser_specific_settings: {
        gecko: {
          id: 'citizenhangar@sctr.space',
          // AMO data collection schema: list required/optional data types
          data_collection_permissions: {
            // Required data types collected/transmitted by the add-on (AMO schema)
            required: ['authenticationInfo', 'websiteContent', 'websiteActivity'],
            optional: [],
          },
        },
      },
      permissions: ['storage', 'alarms'],
      host_permissions,
      // content scripts are declared via `defineContentScript` in entrypoints/content.ts
    };

    return manifest;
  },

  // Persist browser profile between `wxt dev` runs (see WXT docs: Persist Data)
  webExt: {
    chromiumArgs: [`--user-data-dir=${userDataDir}`],
  },
});

