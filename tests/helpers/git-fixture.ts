import { $ } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitFixture {
  path: string;
  originPath: string;
  commit(message: string, options?: { trailers?: Record<string, string> }): Promise<string>;
  checkout(branch: string, options?: { create?: boolean }): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createGitFixture(): Promise<GitFixture> {
  // Create the "origin" bare repository first
  const originPath = await mkdtemp(join(tmpdir(), 'taspr-test-origin-'));
  await $`git init --bare ${originPath}`.quiet();

  // Create the working repository
  const path = await mkdtemp(join(tmpdir(), 'taspr-test-'));
  await $`git init ${path}`.quiet();
  await $`git -C ${path} config user.email "test@example.com"`.quiet();
  await $`git -C ${path} config user.name "Test User"`.quiet();

  // Add origin remote pointing to the bare repo
  await $`git -C ${path} remote add origin ${originPath}`.quiet();

  // Create initial commit on main
  const readmePath = join(path, 'README.md');
  await Bun.write(readmePath, '# Test Repo\n');
  await $`git -C ${path} add .`.quiet();
  await $`git -C ${path} commit -m "Initial commit"`.quiet();

  // Push main to origin so origin/main exists
  await $`git -C ${path} push -u origin main`.quiet();

  async function commit(
    message: string,
    options?: { trailers?: Record<string, string> }
  ): Promise<string> {
    // Create a file change
    const filename = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
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

  async function checkout(branch: string, options?: { create?: boolean }): Promise<void> {
    if (options?.create) {
      await $`git -C ${path} checkout -b ${branch}`.quiet();
    } else {
      await $`git -C ${path} checkout ${branch}`.quiet();
    }
  }

  async function cleanup(): Promise<void> {
    await rm(path, { recursive: true, force: true });
    await rm(originPath, { recursive: true, force: true });
  }

  return { path, originPath, commit, checkout, cleanup };
}
