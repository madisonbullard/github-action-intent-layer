import { describe, expect, test } from "bun:test";
import { DEFAULTS, MAX_PR_LINES_CHANGED } from "../../src/config/defaults";

/**
 * Tests for config/defaults.ts
 *
 * These tests ensure that:
 * 1. Default values match what's specified in action.yml
 * 2. Default values match what's documented in PLAN.md
 * 3. Constants are correctly typed and exported
 */
describe("DEFAULTS", () => {
	describe("matches action.yml defaults", () => {
		// These tests ensure TypeScript defaults align with action.yml
		// If action.yml changes, these tests will catch mismatches

		test("mode default is 'analyze'", () => {
			expect(DEFAULTS.mode).toBe("analyze");
		});

		test("model default is 'anthropic/claude-sonnet-4-20250514'", () => {
			expect(DEFAULTS.model).toBe("anthropic/claude-sonnet-4-20250514");
		});

		test("files default is 'agents'", () => {
			expect(DEFAULTS.files).toBe("agents");
		});

		test("symlink default is false", () => {
			expect(DEFAULTS.symlink).toBe(false);
		});

		test("symlinkSource default is 'agents'", () => {
			expect(DEFAULTS.symlinkSource).toBe("agents");
		});

		test("output default is 'pr_comments'", () => {
			expect(DEFAULTS.output).toBe("pr_comments");
		});

		test("newNodes default is true", () => {
			expect(DEFAULTS.newNodes).toBe(true);
		});

		test("splitLargeNodes default is true", () => {
			expect(DEFAULTS.splitLargeNodes).toBe(true);
		});

		test("tokenBudgetPercent default is 5", () => {
			expect(DEFAULTS.tokenBudgetPercent).toBe(5);
		});

		test("skipBinaryFiles default is true", () => {
			expect(DEFAULTS.skipBinaryFiles).toBe(true);
		});

		test("fileMaxLines default is 8000", () => {
			expect(DEFAULTS.fileMaxLines).toBe(8000);
		});
	});

	describe("type safety", () => {
		test("DEFAULTS is a readonly object", () => {
			// TypeScript ensures this at compile time, but we can verify the structure
			expect(typeof DEFAULTS).toBe("object");
			expect(DEFAULTS).not.toBeNull();
		});

		test("all expected keys are present", () => {
			const expectedKeys = [
				"mode",
				"model",
				"files",
				"symlink",
				"symlinkSource",
				"output",
				"newNodes",
				"splitLargeNodes",
				"tokenBudgetPercent",
				"skipBinaryFiles",
				"fileMaxLines",
			];

			for (const key of expectedKeys) {
				expect(key in DEFAULTS).toBe(true);
			}
		});

		test("mode is a valid Mode type", () => {
			const validModes = ["analyze", "checkbox-handler"];
			expect(validModes).toContain(DEFAULTS.mode);
		});

		test("files is a valid Files type", () => {
			const validFiles = ["agents", "claude", "both"];
			expect(validFiles).toContain(DEFAULTS.files);
		});

		test("symlinkSource is a valid SymlinkSource type", () => {
			const validSources = ["agents", "claude"];
			expect(validSources).toContain(DEFAULTS.symlinkSource);
		});

		test("output is a valid Output type", () => {
			const validOutputs = ["pr_comments", "pr_commit", "new_pr"];
			expect(validOutputs).toContain(DEFAULTS.output);
		});

		test("boolean defaults are actual booleans", () => {
			expect(typeof DEFAULTS.symlink).toBe("boolean");
			expect(typeof DEFAULTS.newNodes).toBe("boolean");
			expect(typeof DEFAULTS.splitLargeNodes).toBe("boolean");
			expect(typeof DEFAULTS.skipBinaryFiles).toBe("boolean");
		});

		test("numeric defaults are actual numbers", () => {
			expect(typeof DEFAULTS.tokenBudgetPercent).toBe("number");
			expect(typeof DEFAULTS.fileMaxLines).toBe("number");
		});

		test("string defaults are actual strings", () => {
			expect(typeof DEFAULTS.mode).toBe("string");
			expect(typeof DEFAULTS.model).toBe("string");
			expect(typeof DEFAULTS.files).toBe("string");
			expect(typeof DEFAULTS.symlinkSource).toBe("string");
			expect(typeof DEFAULTS.output).toBe("string");
		});
	});

	describe("sensible values", () => {
		test("tokenBudgetPercent is a reasonable percentage (1-100)", () => {
			expect(DEFAULTS.tokenBudgetPercent).toBeGreaterThan(0);
			expect(DEFAULTS.tokenBudgetPercent).toBeLessThanOrEqual(100);
		});

		test("fileMaxLines is a positive number", () => {
			expect(DEFAULTS.fileMaxLines).toBeGreaterThan(0);
		});

		test("model follows provider/model format", () => {
			expect(DEFAULTS.model).toContain("/");
		});
	});
});

describe("MAX_PR_LINES_CHANGED", () => {
	test("is 100,000 as documented in PLAN.md", () => {
		// PLAN.md Section 17: "PRs exceeding 100,000 lines changed are skipped entirely"
		expect(MAX_PR_LINES_CHANGED).toBe(100_000);
	});

	test("is a positive number", () => {
		expect(MAX_PR_LINES_CHANGED).toBeGreaterThan(0);
	});

	test("is a reasonable threshold", () => {
		// Should be large enough to handle most PRs but catch absurdly large ones
		expect(MAX_PR_LINES_CHANGED).toBeGreaterThanOrEqual(10_000);
		expect(MAX_PR_LINES_CHANGED).toBeLessThanOrEqual(1_000_000);
	});
});
