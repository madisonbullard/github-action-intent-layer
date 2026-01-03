import { describe, expect, test } from "bun:test";
import type { IntentUpdate } from "../../src/opencode/output-schema";
import {
	calculateDiffStats,
	formatBeforeAfterForComment,
	formatDiffForComment,
	generateDiff,
	generateDiffForUpdate,
	normalizeLineEndings,
} from "../../src/utils/diff";

describe("normalizeLineEndings", () => {
	test("converts CRLF to LF", () => {
		expect(normalizeLineEndings("line1\r\nline2\r\n")).toBe("line1\nline2\n");
	});

	test("converts CR to LF", () => {
		expect(normalizeLineEndings("line1\rline2\r")).toBe("line1\nline2\n");
	});

	test("handles mixed line endings", () => {
		expect(normalizeLineEndings("line1\r\nline2\rline3\n")).toBe(
			"line1\nline2\nline3\n",
		);
	});

	test("preserves LF line endings", () => {
		expect(normalizeLineEndings("line1\nline2\n")).toBe("line1\nline2\n");
	});

	test("handles empty string", () => {
		expect(normalizeLineEndings("")).toBe("");
	});

	test("handles string without line endings", () => {
		expect(normalizeLineEndings("no newline")).toBe("no newline");
	});
});

describe("calculateDiffStats", () => {
	test("returns zeros for identical content", () => {
		const stats = calculateDiffStats("same\n", "same\n");
		expect(stats.additions).toBe(0);
		expect(stats.deletions).toBe(0);
		expect(stats.totalChanges).toBe(0);
	});

	test("counts additions correctly", () => {
		const stats = calculateDiffStats("", "line1\nline2\n");
		expect(stats.additions).toBe(2);
		expect(stats.deletions).toBe(0);
		expect(stats.totalChanges).toBe(2);
	});

	test("counts deletions correctly", () => {
		const stats = calculateDiffStats("line1\nline2\n", "");
		expect(stats.additions).toBe(0);
		expect(stats.deletions).toBe(2);
		expect(stats.totalChanges).toBe(2);
	});

	test("counts mixed changes correctly", () => {
		const old = "line1\nline2\nline3\n";
		const newContent = "line1\nmodified\nline3\nnew line\n";
		const stats = calculateDiffStats(old, newContent);
		// line2 removed, "modified" and "new line" added
		expect(stats.deletions).toBe(1);
		expect(stats.additions).toBe(2);
		expect(stats.totalChanges).toBe(3);
	});

	test("handles content without trailing newline", () => {
		const stats = calculateDiffStats("line1", "line1\nline2");
		expect(stats.additions).toBeGreaterThan(0);
	});
});

describe("generateDiff", () => {
	test("generates unified diff for changes", () => {
		const result = generateDiff("old line\n", "new line\n", "test/AGENTS.md");

		expect(result.hasChanges).toBe(true);
		expect(result.unifiedDiff).toContain("@@");
		expect(result.unifiedDiff).toContain("-old line");
		expect(result.unifiedDiff).toContain("+new line");
	});

	test("reports no changes for identical content", () => {
		const result = generateDiff(
			"same content\n",
			"same content\n",
			"test/AGENTS.md",
		);

		expect(result.hasChanges).toBe(false);
		expect(result.stats.totalChanges).toBe(0);
	});

	test("uses custom headers", () => {
		const result = generateDiff("old\n", "new\n", "test/AGENTS.md", {
			oldHeader: "Before",
			newHeader: "After",
		});

		expect(result.unifiedDiff).toContain("Before");
		expect(result.unifiedDiff).toContain("After");
	});

	test("respects context lines option", () => {
		const old = "line1\nline2\nline3\nline4\nline5\n";
		const newContent = "line1\nline2\nchanged\nline4\nline5\n";

		const result1 = generateDiff(old, newContent, "file.md", {
			contextLines: 1,
		});
		const result2 = generateDiff(old, newContent, "file.md", {
			contextLines: 3,
		});

		// More context lines means longer diff
		expect(result2.unifiedDiff.length).toBeGreaterThanOrEqual(
			result1.unifiedDiff.length,
		);
	});

	test("normalizes line endings before diffing", () => {
		const result = generateDiff(
			"line1\r\nline2\r\n",
			"line1\nline2\n",
			"test/AGENTS.md",
		);

		// Should show no changes since normalized content is the same
		expect(result.hasChanges).toBe(false);
	});
});

describe("generateDiffForUpdate", () => {
	test("handles create action", () => {
		const update: IntentUpdate = {
			nodePath: "packages/new/AGENTS.md",
			action: "create",
			reason: "New package needs intent file",
			suggestedContent: "# New Package\n\nContext here.\n",
		};

		const result = generateDiffForUpdate(update);

		expect(result.hasChanges).toBe(true);
		expect(result.stats.additions).toBeGreaterThan(0);
		expect(result.stats.deletions).toBe(0);
		expect(result.unifiedDiff).toContain("+# New Package");
	});

	test("handles update action", () => {
		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "API changes need documentation",
			currentContent: "# API\n\nOld context.\n",
			suggestedContent: "# API\n\nNew context.\n",
		};

		const result = generateDiffForUpdate(update);

		expect(result.hasChanges).toBe(true);
		expect(result.unifiedDiff).toContain("-Old context.");
		expect(result.unifiedDiff).toContain("+New context.");
	});

	test("handles delete action", () => {
		const update: IntentUpdate = {
			nodePath: "packages/deprecated/AGENTS.md",
			action: "delete",
			reason: "Package removed",
			currentContent: "# Deprecated\n\nOld content.\n",
		};

		const result = generateDiffForUpdate(update);

		expect(result.hasChanges).toBe(true);
		expect(result.stats.deletions).toBeGreaterThan(0);
		expect(result.stats.additions).toBe(0);
		expect(result.unifiedDiff).toContain("-# Deprecated");
	});

	test("handles update with no actual changes", () => {
		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "Review suggested",
			currentContent: "# Same\n\nContent.\n",
			suggestedContent: "# Same\n\nContent.\n",
		};

		const result = generateDiffForUpdate(update);

		expect(result.hasChanges).toBe(false);
	});
});

describe("formatDiffForComment", () => {
	test("formats create action correctly", () => {
		const update: IntentUpdate = {
			nodePath: "packages/new/AGENTS.md",
			action: "create",
			reason: "New package needs documentation",
			suggestedContent: "# New Package\n",
		};
		const diffResult = generateDiffForUpdate(update);
		const formatted = formatDiffForComment(diffResult, update);

		expect(formatted).toContain("### Create: `packages/new/AGENTS.md`");
		expect(formatted).toContain("**Reason:** New package needs documentation");
		expect(formatted).toContain("```diff");
		expect(formatted).toContain("<details>");
		expect(formatted).toContain("<summary>View diff</summary>");
	});

	test("formats update action correctly", () => {
		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "API refactoring",
			currentContent: "# Old\n",
			suggestedContent: "# New\n",
		};
		const diffResult = generateDiffForUpdate(update);
		const formatted = formatDiffForComment(diffResult, update);

		expect(formatted).toContain("### Update: `packages/api/AGENTS.md`");
		expect(formatted).toContain("**Reason:** API refactoring");
	});

	test("formats delete action correctly", () => {
		const update: IntentUpdate = {
			nodePath: "packages/old/AGENTS.md",
			action: "delete",
			reason: "Package removed",
			currentContent: "# Old Package\n",
		};
		const diffResult = generateDiffForUpdate(update);
		const formatted = formatDiffForComment(diffResult, update);

		expect(formatted).toContain("### Delete: `packages/old/AGENTS.md`");
		expect(formatted).toContain("**Reason:** Package removed");
	});

	test("includes stats line", () => {
		const update: IntentUpdate = {
			nodePath: "test/AGENTS.md",
			action: "create",
			reason: "Test",
			suggestedContent: "line1\nline2\nline3\n",
		};
		const diffResult = generateDiffForUpdate(update);
		const formatted = formatDiffForComment(diffResult, update);

		expect(formatted).toContain("**+");
		expect(formatted).toContain("lines**");
	});

	test("handles update with no changes gracefully", () => {
		const update: IntentUpdate = {
			nodePath: "test/AGENTS.md",
			action: "update",
			reason: "Review",
			currentContent: "same\n",
			suggestedContent: "same\n",
		};
		const diffResult = generateDiffForUpdate(update);
		const formatted = formatDiffForComment(diffResult, update);

		expect(formatted).toContain("No changes detected");
	});
});

describe("formatBeforeAfterForComment", () => {
	test("formats create action with proposed content", () => {
		const update: IntentUpdate = {
			nodePath: "packages/new/AGENTS.md",
			action: "create",
			reason: "New package",
			suggestedContent: "# New Package\n\nContext.\n",
		};
		const formatted = formatBeforeAfterForComment(update);

		expect(formatted).toContain("### Create: `packages/new/AGENTS.md`");
		expect(formatted).toContain("View proposed content");
		expect(formatted).toContain("```markdown");
		expect(formatted).toContain("# New Package");
	});

	test("formats delete action with content to be removed", () => {
		const update: IntentUpdate = {
			nodePath: "packages/old/AGENTS.md",
			action: "delete",
			reason: "Package deprecated",
			currentContent: "# Old Package\n\nOld context.\n",
		};
		const formatted = formatBeforeAfterForComment(update);

		expect(formatted).toContain("### Delete: `packages/old/AGENTS.md`");
		expect(formatted).toContain("View content to be removed");
		expect(formatted).toContain("# Old Package");
	});

	test("formats update action with both current and proposed", () => {
		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "API changes",
			currentContent: "# API\n\nOld docs.\n",
			suggestedContent: "# API\n\nNew docs.\n",
		};
		const formatted = formatBeforeAfterForComment(update);

		expect(formatted).toContain("### Update: `packages/api/AGENTS.md`");
		expect(formatted).toContain("View current content");
		expect(formatted).toContain("View proposed content");
		expect(formatted).toContain("Old docs.");
		expect(formatted).toContain("New docs.");
	});

	test("includes reason in output", () => {
		const update: IntentUpdate = {
			nodePath: "test/AGENTS.md",
			action: "create",
			reason: "Specific detailed reason here",
			suggestedContent: "content\n",
		};
		const formatted = formatBeforeAfterForComment(update);

		expect(formatted).toContain("**Reason:** Specific detailed reason here");
	});
});
