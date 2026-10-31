// Read-only, loopback-only preview. Serves this design folder; no DSH API access.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = new URL('./', import.meta.url);
const files = new Map([
  ['/', ['prototype.html', 'text/html; charset=utf-8']],
  ['/prototype.html', ['prototype.html', 'text/html; charset=utf-8']],
  ['/overview.jpg', ['overview.jpg', 'image/jpeg']],
]);
const server = http.createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (req.method !== 'GET' || !file) { res.writeHead(404).end(); return; }
  try {
    const data = await readFile(fileURLToPath(new URL(file[0], base)));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }).end(data);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`Design preview: http://127.0.0.1:${server.address().port}`));
