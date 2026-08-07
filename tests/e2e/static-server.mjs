import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = normalize(join(process.cwd(), 'out', 'renderer'));
const port = Number(process.env.PORT ?? 4197);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    .pathname;
  const requested = normalize(join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
  if (!requested.startsWith(root)) {
    response.writeHead(400);
    response.end('bad path');
    return;
  }
  let file = requested;
  try {
    const details = await stat(file);
    if (details.isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    file = join(root, 'index.html');
  }
  response.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () =>
  process.stdout.write(`renderer test server listening on ${port}\n`),
);

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
