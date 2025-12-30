#!/usr/bin/env node
// Cross-platform helper to fake production by setting FIREFOX_JWT_ISSUER
const { spawnSync } = require('child_process');

process.env.FIREFOX_JWT_ISSUER = process.env.FIREFOX_JWT_ISSUER || '.';

const commands = [
  'wxt build',
  'wxt build -b firefox',
  'wxt zip',
  'wxt zip -b firefox',
];

for (const cmd of commands) {
  console.log('\n> running:', cmd);
  const res = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (res.error) {
    console.error('Command failed:', cmd, res.error);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error('Command exited with non-zero status', res.status);
    process.exit(res.status || 1);
  }
}

console.log('\nAll commands completed successfully.');
