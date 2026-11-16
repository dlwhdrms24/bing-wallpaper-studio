import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from './dist/server/index.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4179);
const server = createServer(async (incoming, outgoing) => {
  try {
    const address = new URL(incoming.url, 'http://' + host + ':' + port);
    const response = await worker.fetch(new Request(address, { method: incoming.method }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) { outgoing.end(); return; }
    const stream = Readable.fromWeb(response.body);
    outgoing.on('close', () => stream.destroy());
    stream.on('error', () => outgoing.destroy());
    stream.pipe(outgoing);
  } catch {
    outgoing.writeHead(500).end('Server error');
  }
});
server.listen(port, host, () => console.log(`Listening on http://${host}:${port}/bing-wallpaper/`));
