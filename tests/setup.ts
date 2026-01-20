import { beforeEach } from "bun:test";
import { clearConfigCache } from "../src/git/config.ts";
import { clearRemoteUrlCache } from "../src/github/api.ts";

// Clear all caches before each test to ensure test isolation
beforeEach(() => {
  clearConfigCache();
  clearRemoteUrlCache();
});
