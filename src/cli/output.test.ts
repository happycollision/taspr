import { describe, test, expect } from "bun:test";
import { formatBlockingIndicators } from "./output.ts";
import type { PRStatus } from "../types.ts";

describe("cli/output", () => {
  describe("formatBlockingIndicators", () => {
    test("returns empty string when all green", () => {
      const status: PRStatus = {
        checks: "passing",
        review: "approved",
        comments: { total: 0, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("");
    });

    test("returns empty string when no checks configured and no review required", () => {
      const status: PRStatus = {
        checks: "none",
        review: "none",
        comments: { total: 0, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("");
    });

    test("shows unresolved comments", () => {
      const status: PRStatus = {
        checks: "passing",
        review: "approved",
        comments: { total: 5, resolved: 3 },
      };
      expect(formatBlockingIndicators(status)).toBe("💬 3/5");
    });

    test("hides comments when all resolved", () => {
      const status: PRStatus = {
        checks: "passing",
        review: "approved",
        comments: { total: 5, resolved: 5 },
      };
      expect(formatBlockingIndicators(status)).toBe("");
    });

    test("shows pending checks", () => {
      const status: PRStatus = {
        checks: "pending",
        review: "approved",
        comments: { total: 0, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("⏳ checks");
    });

    test("shows failing checks", () => {
      const status: PRStatus = {
        checks: "failing",
        review: "approved",
        comments: { total: 0, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("❌ checks");
    });

    test("shows review required", () => {
      const status: PRStatus = {
        checks: "passing",
        review: "review_required",
        comments: { total: 0, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("👀 review");
    });

    test("shows changes requested", () => {
      const status: PRStatus = {
        checks: "passing",
        review: "changes_requested",
        comments: { total: 0, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("❌ review");
    });

    test("shows multiple indicators with proper spacing", () => {
      const status: PRStatus = {
        checks: "pending",
        review: "review_required",
        comments: { total: 5, resolved: 3 },
      };
      expect(formatBlockingIndicators(status)).toBe("💬 3/5  ⏳ checks  👀 review");
    });

    test("shows all failing indicators", () => {
      const status: PRStatus = {
        checks: "failing",
        review: "changes_requested",
        comments: { total: 2, resolved: 0 },
      };
      expect(formatBlockingIndicators(status)).toBe("💬 0/2  ❌ checks  ❌ review");
    });
  });
});
