import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const CLI_PATH = path.resolve('dist/index.js');

function runCli(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
    });
    return { stdout, exitCode: 0 };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? '') + (e.stderr ?? ''),
      exitCode: e.status ?? 1,
    };
  }
}

describe('CLI entrypoint integration (dist/index.js)', () => {
  it('--help prints usage and exits 0 (FR34)', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('polygrapher');
    expect(stdout).toContain('--export-only');
    expect(stdout).toContain('--port');
    expect(stdout).toContain('--lang');
  });

  it('--version prints semver and exits 0 (FR35)', () => {
    const { stdout, exitCode } = runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('nonexistent path exits 1 (FR37)', () => {
    const { stdout, exitCode } = runCli(['./does-not-exist-xyz']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Directory not found');
  });

  it('--lang with invalid language exits 1 (FR5)', () => {
    const { stdout, exitCode } = runCli(['--lang', 'python', './test-fixtures/go/simple-api']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unsupported language: python');
  });

  it('--lang go on Go fixture exits 0 (FR5)', () => {
    const { stdout, exitCode } = runCli(['--lang', 'go', '--export-only', './test-fixtures/go/simple-api']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Forced language: go');
  });

  it('defaults to cwd when no path given (FR1)', () => {
    // Running from project root which has go.mod? No. Project root has package.json.
    // Use --export-only on a fixture dir explicitly to keep test deterministic.
    const { stdout, exitCode } = runCli(['--export-only', './test-fixtures/go/simple-api']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Scanning');
  });

  it('unsupported-only repo lists detected-but-unsupported files (FR38)', () => {
    const { stdout, exitCode } = runCli(['./test-fixtures/unsupported-lang']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('No supported languages detected');
    expect(stdout).toContain('not yet supported');
  });

  it('L-1: rejects invalid port numbers (security)', () => {
    const { stdout, exitCode } = runCli(['--port', '99999', './test-fixtures/go/simple-api']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Invalid port');
  });

  it('L-1: rejects privileged ports (security)', () => {
    const { stdout, exitCode } = runCli(['--port', '80', './test-fixtures/go/simple-api']);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Invalid port');
  });

  it('M-2: server rejects requests with non-localhost Host header (security)', async () => {
    const port = 19877;
    const child = spawn('node', [CLI_PATH, '--port', String(port), './test-fixtures/go/simple-api'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
        child.stdout?.on('data', (data: Buffer) => {
          if (data.toString().includes('Viewer running')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Process exited with code ${code}`));
        });
      });

      // Request with correct Host → 200
      const goodRes = await new Promise<number>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}`, { headers: { host: `127.0.0.1:${port}` } }, (r) => resolve(r.statusCode ?? 0)).on('error', reject);
      });
      expect(goodRes).toBe(200);

      // Request with spoofed Host → 403
      const badRes = await new Promise<number>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}`, { headers: { host: 'evil.com' } }, (r) => resolve(r.statusCode ?? 0)).on('error', reject);
      });
      expect(badRes).toBe(403);
    } finally {
      child.kill('SIGTERM');
    }
  }, 15000);

  it('--port starts server on custom port (FR36)', async () => {
    const port = 19876; // unlikely to conflict
    const child = spawn('node', [CLI_PATH, '--port', String(port), './test-fixtures/go/simple-api'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    try {
      // Wait for server to start (look for "Viewer running" in stdout)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
        child.stdout?.on('data', (data: Buffer) => {
          if (data.toString().includes('Viewer running')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Process exited with code ${code}`));
        });
      });

      // Verify server responds on the custom port
      const res = await new Promise<number>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}`, (r) => resolve(r.statusCode ?? 0)).on('error', reject);
      });
      expect(res).toBe(200);
    } finally {
      child.kill('SIGTERM');
    }
  }, 15000);
});
