import { createWhatsAppGateway } from './whatsapp.js';
import { logError } from './logger.js';

const backendUrl = process.env.BACKEND_URL;

function validateBackendUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BACKEND_URL must use HTTP or HTTPS');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const privateHost = host === 'localhost' || host === '::1' ||
    /^(127|10)\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '0.0.0.0' ||
    host === '169.254.169.254';
  if (privateHost) {
    throw new Error('BACKEND_URL private host is not allowed');
  }
  return url.href;
}

if (!backendUrl) {
  logError('gateway_start_failed', new Error('Missing BACKEND_URL'));
  process.exitCode = 1;
} else {
  try {
    const gateway = createWhatsAppGateway({ backendUrl: validateBackendUrl(backendUrl) });
    gateway.start().catch(error => { logError('gateway_runtime_failed', error); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => gateway.stop().finally(() => process.exit(0)));
  } catch (error) {
    logError('gateway_start_failed', error);
    process.exitCode = 1;
  }
}
