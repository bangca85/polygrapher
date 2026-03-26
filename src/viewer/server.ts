import http from 'node:http';
import type { SystemMap } from '../types/graph.types.js';
import { generateViewerHtml } from './viewer-template.js';

export function startServer(
  systemMap: SystemMap,
  rootPath: string,
  port: number,
  onReady: (url: string) => void
): http.Server {
  // Server always uses external mode with /data.json endpoint
  const html = generateViewerHtml(systemMap, rootPath, {
    inline: false,
    dataUrl: '/data.json',
  });
  const jsonData = JSON.stringify(systemMap);

  const server = http.createServer((req, res) => {
    // M-2 security fix: reject requests with non-localhost Host header (DNS rebinding protection)
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${port}` && host !== '127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (req.url === '/data.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(jsonData);
      return;
    }

    // Default: serve HTML shell
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(html);
  });

  // Bind to 127.0.0.1 only (security: no LAN exposure)
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    onReady(url);
  });

  return server;
}
