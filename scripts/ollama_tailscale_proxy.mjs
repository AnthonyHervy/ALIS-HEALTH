import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';

function normalizeHeaderHost(headers, targetUrl) {
  const nextHeaders = { ...headers };
  nextHeaders.host = targetUrl.host;
  return nextHeaders;
}

function createProxyRequestOptions(req, targetUrl) {
  return {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: req.url,
    method: req.method,
    headers: normalizeHeaderHost(req.headers, targetUrl)
  };
}

async function readTlsOptions({ tlsCertPath, tlsKeyPath }) {
  const [cert, key] = await Promise.all([
    readFile(tlsCertPath),
    readFile(tlsKeyPath)
  ]);
  return { cert, key };
}

function defaultLogger(message) {
  console.log(message);
}

export async function startProxyServer({
  listenHost,
  listenPort,
  tlsCertPath,
  tlsKeyPath,
  targetOrigin,
  logger = defaultLogger
}) {
  const targetUrl = new URL(targetOrigin);
  const tlsOptions = await readTlsOptions({ tlsCertPath, tlsKeyPath });

  const server = https.createServer(tlsOptions, (req, res) => {
    const proxyReq = http.request(createProxyRequestOptions(req, targetUrl), (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      logger(`[alis-ollama-proxy] upstream error: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({
        error: 'upstream_unreachable',
        detail: error.message
      }));
    });

    req.pipe(proxyReq);
  });

  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, () => {
      server.off('error', reject);
      const address = server.address();
      const host = typeof address === 'object' && address?.address ? address.address : listenHost;
      const port = typeof address === 'object' && address?.port ? address.port : listenPort;
      logger(`[alis-ollama-proxy] listening on https://${host}:${port} -> ${targetOrigin}`);
      resolve(server);
    });
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const listenHost = requiredEnv('ALIS_PROXY_BIND_HOST');
  const listenPort = Number(process.env.ALIS_PROXY_PORT ?? '9443');
  if (!Number.isFinite(listenPort) || listenPort <= 0) {
    throw new Error(`Invalid ALIS_PROXY_PORT: ${process.env.ALIS_PROXY_PORT ?? '<unset>'}`);
  }

  await startProxyServer({
    listenHost,
    listenPort,
    tlsCertPath: requiredEnv('ALIS_PROXY_TLS_CERT'),
    tlsKeyPath: requiredEnv('ALIS_PROXY_TLS_KEY'),
    targetOrigin: process.env.ALIS_PROXY_TARGET_ORIGIN ?? 'http://127.0.0.1:11434'
  });
}

const launchedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (launchedDirectly) {
  main().catch((error) => {
    console.error(`[alis-ollama-proxy] fatal: ${error.stack || error.message}`);
    process.exit(1);
  });
}
