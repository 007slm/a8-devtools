import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || '18766', 10);
const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');

const server = createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(html);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[agent-mind] Dashboard ready on http://127.0.0.1:${port}`);
});
