import { describe, expect, test } from "bun:test";
import {
	analyzeHierarchyForSplits,
	analyzeNodeForSplit,
	calculateCoveredCodeTokens,
	calculateHierarchyTokenBudget,
	calculateNodeTokenBudget,
	calculateTokenBudget,
	countLines,
	countTokens,
	countTokensMultiple,
	countTokensWithOptions,
	isBinaryContent,
} from "../../src/intent/tokenizer";

describe("countTokens", () => {
	test("returns 0 for empty string", () => {
		expect(countTokens("")).toBe(0);
	});

	test("returns 0 for null/undefined-like falsy content", () => {
		expect(countTokens("")).toBe(0);
	});

	test("counts tokens using chars/4 heuristic", () => {
		// 4 chars = 1 token
		expect(countTokens("abcd")).toBe(1);

		// 8 chars = 2 tokens
		expect(countTokens("abcdefgh")).toBe(2);

		// 12 chars = 3 tokens
		expect(countTokens("abcdefghijkl")).toBe(3);
	});

	test("rounds up for partial tokens", () => {
		// 1 char = ceil(1/4) = 1 token
		expect(countTokens("a")).toBe(1);

		// 5 chars = ceil(5/4) = 2 tokens
		expect(countTokens("abcde")).toBe(2);

		// 7 chars = ceil(7/4) = 2 tokens
		expect(countTokens("abcdefg")).toBe(2);
	});

	test("handles whitespace", () => {
		// Whitespace counts as characters
		expect(countTokens("    ")).toBe(1); // 4 spaces = 1 token
		expect(countTokens("a b")).toBe(1); // 3 chars = 1 token
	});

	test("handles newlines", () => {
		// Newlines count as characters
		expect(countTokens("a\nb")).toBe(1); // 3 chars = 1 token
		expect(countTokens("line1\nline2\nline3")).toBe(5); // 17 chars = 5 tokens
	});

	test("handles realistic code content", () => {
		const code = `function hello() {
  console.log("Hello, world!");
}`;
		// This has 52 characters, so ceil(52/4) = 13 tokens
		expect(countTokens(code)).toBe(13);
	});
});

describe("countTokensMultiple", () => {
	test("returns 0 for empty array", () => {
		expect(countTokensMultiple([])).toBe(0);
	});

	test("sums tokens across multiple strings", () => {
		const contents = ["abcd", "efgh"]; // 4 + 4 = 8 chars = 2 tokens
		expect(countTokensMultiple(contents)).toBe(2);
	});

	test("handles mixed content sizes", () => {
		const contents = [
			"a", // 1 char = 1 token
			"abcd", // 4 chars = 1 token
			"abcdefgh", // 8 chars = 2 tokens
		];
		expect(countTokensMultiple(contents)).toBe(4);
	});

	test("handles empty strings in array", () => {
		const contents = ["abcd", "", "efgh"];
		expect(countTokensMultiple(contents)).toBe(2);
	});
});

describe("calculateTokenBudget", () => {
	test("calculates budget percentage correctly", () => {
		// 100 chars in node = 25 tokens
		// 1000 chars in code = 250 tokens
		// Budget = (25/250) * 100 = 10%
		const nodeContent = "a".repeat(100);
		const codeContents = ["a".repeat(1000)];

		const result = calculateTokenBudget(nodeContent, codeContents, 5);

		expect(result.nodeTokens).toBe(25);
		expect(result.coveredCodeTokens).toBe(250);
		expect(result.budgetPercent).toBe(10);
		expect(result.exceedsBudget).toBe(true);
	});

	test("returns exceedsBudget false when under threshold", () => {
		// 20 chars in node = 5 tokens
		// 1000 chars in code = 250 tokens
		// Budget = (5/250) * 100 = 2%
		const nodeContent = "a".repeat(20);
		const codeContents = ["a".repeat(1000)];

		const result = calculateTokenBudget(nodeContent, codeContents, 5);

		expect(result.budgetPercent).toBe(2);
		expect(result.exceedsBudget).toBe(false);
	});

	test("handles zero covered code (avoids division by zero)", () => {
		const nodeContent = "some content";
		const codeContents: string[] = [];

		const result = calculateTokenBudget(nodeContent, codeContents, 5);

		expect(result.coveredCodeTokens).toBe(0);
		expect(result.budgetPercent).toBe(0);
		expect(result.exceedsBudget).toBe(false);
	});

	test("uses default threshold of 5%", () => {
		// 50 chars in node = 13 tokens (ceil)
		// 1000 chars in code = 250 tokens
		// Budget = (13/250) * 100 = 5.2%
		const nodeContent = "a".repeat(52);
		const codeContents = ["a".repeat(1000)];

		const result = calculateTokenBudget(nodeContent, codeContents);

		expect(result.exceedsBudget).toBe(true);
	});

	test("handles multiple code files", () => {
		const nodeContent = "a".repeat(40); // 10 tokens
		const codeContents = [
			"a".repeat(400), // 100 tokens
			"b".repeat(400), // 100 tokens
		];

		const result = calculateTokenBudget(nodeContent, codeContents, 5);

		expect(result.coveredCodeTokens).toBe(200);
		expect(result.budgetPercent).toBe(5);
		expect(result.exceedsBudget).toBe(false); // exactly at threshold, not exceeding
	});
});

describe("isBinaryContent", () => {
	test("returns true for content with null bytes", () => {
		expect(isBinaryContent("hello\0world")).toBe(true);
		expect(isBinaryContent("\0")).toBe(true);
	});

	test("returns false for normal text content", () => {
		expect(isBinaryContent("hello world")).toBe(false);
		expect(isBinaryContent("function foo() {}")).toBe(false);
		expect(isBinaryContent("")).toBe(false);
	});

	test("returns false for content with special chars but no null bytes", () => {
		expect(isBinaryContent("line1\nline2\ttabbed")).toBe(false);
		expect(isBinaryContent("unicode: \u2603")).toBe(false);
	});
});

describe("countLines", () => {
	test("returns 0 for empty string", () => {
		expect(countLines("")).toBe(0);
	});

	test("returns 1 for single line without newline", () => {
		expect(countLines("hello")).toBe(1);
	});

	test("returns 1 for single line with trailing newline", () => {
		expect(countLines("hello\n")).toBe(1);
	});

	test("counts multiple lines correctly", () => {
		expect(countLines("line1\nline2")).toBe(2);
		expect(countLines("line1\nline2\n")).toBe(2);
		expect(countLines("a\nb\nc")).toBe(3);
		expect(countLines("a\nb\nc\n")).toBe(3);
	});

	test("handles empty lines", () => {
		expect(countLines("\n")).toBe(1);
		expect(countLines("\n\n")).toBe(2);
		expect(countLines("a\n\nb")).toBe(3);
	});
});

describe("countTokensWithOptions", () => {
	test("counts tokens normally for regular content", () => {
		const result = countTokensWithOptions("abcdefgh");
		expect(result.tokens).toBe(2);
		expect(result.skipped).toBe(false);
		expect(result.skipReason).toBeUndefined();
	});

	test("skips binary files by default", () => {
		const result = countTokensWithOptions("hello\0world");
		expect(result.tokens).toBe(0);
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("binary");
	});

	test("does not skip binary files when option disabled", () => {
		const result = countTokensWithOptions("hello\0world", {
			skipBinaryFiles: false,
		});
		expect(result.tokens).toBe(3); // 11 chars = 3 tokens
		expect(result.skipped).toBe(false);
	});

	test("skips files exceeding max lines", () => {
		// Create content with 10 lines
		const content = "line\n".repeat(10);
		const result = countTokensWithOptions(content, { fileMaxLines: 5 });
		expect(result.tokens).toBe(0);
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("too_large");
	});

	test("does not skip files under max lines", () => {
		const content = "line\n".repeat(5);
		const result = countTokensWithOptions(content, { fileMaxLines: 10 });
		expect(result.skipped).toBe(false);
	});

	test("uses default max lines of 8000", () => {
		// 8001 lines should be skipped
		const content = "a\n".repeat(8001);
		const result = countTokensWithOptions(content);
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe("too_large");
	});

	test("does not skip when fileMaxLines is 0 (disabled)", () => {
		const content = "line\n".repeat(10000);
		const result = countTokensWithOptions(content, { fileMaxLines: 0 });
		expect(result.skipped).toBe(false);
	});

	test("binary check takes precedence over size check", () => {
		// Binary content that is also large
		const content = "a\0".repeat(10000);
		const result = countTokensWithOptions(content, { fileMaxLines: 5 });
		expect(result.skipReason).toBe("binary");
	});
});

describe("calculateCoveredCodeTokens", () => {
	test("returns zero totals for empty file list", () => {
		const result = calculateCoveredCodeTokens([], new Map(), {});

		expect(result.totalTokens).toBe(0);
		expect(result.filesCounted).toBe(0);
		expect(result.filesSkipped).toBe(0);
		expect(result.fileDetails).toHaveLength(0);
	});

	test("counts tokens for single file", () => {
		const fileContents = new Map([
			["src/index.ts", "abcdefgh"], // 8 chars = 2 tokens
		]);

		const result = calculateCoveredCodeTokens(
			["src/index.ts"],
			fileContents,
			{},
		);

		expect(result.totalTokens).toBe(2);
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(0);
		expect(result.fileDetails).toHaveLength(1);
		expect(result.fileDetails[0]).toEqual({
			path: "src/index.ts",
			tokens: 2,
			skipped: false,
			skipReason: undefined,
		});
	});

	test("counts tokens across multiple files", () => {
		const fileContents = new Map([
			["src/index.ts", "abcd"], // 4 chars = 1 token
			["src/utils.ts", "abcdefgh"], // 8 chars = 2 tokens
			["src/config.ts", "abcdefghijkl"], // 12 chars = 3 tokens
		]);

		const result = calculateCoveredCodeTokens(
			["src/index.ts", "src/utils.ts", "src/config.ts"],
			fileContents,
			{},
		);

		expect(result.totalTokens).toBe(6);
		expect(result.filesCounted).toBe(3);
		expect(result.filesSkipped).toBe(0);
		expect(result.fileDetails).toHaveLength(3);
	});

	test("skips binary files", () => {
		const fileContents = new Map([
			["src/index.ts", "abcdefgh"], // Normal: 8 chars = 2 tokens
			["assets/image.png", "binary\0content"], // Binary
		]);

		const result = calculateCoveredCodeTokens(
			["src/index.ts", "assets/image.png"],
			fileContents,
			{ skipBinaryFiles: true },
		);

		expect(result.totalTokens).toBe(2);
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(1);
		expect(result.fileDetails).toHaveLength(2);

		const binaryFile = result.fileDetails.find(
			(f) => f.path === "assets/image.png",
		);
		expect(binaryFile?.skipped).toBe(true);
		expect(binaryFile?.skipReason).toBe("binary");
		expect(binaryFile?.tokens).toBe(0);
	});

	test("skips large files", () => {
		const fileContents = new Map([
			["src/small.ts", "abcd"], // Small: 4 chars = 1 token
			["src/large.ts", "line\n".repeat(100)], // 100 lines
		]);

		const result = calculateCoveredCodeTokens(
			["src/small.ts", "src/large.ts"],
			fileContents,
			{ fileMaxLines: 50 },
		);

		expect(result.totalTokens).toBe(1);
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(1);

		const largeFile = result.fileDetails.find((f) => f.path === "src/large.ts");
		expect(largeFile?.skipped).toBe(true);
		expect(largeFile?.skipReason).toBe("too_large");
		expect(largeFile?.tokens).toBe(0);
	});

	test("ignores files not in fileContents map", () => {
		const fileContents = new Map([
			["src/index.ts", "abcd"], // 4 chars = 1 token
		]);

		const result = calculateCoveredCodeTokens(
			["src/index.ts", "src/missing.ts"],
			fileContents,
			{},
		);

		// missing.ts is silently ignored (not in fileContents)
		expect(result.totalTokens).toBe(1);
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(0);
		expect(result.fileDetails).toHaveLength(1);
	});

	test("does not skip binary when option disabled", () => {
		const fileContents = new Map([
			["assets/image.png", "hello\0world"], // Binary but counted: 11 chars = 3 tokens
		]);

		const result = calculateCoveredCodeTokens(
			["assets/image.png"],
			fileContents,
			{ skipBinaryFiles: false },
		);

		expect(result.totalTokens).toBe(3);
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(0);
	});

	test("handles mixed skipped and counted files", () => {
		const fileContents = new Map([
			["src/index.ts", "abcdefgh"], // Normal: 2 tokens
			["src/binary.bin", "data\0data"], // Binary: skipped
			["src/huge.ts", "a\n".repeat(10000)], // Too large: skipped
			["src/util.ts", "abcd"], // Normal: 1 token
		]);

		const result = calculateCoveredCodeTokens(
			["src/index.ts", "src/binary.bin", "src/huge.ts", "src/util.ts"],
			fileContents,
			{ skipBinaryFiles: true, fileMaxLines: 8000 },
		);

		expect(result.totalTokens).toBe(3); // 2 + 1
		expect(result.filesCounted).toBe(2);
		expect(result.filesSkipped).toBe(2);
		expect(result.fileDetails).toHaveLength(4);
	});

	test("uses default options when not specified", () => {
		const fileContents = new Map([
			["src/index.ts", "abcd"],
			["src/binary.bin", "data\0data"], // Should be skipped by default
		]);

		const result = calculateCoveredCodeTokens(
			["src/index.ts", "src/binary.bin"],
			fileContents,
		);

		// Binary files skipped by default
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(1);
	});

	test("provides accurate file details in order", () => {
		const fileContents = new Map([
			["a.ts", "aaaa"], // 1 token
			["b.ts", "bbbbbbbb"], // 2 tokens
		]);

		const result = calculateCoveredCodeTokens(
			["a.ts", "b.ts"],
			fileContents,
			{},
		);

		expect(result.fileDetails).toEqual([
			{ path: "a.ts", tokens: 1, skipped: false, skipReason: undefined },
			{ path: "b.ts", tokens: 2, skipped: false, skipReason: undefined },
		]);
	});
});

describe("calculateNodeTokenBudget", () => {
	test("calculates budget for a single node", () => {
		const nodePath = "AGENTS.md";
		const nodeContent = "a".repeat(100); // 100 chars = 25 tokens
		const coveredFilePaths = ["src/index.ts"];
		const fileContents = new Map([
			["src/index.ts", "a".repeat(1000)], // 1000 chars = 250 tokens
		]);

		const result = calculateNodeTokenBudget(
			nodePath,
			nodeContent,
			coveredFilePaths,
			fileContents,
			5,
		);

		expect(result.nodePath).toBe("AGENTS.md");
		expect(result.nodeTokens).toBe(25);
		expect(result.coveredCodeTokens).toBe(250);
		expect(result.budgetPercent).toBe(10); // (25/250) * 100
		expect(result.exceedsBudget).toBe(true);
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(0);
	});

	test("returns under budget when percentage is low", () => {
		const nodePath = "src/AGENTS.md";
		const nodeContent = "a".repeat(20); // 20 chars = 5 tokens
		const coveredFilePaths = ["src/index.ts", "src/utils.ts"];
		const fileContents = new Map([
			["src/index.ts", "a".repeat(500)], // 125 tokens
			["src/utils.ts", "a".repeat(500)], // 125 tokens
		]);

		const result = calculateNodeTokenBudget(
			nodePath,
			nodeContent,
			coveredFilePaths,
			fileContents,
			5,
		);

		expect(result.nodeTokens).toBe(5);
		expect(result.coveredCodeTokens).toBe(250);
		expect(result.budgetPercent).toBe(2); // (5/250) * 100
		expect(result.exceedsBudget).toBe(false);
		expect(result.filesCounted).toBe(2);
	});

	test("handles zero covered code", () => {
		const nodePath = "empty/AGENTS.md";
		const nodeContent = "Some documentation";
		const coveredFilePaths: string[] = [];
		const fileContents = new Map<string, string>();

		const result = calculateNodeTokenBudget(
			nodePath,
			nodeContent,
			coveredFilePaths,
			fileContents,
			5,
		);

		expect(result.coveredCodeTokens).toBe(0);
		expect(result.budgetPercent).toBe(0);
		expect(result.exceedsBudget).toBe(false);
		expect(result.filesCounted).toBe(0);
	});

	test("skips binary files in covered code", () => {
		const nodePath = "AGENTS.md";
		const nodeContent = "a".repeat(40); // 10 tokens
		const coveredFilePaths = ["src/index.ts", "assets/image.png"];
		const fileContents = new Map([
			["src/index.ts", "a".repeat(400)], // 100 tokens
			["assets/image.png", "binary\0content"], // Binary - skipped
		]);

		const result = calculateNodeTokenBudget(
			nodePath,
			nodeContent,
			coveredFilePaths,
			fileContents,
			5,
			{ skipBinaryFiles: true },
		);

		expect(result.coveredCodeTokens).toBe(100); // Only index.ts counted
		expect(result.filesCounted).toBe(1);
		expect(result.filesSkipped).toBe(1);
		expect(result.budgetPercent).toBe(10); // (10/100) * 100
	});

	test("uses default budget threshold of 5%", () => {
		const nodePath = "AGENTS.md";
		const nodeContent = "a".repeat(24); // 6 tokens
		const coveredFilePaths = ["src/index.ts"];
		const fileContents = new Map([
			["src/index.ts", "a".repeat(400)], // 100 tokens
		]);

		// 6% budget, should exceed default 5% threshold
		const result = calculateNodeTokenBudget(
			nodePath,
			nodeContent,
			coveredFilePaths,
			fileContents,
		);

		expect(result.budgetPercent).toBe(6);
		expect(result.exceedsBudget).toBe(true);
	});
});

describe("calculateHierarchyTokenBudget", () => {
	test("calculates budget for multiple nodes", () => {
		const coveredFilesMap = new Map([
			["AGENTS.md", { coveredFiles: ["src/index.ts"] }],
			["packages/api/AGENTS.md", { coveredFiles: ["packages/api/client.ts"] }],
		]);

		const nodeContents = new Map([
			["AGENTS.md", "a".repeat(40)], // 10 tokens
			["packages/api/AGENTS.md", "a".repeat(20)], // 5 tokens
		]);

		const fileContents = new Map([
			["src/index.ts", "a".repeat(400)], // 100 tokens
			["packages/api/client.ts", "a".repeat(400)], // 100 tokens
		]);

		const result = calculateHierarchyTokenBudget(
			coveredFilesMap,
			nodeContents,
			fileContents,
			5,
		);

		expect(result.totalNodes).toBe(2);
		expect(result.nodeResults.size).toBe(2);

		const rootResult = result.nodeResults.get("AGENTS.md");
		expect(rootResult?.budgetPercent).toBe(10);
		expect(rootResult?.exceedsBudget).toBe(true);

		const apiResult = result.nodeResults.get("packages/api/AGENTS.md");
		expect(apiResult?.budgetPercent).toBe(5);
		expect(apiResult?.exceedsBudget).toBe(false);
	});

	test("tracks nodes exceeding budget", () => {
		const coveredFilesMap = new Map([
			["under/AGENTS.md", { coveredFiles: ["under/file.ts"] }],
			["over/AGENTS.md", { coveredFiles: ["over/file.ts"] }],
		]);

		const nodeContents = new Map([
			["under/AGENTS.md", "a".repeat(8)], // 2 tokens
			["over/AGENTS.md", "a".repeat(40)], // 10 tokens
		]);

		const fileContents = new Map([
			["under/file.ts", "a".repeat(400)], // 100 tokens
			["over/file.ts", "a".repeat(400)], // 100 tokens
		]);

		const result = calculateHierarchyTokenBudget(
			coveredFilesMap,
			nodeContents,
			fileContents,
			5,
		);

		expect(result.exceedingCount).toBe(1);
		expect(result.nodesExceedingBudget).toHaveLength(1);
		expect(result.nodesExceedingBudget[0]?.nodePath).toBe("over/AGENTS.md");
	});

	test("handles empty hierarchy", () => {
		const result = calculateHierarchyTokenBudget(
			new Map(),
			new Map(),
			new Map(),
			5,
		);

		expect(result.totalNodes).toBe(0);
		expect(result.exceedingCount).toBe(0);
		expect(result.nodeResults.size).toBe(0);
		expect(result.nodesExceedingBudget).toHaveLength(0);
	});

	test("skips nodes with missing content", () => {
		const coveredFilesMap = new Map([
			["AGENTS.md", { coveredFiles: ["src/index.ts"] }],
			["missing/AGENTS.md", { coveredFiles: ["missing/file.ts"] }],
		]);

		const nodeContents = new Map([
			["AGENTS.md", "a".repeat(40)], // Only root has content
		]);

		const fileContents = new Map([
			["src/index.ts", "a".repeat(400)],
			["missing/file.ts", "a".repeat(400)],
		]);

		const result = calculateHierarchyTokenBudget(
			coveredFilesMap,
			nodeContents,
			fileContents,
			5,
		);

		// Only 1 node should be processed (missing/AGENTS.md is skipped)
		expect(result.totalNodes).toBe(1);
		expect(result.nodeResults.has("AGENTS.md")).toBe(true);
		expect(result.nodeResults.has("missing/AGENTS.md")).toBe(false);
	});

	test("applies skip options for binary and large files", () => {
		const coveredFilesMap = new Map([
			["AGENTS.md", { coveredFiles: ["src/code.ts", "assets/binary.png"] }],
		]);

		const nodeContents = new Map([
			["AGENTS.md", "a".repeat(40)], // 10 tokens
		]);

		const fileContents = new Map([
			["src/code.ts", "a".repeat(400)], // 100 tokens
			["assets/binary.png", "binary\0data"], // Binary - skipped
		]);

		const result = calculateHierarchyTokenBudget(
			coveredFilesMap,
			nodeContents,
			fileContents,
			5,
			{ skipBinaryFiles: true },
		);

		const nodeResult = result.nodeResults.get("AGENTS.md");
		expect(nodeResult?.filesCounted).toBe(1);
		expect(nodeResult?.filesSkipped).toBe(1);
		expect(nodeResult?.coveredCodeTokens).toBe(100); // Only code.ts
	});

	test("uses custom budget threshold", () => {
		const coveredFilesMap = new Map([
			["AGENTS.md", { coveredFiles: ["src/index.ts"] }],
		]);

		const nodeContents = new Map([
			["AGENTS.md", "a".repeat(40)], // 10 tokens
		]);

		const fileContents = new Map([
			["src/index.ts", "a".repeat(400)], // 100 tokens
		]);

		// 10% budget with 15% threshold should NOT exceed
		const result = calculateHierarchyTokenBudget(
			coveredFilesMap,
			nodeContents,
			fileContents,
			15, // Higher threshold
		);

		const nodeResult = result.nodeResults.get("AGENTS.md");
		expect(nodeResult?.budgetPercent).toBe(10);
		expect(nodeResult?.exceedsBudget).toBe(false);
		expect(result.exceedingCount).toBe(0);
	});
});

describe("analyzeNodeForSplit", () => {
	test("returns shouldSplit false when under budget", () => {
		const result = analyzeNodeForSplit(
			"AGENTS.md",
			"",
			["src/index.ts", "src/utils.ts"],
			new Map([
				["src/index.ts", "a".repeat(400)],
				["src/utils.ts", "a".repeat(400)],
			]),
			3, // 3% budget - under threshold
			5,
		);

		expect(result.shouldSplit).toBe(false);
		expect(result.suggestions).toHaveLength(0);
	});

	test("suggests splits for subdirectories with substantial coverage", () => {
		// Node exceeds budget at 10%
		// Two subdirectories: src/api (3 files) and src/utils (3 files)
		const coveredFiles = [
			"src/api/client.ts",
			"src/api/routes.ts",
			"src/api/handlers.ts",
			"src/utils/helpers.ts",
			"src/utils/format.ts",
			"src/utils/validate.ts",
		];

		const fileContents = new Map([
			["src/api/client.ts", "a".repeat(200)], // 50 tokens
			["src/api/routes.ts", "a".repeat(200)], // 50 tokens
			["src/api/handlers.ts", "a".repeat(200)], // 50 tokens
			["src/utils/helpers.ts", "a".repeat(200)], // 50 tokens
			["src/utils/format.ts", "a".repeat(200)], // 50 tokens
			["src/utils/validate.ts", "a".repeat(200)], // 50 tokens
		]);

		const result = analyzeNodeForSplit(
			"src/AGENTS.md",
			"src",
			coveredFiles,
			fileContents,
			10, // 10% budget - exceeds 5% threshold
			5,
		);

		expect(result.shouldSplit).toBe(true);
		expect(result.suggestions.length).toBeGreaterThanOrEqual(2);

		// Both api and utils should be suggested
		const suggestedDirs = result.suggestions.map((s) => s.suggestedDirectory);
		expect(suggestedDirs).toContain("src/api");
		expect(suggestedDirs).toContain("src/utils");
	});

	test("skips subdirectories with too few files", () => {
		// Only 2 files in subdirectory (less than MIN_FILES_FOR_SPLIT = 3)
		const coveredFiles = [
			"src/api/client.ts",
			"src/api/routes.ts",
			"src/index.ts",
			"src/config.ts",
			"src/main.ts",
		];

		const fileContents = new Map([
			["src/api/client.ts", "a".repeat(200)],
			["src/api/routes.ts", "a".repeat(200)],
			["src/index.ts", "a".repeat(200)],
			["src/config.ts", "a".repeat(200)],
			["src/main.ts", "a".repeat(200)],
		]);

		const result = analyzeNodeForSplit(
			"src/AGENTS.md",
			"src",
			coveredFiles,
			fileContents,
			10,
			5,
		);

		expect(result.shouldSplit).toBe(true);
		// api subdirectory has only 2 files, should NOT be suggested
		const apiSuggestion = result.suggestions.find(
			(s) => s.suggestedDirectory === "src/api",
		);
		expect(apiSuggestion).toBeUndefined();
	});

	test("skips subdirectories with too small coverage percentage", () => {
		// One small subdirectory and one large one
		const coveredFiles = [
			"src/api/client.ts",
			"src/api/routes.ts",
			"src/api/handlers.ts",
			"src/tiny/small.ts",
			"src/tiny/mini.ts",
			"src/tiny/nano.ts",
			"src/main.ts",
		];

		const fileContents = new Map([
			["src/api/client.ts", "a".repeat(400)], // 100 tokens each
			["src/api/routes.ts", "a".repeat(400)],
			["src/api/handlers.ts", "a".repeat(400)],
			["src/tiny/small.ts", "a".repeat(4)], // 1 token each - tiny
			["src/tiny/mini.ts", "a".repeat(4)],
			["src/tiny/nano.ts", "a".repeat(4)],
			["src/main.ts", "a".repeat(400)],
		]);

		const result = analyzeNodeForSplit(
			"src/AGENTS.md",
			"src",
			coveredFiles,
			fileContents,
			10,
			5,
		);

		expect(result.shouldSplit).toBe(true);
		// tiny has 3 files but <10% coverage
		const tinySuggestion = result.suggestions.find(
			(s) => s.suggestedDirectory === "src/tiny",
		);
		expect(tinySuggestion).toBeUndefined();

		// api should be suggested
		const apiSuggestion = result.suggestions.find(
			(s) => s.suggestedDirectory === "src/api",
		);
		expect(apiSuggestion).toBeDefined();
	});

	test("skips subdirectories that already have intent nodes", () => {
		const coveredFiles = [
			"src/api/client.ts",
			"src/api/routes.ts",
			"src/api/handlers.ts",
		];

		const fileContents = new Map([
			["src/api/client.ts", "a".repeat(200)],
			["src/api/routes.ts", "a".repeat(200)],
			["src/api/handlers.ts", "a".repeat(200)],
		]);

		// src/api already has an intent node
		const existingNodeDirectories = new Set(["src/api"]);

		const result = analyzeNodeForSplit(
			"src/AGENTS.md",
			"src",
			coveredFiles,
			fileContents,
			10,
			5,
			existingNodeDirectories,
		);

		expect(result.shouldSplit).toBe(true);
		expect(result.suggestions).toHaveLength(0);
	});

	test("handles root-level node correctly", () => {
		const coveredFiles = [
			"packages/api/index.ts",
			"packages/api/client.ts",
			"packages/api/routes.ts",
			"packages/web/app.ts",
			"packages/web/pages.ts",
			"packages/web/components.ts",
		];

		const fileContents = new Map([
			["packages/api/index.ts", "a".repeat(200)],
			["packages/api/client.ts", "a".repeat(200)],
			["packages/api/routes.ts", "a".repeat(200)],
			["packages/web/app.ts", "a".repeat(200)],
			["packages/web/pages.ts", "a".repeat(200)],
			["packages/web/components.ts", "a".repeat(200)],
		]);

		const result = analyzeNodeForSplit(
			"AGENTS.md",
			"", // Root directory
			coveredFiles,
			fileContents,
			10,
			5,
		);

		expect(result.shouldSplit).toBe(true);
		// Should suggest "packages" as the immediate subdirectory
		const packagesSuggestion = result.suggestions.find(
			(s) => s.suggestedDirectory === "packages",
		);
		expect(packagesSuggestion).toBeDefined();
	});

	test("uses custom intent file name", () => {
		const coveredFiles = [
			"src/api/client.ts",
			"src/api/routes.ts",
			"src/api/handlers.ts",
		];

		const fileContents = new Map([
			["src/api/client.ts", "a".repeat(200)],
			["src/api/routes.ts", "a".repeat(200)],
			["src/api/handlers.ts", "a".repeat(200)],
		]);

		const result = analyzeNodeForSplit(
			"src/CLAUDE.md",
			"src",
			coveredFiles,
			fileContents,
			10,
			5,
			new Set(),
			{},
			"CLAUDE.md",
		);

		expect(result.suggestions[0]?.suggestedNodePath).toBe("src/api/CLAUDE.md");
	});

	test("sorts suggestions by coverage percentage descending", () => {
		const coveredFiles = [
			"src/small/a.ts",
			"src/small/b.ts",
			"src/small/c.ts",
			"src/large/x.ts",
			"src/large/y.ts",
			"src/large/z.ts",
		];

		// Make both subdirectories have >10% coverage
		// small: 3 files x 200 chars = 600 chars = 150 tokens (30%)
		// large: 3 files x 400 chars = 1200 chars = 300 tokens (60%)
		// other: none, so remaining 10% is just for coverage calculation purposes
		// Total: 450 tokens
		const fileContents = new Map([
			["src/small/a.ts", "a".repeat(200)], // 50 tokens each
			["src/small/b.ts", "a".repeat(200)],
			["src/small/c.ts", "a".repeat(200)],
			["src/large/x.ts", "a".repeat(400)], // 100 tokens each
			["src/large/y.ts", "a".repeat(400)],
			["src/large/z.ts", "a".repeat(400)],
		]);
		// small: 150 tokens / 450 total = 33.3%
		// large: 300 tokens / 450 total = 66.7%

		const result = analyzeNodeForSplit(
			"src/AGENTS.md",
			"src",
			coveredFiles,
			fileContents,
			10,
			5,
		);

		expect(result.suggestions).toHaveLength(2);
		// Large should come first (higher coverage)
		expect(result.suggestions[0]?.suggestedDirectory).toBe("src/large");
		expect(result.suggestions[1]?.suggestedDirectory).toBe("src/small");
	});

	test("calculates coveragePercent correctly", () => {
		const coveredFiles = [
			"src/api/a.ts",
			"src/api/b.ts",
			"src/api/c.ts",
			"src/other.ts",
		];

		const fileContents = new Map([
			["src/api/a.ts", "a".repeat(100)], // 25 tokens
			["src/api/b.ts", "a".repeat(100)], // 25 tokens
			["src/api/c.ts", "a".repeat(100)], // 25 tokens
			["src/other.ts", "a".repeat(100)], // 25 tokens
		]);
		// Total: 100 tokens, api: 75 tokens = 75%

		const result = analyzeNodeForSplit(
			"src/AGENTS.md",
			"src",
			coveredFiles,
			fileContents,
			10,
			5,
		);

		const apiSuggestion = result.suggestions.find(
			(s) => s.suggestedDirectory === "src/api",
		);
		expect(apiSuggestion?.coveragePercent).toBe(75);
		expect(apiSuggestion?.coveredTokens).toBe(75);
	});
});

describe("analyzeHierarchyForSplits", () => {
	test("analyzes all nodes exceeding budget", () => {
		// Create hierarchy budget result with one exceeding node
		const hierarchyBudgetResult = {
			nodeResults: new Map([
				[
					"AGENTS.md",
					{
						nodePath: "AGENTS.md",
						nodeTokens: 10,
						coveredCodeTokens: 100,
						budgetPercent: 10,
						exceedsBudget: true,
						filesCounted: 6,
						filesSkipped: 0,
					},
				],
			]),
			nodesExceedingBudget: [
				{
					nodePath: "AGENTS.md",
					nodeTokens: 10,
					coveredCodeTokens: 100,
					budgetPercent: 10,
					exceedsBudget: true,
					filesCounted: 6,
					filesSkipped: 0,
				},
			],
			totalNodes: 1,
			exceedingCount: 1,
		};

		const coveredFilesMap = new Map([
			[
				"AGENTS.md",
				{
					coveredFiles: [
						"src/api/a.ts",
						"src/api/b.ts",
						"src/api/c.ts",
						"src/utils/x.ts",
						"src/utils/y.ts",
						"src/utils/z.ts",
					],
				},
			],
		]);

		const nodeDirectories = new Map([["AGENTS.md", ""]]);

		const fileContents = new Map([
			["src/api/a.ts", "a".repeat(100)],
			["src/api/b.ts", "a".repeat(100)],
			["src/api/c.ts", "a".repeat(100)],
			["src/utils/x.ts", "a".repeat(100)],
			["src/utils/y.ts", "a".repeat(100)],
			["src/utils/z.ts", "a".repeat(100)],
		]);

		const result = analyzeHierarchyForSplits(
			hierarchyBudgetResult,
			coveredFilesMap,
			nodeDirectories,
			fileContents,
			5,
		);

		expect(result.nodesToSplit).toContain("AGENTS.md");
		expect(result.nodeAnalyses).toHaveLength(1);
		expect(result.totalSuggestions).toBeGreaterThanOrEqual(1);
	});

	test("returns empty results when no nodes exceed budget", () => {
		const hierarchyBudgetResult = {
			nodeResults: new Map([
				[
					"AGENTS.md",
					{
						nodePath: "AGENTS.md",
						nodeTokens: 2,
						coveredCodeTokens: 100,
						budgetPercent: 2,
						exceedsBudget: false,
						filesCounted: 3,
						filesSkipped: 0,
					},
				],
			]),
			nodesExceedingBudget: [],
			totalNodes: 1,
			exceedingCount: 0,
		};

		const result = analyzeHierarchyForSplits(
			hierarchyBudgetResult,
			new Map(),
			new Map(),
			new Map(),
			5,
		);

		expect(result.nodesToSplit).toHaveLength(0);
		expect(result.nodeAnalyses).toHaveLength(0);
		expect(result.totalSuggestions).toBe(0);
	});

	test("passes existingNodeDirectories to prevent duplicate suggestions", () => {
		const hierarchyBudgetResult = {
			nodeResults: new Map([
				[
					"AGENTS.md",
					{
						nodePath: "AGENTS.md",
						nodeTokens: 10,
						coveredCodeTokens: 100,
						budgetPercent: 10,
						exceedsBudget: true,
						filesCounted: 3,
						filesSkipped: 0,
					},
				],
			]),
			nodesExceedingBudget: [
				{
					nodePath: "AGENTS.md",
					nodeTokens: 10,
					coveredCodeTokens: 100,
					budgetPercent: 10,
					exceedsBudget: true,
					filesCounted: 3,
					filesSkipped: 0,
				},
			],
			totalNodes: 1,
			exceedingCount: 1,
		};

		const coveredFilesMap = new Map([
			[
				"AGENTS.md",
				{
					coveredFiles: ["src/api/a.ts", "src/api/b.ts", "src/api/c.ts"],
				},
			],
		]);

		const nodeDirectories = new Map([["AGENTS.md", ""]]);

		const fileContents = new Map([
			["src/api/a.ts", "a".repeat(100)],
			["src/api/b.ts", "a".repeat(100)],
			["src/api/c.ts", "a".repeat(100)],
		]);

		// src already has an intent node
		const existingNodeDirectories = new Set(["src"]);

		const result = analyzeHierarchyForSplits(
			hierarchyBudgetResult,
			coveredFilesMap,
			nodeDirectories,
			fileContents,
			5,
			existingNodeDirectories,
		);

		// No suggestions because src already has a node
		expect(result.totalSuggestions).toBe(0);
	});

	test("uses CLAUDE.md when specified", () => {
		const hierarchyBudgetResult = {
			nodeResults: new Map([
				[
					"CLAUDE.md",
					{
						nodePath: "CLAUDE.md",
						nodeTokens: 10,
						coveredCodeTokens: 100,
						budgetPercent: 10,
						exceedsBudget: true,
						filesCounted: 3,
						filesSkipped: 0,
					},
				],
			]),
			nodesExceedingBudget: [
				{
					nodePath: "CLAUDE.md",
					nodeTokens: 10,
					coveredCodeTokens: 100,
					budgetPercent: 10,
					exceedsBudget: true,
					filesCounted: 3,
					filesSkipped: 0,
				},
			],
			totalNodes: 1,
			exceedingCount: 1,
		};

		const coveredFilesMap = new Map([
			[
				"CLAUDE.md",
				{
					coveredFiles: ["src/api/a.ts", "src/api/b.ts", "src/api/c.ts"],
				},
			],
		]);

		const nodeDirectories = new Map([["CLAUDE.md", ""]]);

		const fileContents = new Map([
			["src/api/a.ts", "a".repeat(100)],
			["src/api/b.ts", "a".repeat(100)],
			["src/api/c.ts", "a".repeat(100)],
		]);

		const result = analyzeHierarchyForSplits(
			hierarchyBudgetResult,
			coveredFilesMap,
			nodeDirectories,
			fileContents,
			5,
			new Set(),
			{},
			"CLAUDE.md",
		);

		if (result.nodeAnalyses[0]?.suggestions[0]) {
			expect(result.nodeAnalyses[0].suggestions[0].suggestedNodePath).toContain(
				"CLAUDE.md",
			);
		}
	});
});
