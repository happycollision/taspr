import { $ } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitFixture {
  path: string;
  commit(message: string, options?: { trailers?: Record<string, string> }): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createGitFixture(): Promise<GitFixture> {
  const path = await mkdtemp(join(tmpdir(), 'taspr-test-'));

  await $`git init ${path}`.quiet();
  await $`git -C ${path} config user.email "test@example.com"`.quiet();
  await $`git -C ${path} config user.name "Test User"`.quiet();

  // Create initial commit
  const readmePath = join(path, 'README.md');
  await Bun.write(readmePath, '# Test Repo\n');
  await $`git -C ${path} add .`.quiet();
  await $`git -C ${path} commit -m "Initial commit"`.quiet();

  async function commit(
    message: string,
    options?: { trailers?: Record<string, string> }
  ): Promise<string> {
    // Create a file change
    const filename = `file-${Date.now()}.txt`;
    await Bun.write(join(path, filename), `Content for ${message}\n`);
    await $`git -C ${path} add .`.quiet();

    let fullMessage = message;
    if (options?.trailers) {
      fullMessage += '\n\n';
      for (const [key, value] of Object.entries(options.trailers)) {
        fullMessage += `${key}: ${value}\n`;
      }
    }

    await $`git -C ${path} commit -m ${fullMessage}`.quiet();
    const result = await $`git -C ${path} rev-parse HEAD`.text();
    return result.trim();
  }

  async function cleanup(): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  return { path, commit, cleanup };
}
