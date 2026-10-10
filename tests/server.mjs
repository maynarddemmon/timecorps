// A tiny static file server for the tests. It serves the project root exactly as GitHub
// Pages does, so the tests load the real index.html. Usage: node tests/server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    PORT = Number(process.argv[2] ?? 8765),
    TYPES = {
        '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
        '.json':'application/json', '.json5':'application/json5; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.map':'application/json',
        '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.webm':'video/webm',
        '.ttf':'font/ttf', '.woff':'font/woff', '.woff2':'font/woff2'
    };

http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }
    res.writeHead(200, {'Content-Type':TYPES[path.extname(filePath)] ?? 'application/octet-stream'});
    fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => console.log('Serving ' + ROOT + ' on http://localhost:' + PORT));
