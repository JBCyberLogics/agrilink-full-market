import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config/env.js';

const MAX_WORKER_OUTPUT_BYTES = 512_000;
const workerPath = fileURLToPath(new URL('../../python/nvidia_transport.py', import.meta.url));

export type NvidiaTransportConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};
export type NvidiaTransportError = {
  category: string;
  transient: boolean;
  httpStatus?: number | null;
  retryAfterMs?: number | null;
};
export type NvidiaTransportResponse = {
  ok: boolean;
  response?: Record<string, unknown>;
  diagnostic?: Record<string, unknown>;
  health?: Record<string, unknown>;
  error?: NvidiaTransportError;
};
export type NvidiaTransportOperation = 'complete' | 'connectivity' | 'health';

function childEnvironment() {
  // The worker receives no inherited provider or application credentials.
  // Proxy and CA settings are carried through for installations that require
  // an egress proxy or a configured system trust bundle.
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  return Object.fromEntries(allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []));
}

function safeError(category: string, transient: boolean): NvidiaTransportResponse {
  return { ok: false, error: { category, transient } };
}

export async function runNvidiaTransport(
  operation: NvidiaTransportOperation,
  config: NvidiaTransportConfig | undefined,
  timeoutMs: number,
  request?: Record<string, unknown>,
): Promise<NvidiaTransportResponse> {
  const budget = Math.max(1_000, Math.min(120_000, Math.floor(timeoutMs)));
  if (operation !== 'health' && !config) return safeError('provider_configuration_missing', false);
  const input = JSON.stringify({
    operation,
    timeoutMs: budget,
    ...(config ? { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model } : {}),
    ...(request ? { request } : {}),
  });
  if (Buffer.byteLength(input, 'utf8') > 256_000) return safeError('request_too_large', false);

  const python = getConfig().AI_PYTHON_EXECUTABLE;
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(python, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnvironment(), windowsHide: true });
    } catch {
      resolve(safeError('python_unavailable', true));
      return;
    }
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (result: NvidiaTransportResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(safeError('timeout', true));
    }, budget);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(safeError('response_too_large', false));
        return;
      }
      chunks.push(buffer);
    });
    // Drain but never retain or surface worker stderr, which may include
    // dependency diagnostics or request metadata.
    child.stderr.resume();
    child.once('error', () => finish(safeError('python_unavailable', true)));
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(safeError('transport_error', true));
        return;
      }
      const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean);
      let result: NvidiaTransportResponse | undefined;
      try {
        for (const line of lines) {
          const parsed = JSON.parse(line) as NvidiaTransportResponse & { type?: string };
          if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean') result = parsed;
        }
      } catch {
        finish(safeError('invalid_transport_response', false));
        return;
      }
      if (!result) {
        finish(safeError('invalid_transport_response', false));
        return;
      }
      finish(result);
    });
    child.stdin.once('error', () => undefined);
    child.stdin.end(input, 'utf8');
  });
}
