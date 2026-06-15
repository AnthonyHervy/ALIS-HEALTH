import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

import { startProxyServer } from './ollama_tailscale_proxy.mjs';

const execFileAsync = promisify(execFile);

async function createCertFiles() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'alis-ollama-proxy-test-'));
  const certPath = path.join(tempDir, 'server.crt');
  const keyPath = path.join(tempDir, 'server.key');
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-subj',
    '/CN=localhost',
    '-days',
    '1'
  ]);
  return { tempDir, certPath, keyPath };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}

function requestJson(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        authorization: 'Bearer local'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('startProxyServer forwards HTTPS requests to the local Ollama backend', async () => {
  const backend = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      path: req.url,
      auth: req.headers.authorization ?? null
    }));
  });

  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const backendPort = backend.address().port;

  const { tempDir, certPath, keyPath } = await createCertFiles();
  let proxy;
  try {
    proxy = await startProxyServer({
      listenHost: '127.0.0.1',
      listenPort: 0,
      tlsCertPath: certPath,
      tlsKeyPath: keyPath,
      targetOrigin: `http://127.0.0.1:${backendPort}`
    });

    const proxyPort = proxy.address().port;
    const response = await requestJson(proxyPort, '/v1/models');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      path: '/v1/models',
      auth: 'Bearer local'
    });
  } finally {
    if (proxy) {
      await closeServer(proxy);
    }
    await closeServer(backend);
    await rm(tempDir, { recursive: true, force: true });
  }
});
