import { describe, test, expect } from "bun:test";
import { PRNotFastForwardError, PRNotFoundError } from "./pr.ts";

describe("github/pr", () => {
  describe("PRNotFastForwardError", () => {
    test("includes PR number and reason in message", () => {
      const error = new PRNotFastForwardError(123, "main is not an ancestor");
      expect(error.message).toBe("PR #123 cannot be fast-forwarded: main is not an ancestor");
      expect(error.prNumber).toBe(123);
      expect(error.reason).toBe("main is not an ancestor");
      expect(error.name).toBe("PRNotFastForwardError");
    });
  });

  describe("PRNotFoundError", () => {
    test("includes PR number in message", () => {
      const error = new PRNotFoundError(456);
      expect(error.message).toBe("PR #456 not found");
      expect(error.prNumber).toBe(456);
      expect(error.name).toBe("PRNotFoundError");
    });
  });
});
