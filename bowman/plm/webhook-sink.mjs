// Throwaway webhook receiver for verify.ts. Logs every request as one JSON line and answers 200.
// Norn's real receiver does not exist yet; this stands in only to prove the PLM's webhook fires.
import { createServer } from 'node:http';
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, headers: req.headers, body }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(9999, () => console.log(JSON.stringify({ listening: 9999 })));
