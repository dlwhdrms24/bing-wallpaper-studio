import { readFile, mkdir, writeFile } from 'node:fs/promises';

const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
const assets = {};
for (const [path, [name, mime]] of Object.entries(files)) {
  assets[path] = [mime, await readFile(new URL('./public/' + name, import.meta.url), 'utf8')];
}
const api = (await readFile(new URL('./src/bing.mjs', import.meta.url), 'utf8')).replace(/\bexport\s+(?=(?:async )?function)/g, '');
const entry = `
const assets = ${JSON.stringify(assets)};
export default {
  fetch(request) {
    const url = new URL(request.url);
    const mountPath = '/bing-wallpaper';
    if (url.pathname === mountPath) {
      return new Response(null, { status: 308, headers: { Location: mountPath + '/' + url.search } });
    }
    if (url.pathname.startsWith(mountPath + '/')) url.pathname = url.pathname.slice(mountPath.length);
    const { pathname } = url;
    if (pathname.startsWith('/api/')) return api(new Request(url, { method: request.method }));
    const asset = Object.hasOwn(assets, pathname) && assets[pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    return new Response(request.method === 'HEAD' ? null : asset[1], { headers: {
      'Content-Type': asset[0],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https://www.bing.com; object-src 'none'; base-uri 'none'; form-action 'self'",
    } });
  }
};
`;
const output = new URL('./dist/server/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('index.js', output), api + entry);
