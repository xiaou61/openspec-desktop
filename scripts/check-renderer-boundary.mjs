import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const rendererRoot = join(process.cwd(), 'out', 'renderer');
const forbidden = [
  /(?:^|["'])electron(?:["']|$)/i,
  /node:(?:fs|path|child_process|os|crypto|module|process)/i,
  /\bipcRenderer\b/i,
  /\brequire\s*\(/i,
];

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

const files = await filesUnder(rendererRoot);
const violations = [];
for (const path of files) {
  if (!/\.(?:js|css|html)$/.test(path)) continue;
  const content = await fs.readFile(path, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) violations.push(`${path}: ${pattern}`);
  }
}

if (violations.length > 0) {
  process.stderr.write('Renderer bundle contains privileged imports or APIs:\n');
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Renderer boundary check passed (${files.length} files).\n`);
}
