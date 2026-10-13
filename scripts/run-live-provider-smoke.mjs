import { spawnSync } from 'node:child_process';

const command = process.execPath;
const result = spawnSync(
  command,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--grep',
    '@live-provider',
    ...process.argv.slice(2)
  ],
  {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      LIVE_PROVIDER: '1'
    }
  }
);

process.exit(result.status ?? 1);
