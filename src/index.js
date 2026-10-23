import { createWhatsAppGateway } from './whatsapp.js';
import { log, logError } from './logger.js';
import { createServer } from 'node:http';

const hermesEnabled = process.env.HERMES_ENABLED !== 'false';
const backendUrl = hermesEnabled ? (process.env.HERMES_URL || process.env.BACKEND_URL) : process.env.BACKEND_URL;
const backendToken = hermesEnabled ? (process.env.HERMES_TOKEN || process.env.BACKEND_TOKEN) : process.env.BACKEND_TOKEN;
const version = process.env.npm_package_version || 'unknown';

// ponytail: keep selection at startup; add runtime backend switching only when operators need it.

function validateBackendUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BACKEND_URL must use HTTP or HTTPS');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const privateHost = host === 'localhost' || host === '::1' ||
    /^(127|10)\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '0.0.0.0' ||
    host === '169.254.169.254';
  if (privateHost && process.env.ALLOW_PRIVATE_BACKEND !== 'true') {
    throw new Error('BACKEND_URL private host is not allowed');
  }
  return url.href;
}

process.on('uncaughtException', error => logError('uncaught_exception', error));
process.on('unhandledRejection', error => logError('unhandled_rejection', error));

if (!backendUrl) {
  logError('gateway_start_failed', new Error(`Missing ${hermesEnabled ? 'HERMES_URL' : 'BACKEND_URL'}`));
  process.exitCode = 1;
} else if (!backendToken) {
  logError('gateway_start_failed', new Error(`Missing ${hermesEnabled ? 'HERMES_TOKEN' : 'BACKEND_TOKEN'}`));
  process.exitCode = 1;
} else {
  try {
    const gateway = createWhatsAppGateway({ backendUrl: validateBackendUrl(backendUrl), backendToken });
    const healthServer = createServer((request, response) => {
      const isReadiness = request.url === '/readyz';
      if (request.url !== '/healthz' && !isReadiness) {
        response.writeHead(404).end();
        return;
      }
      const health = { ...gateway.health(), version };
      response.writeHead(isReadiness && !health.ready ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(health));
    });
    const healthPort = Number(process.env.PORT || 3001);
    healthServer.listen(healthPort, process.env.HOST || '0.0.0.0', () => log('health_server_ready', { port: healthPort }));
    gateway.start().catch(error => { logError('gateway_runtime_failed', error); process.exitCode = 1; });
    let shuttingDown = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      healthServer.close();
      gateway.stop().finally(() => process.exit(0));
    });
  } catch (error) {
    logError('gateway_start_failed', error);
    process.exitCode = 1;
  }
}
