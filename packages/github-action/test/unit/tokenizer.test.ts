import { describe, expect, test } from "bun:test";
import {
	calculateCoveredCodeTokens,
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
