import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const mirror = process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/';
const result = spawnSync(process.execPath, [resolve('node_modules/electron/install.js')], {
  env: { ...process.env, ELECTRON_MIRROR: mirror },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
