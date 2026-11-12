import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNvidiaTransport } from '../src/services/nvidia-transport.js';

const oldExecutable = process.env.AI_PYTHON_EXECUTABLE;
const tempDirs: string[] = [];

afterEach(async () => {
  if (oldExecutable === undefined) delete process.env.AI_PYTHON_EXECUTABLE;
  else process.env.AI_PYTHON_EXECUTABLE = oldExecutable;
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createWorker(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'agrilink-nvidia-transport-'));
  tempDirs.push(directory);
  const executable = join(directory, 'worker');
  await writeFile(executable, `#!/usr/bin/env python3\n${body}\n`, { mode: 0o700 });
  await chmod(executable, 0o700);
  process.env.AI_PYTHON_EXECUTABLE = executable;
  return executable;
}

describe('Node to Python NVIDIA transport process', () => {
  it('runs a local SDK health operation without provider credentials or network requests', async () => {
    await createWorker(`import json, sys
request = json.loads(sys.stdin.read())
print(json.dumps({"ok": True, "health": {"worker": "ready", "sdk": "openai", "sdkVersion": "isolated-test-version", "receivedProviderConfiguration": any(key in request for key in ("apiKey", "baseUrl", "model"))}}))`);
    const result = await runNvidiaTransport('health', undefined, 5000);
    expect(result).toMatchObject({ ok: true, health: { worker: 'ready', sdk: 'openai', receivedProviderConfiguration: false } });
  });

  it('passes the current decrypted config in request stdin and receives structured diagnostics', async () => {
    await createWorker(`import json, os, sys
request = json.loads(sys.stdin.read())
secret_names = ("NVIDIA_API_KEY", "CONFIG_ENCRYPTION_KEY", "SESSION_SECRET", "MONGODB_URI")
print(json.dumps({"ok": True, "diagnostic": {"dnsReachable": True, "reachable": True, "tlsVerified": True, "authenticated": True, "modelAvailable": request["model"] == "configured/model", "requestedModel": request["model"], "httpStatus": 200, "latencyMs": 9, "inheritedApplicationSecrets": any(os.environ.get(name) for name in secret_names)}}))`);
    const result = await runNvidiaTransport('connectivity', {
      apiKey: 'decrypted-only-in-memory-test-value', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'configured/model', timeoutMs: 5000,
    }, 5000);
    expect(result).toMatchObject({ ok: true, diagnostic: { authenticated: true, modelAvailable: true, requestedModel: 'configured/model', inheritedApplicationSecrets: false } });
  });

  it('sends generation payloads to the worker without persisting them or retrying', async () => {
    await createWorker(`import json, sys
request = json.loads(sys.stdin.read())
print(json.dumps({"ok": True, "response": {"model": request["model"], "choices": [{"message": {"content": "{\\"content\\":\\"Transport complete.\\"}"}}]}}))`);
    const result = await runNvidiaTransport('complete', {
      apiKey: 'decrypted-only-in-memory-test-value', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'configured/model', timeoutMs: 5000,
    }, 5000, { model: 'configured/model', messages: [{ role: 'user', content: 'test-only request' }], stream: false });
    expect(result).toMatchObject({ ok: true, response: { model: 'configured/model' } });
  });

  it('returns a sanitized unavailable error when Python cannot be launched', async () => {
    process.env.AI_PYTHON_EXECUTABLE = join(tmpdir(), 'missing-agrilink-python-executable');
    const result = await runNvidiaTransport('connectivity', {
      apiKey: 'decrypted-only-in-memory-test-value', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'configured/model', timeoutMs: 5000,
    }, 5000);
    expect(result).toEqual({ ok: false, error: { category: 'python_unavailable', transient: true } });
    expect(JSON.stringify(result)).not.toContain('decrypted-only-in-memory-test-value');
  });

  it('terminates a stuck worker at the request deadline without retrying it', async () => {
    await createWorker('import time\ntime.sleep(10)');
    const started = Date.now();
    const result = await runNvidiaTransport('connectivity', {
      apiKey: 'decrypted-only-in-memory-test-value', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'configured/model', timeoutMs: 1000,
    }, 1000);
    expect(result).toEqual({ ok: false, error: { category: 'timeout', transient: true } });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
