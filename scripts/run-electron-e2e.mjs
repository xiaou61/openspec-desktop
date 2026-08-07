import { spawn } from 'node:child_process';
import process from 'node:process';

const command =
  process.platform === 'win32'
    ? 'pnpm.cmd exec playwright test tests/electron --workers=1'
    : 'pnpm exec playwright test tests/electron --workers=1';
const child = spawn(command, {
  stdio: 'inherit',
  env: { ...process.env, RUN_ELECTRON_E2E: '1' },
  shell: true,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
