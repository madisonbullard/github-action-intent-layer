/**
 * Integration test: token budget enforcement (binary/large file skipping)
 *
 * Tests the scenario where a repository has files that should be skipped
 * during token budget calculations:
 * - Binary files (files containing null bytes)
 * - Large files (exceeding fileMaxLines threshold)
 *
 * The action should correctly calculate token budgets while excluding these files.
 */

import { describe, expect, test } from "bun:test";
import type { IntentFile } from "../../src/intent/detector";
import {
	buildHierarchy,
	getCoveredFilesForNode,
} from "../../src/intent/hierarchy";
import {
	calculateCoveredCodeTokens,
	calculateHierarchyTokenBudget,
	calculateNodeTokenBudget,
	countLines,
	countTokens,
	countTokensWithOptions,
	isBinaryContent,
	type TokenCountOptions,
} from "../../src/intent/tokenizer";

/**
 * Create an IntentFile for testing.
 */
function createIntentFile(
	path: string,
	type: "agents" | "claude" = "agents",
): IntentFile {
	return {
		path,
		type,
		sha: `blob-${path.replace(/\//g, "-")}`,
		isSymlink: false,
		symlinkTarget: undefined,
	};
}

describe("Integration: token budget enforcement with binary/large file skipping", () => {
	describe("binary file detection and skipping", () => {
		test("binary content is correctly identified", () => {
			// Normal text content
			expect(isBinaryContent("Hello, world!")).toBe(false);
			expect(isBinaryContent("function foo() { return 1; }")).toBe(false);
			expect(isBinaryContent("line1\nline2\nline3")).toBe(false);

			// Binary content (contains null bytes)
			expect(isBinaryContent("binary\0data")).toBe(true);
			expect(isBinaryContent("\0")).toBe(true);
			expect(isBinaryContent("PNG\0\0\0header")).toBe(true);
		});

		test("binary files are skipped in token counting by default", () => {
			const normalResult = countTokensWithOptions("Hello, world!");
			expect(normalResult.skipped).toBe(false);
			expect(normalResult.tokens).toBeGreaterThan(0);

			const binaryResult = countTokensWithOptions("binary\0content");
			expect(binaryResult.skipped).toBe(true);
			expect(binaryResult.tokens).toBe(0);
			expect(binaryResult.skipReason).toBe("binary");
		});

		test("binary files can be included when option is disabled", () => {
			const result = countTokensWithOptions("binary\0content", {
				skipBinaryFiles: false,
			});
			expect(result.skipped).toBe(false);
			expect(result.tokens).toBeGreaterThan(0);
		});
	});

	describe("large file detection and skipping", () => {
		test("line counting works correctly", () => {
			expect(countLines("")).toBe(0);
			expect(countLines("single line")).toBe(1);
			expect(countLines("line1\nline2")).toBe(2);
			expect(countLines("line1\nline2\n")).toBe(2);
			expect(countLines("a\nb\nc\nd\ne")).toBe(5);
		});

		test("large files are skipped when exceeding line threshold", () => {
			// Create content with 100 lines
			const largeContent = "line of code\n".repeat(100);

			// Should be skipped with threshold of 50 lines
			const result = countTokensWithOptions(largeContent, { fileMaxLines: 50 });
			expect(result.skipped).toBe(true);
			expect(result.tokens).toBe(0);
			expect(result.skipReason).toBe("too_large");
		});

		test("files under line threshold are counted normally", () => {
			const content = "line of code\n".repeat(50);

			const result = countTokensWithOptions(content, { fileMaxLines: 100 });
			expect(result.skipped).toBe(false);
			expect(result.tokens).toBeGreaterThan(0);
		});

		test("default line threshold is 8000", () => {
			// 8001 lines should be skipped
			const largeContent = "a\n".repeat(8001);
			const result = countTokensWithOptions(largeContent);
			expect(result.skipped).toBe(true);
			expect(result.skipReason).toBe("too_large");

			// 8000 lines should be counted
			const okContent = "a\n".repeat(8000);
			const okResult = countTokensWithOptions(okContent);
			expect(okResult.skipped).toBe(false);
		});

		test("line threshold can be disabled with 0", () => {
			const largeContent = "line\n".repeat(20000);
			const result = countTokensWithOptions(largeContent, { fileMaxLines: 0 });
			expect(result.skipped).toBe(false);
			expect(result.tokens).toBeGreaterThan(0);
		});
	});

	describe("covered code token calculation with skip options", () => {
		test("skips binary files when calculating covered code tokens", () => {
			const fileContents = new Map([
				["src/index.ts", "export function main() { console.log('hello'); }"],
				["src/utils.ts", "export function helper() { return true; }"],
				["assets/image.png", "PNG\0\0\0fake-binary-data"],
			]);

			const result = calculateCoveredCodeTokens(
				["src/index.ts", "src/utils.ts", "assets/image.png"],
				fileContents,
				{ skipBinaryFiles: true },
			);

			expect(result.filesCounted).toBe(2);
			expect(result.filesSkipped).toBe(1);

			// Verify the binary file was skipped
			const binaryDetail = result.fileDetails.find(
				(f) => f.path === "assets/image.png",
			);
			expect(binaryDetail?.skipped).toBe(true);
			expect(binaryDetail?.skipReason).toBe("binary");
			expect(binaryDetail?.tokens).toBe(0);

			// Verify normal files were counted
			const indexDetail = result.fileDetails.find(
				(f) => f.path === "src/index.ts",
			);
			expect(indexDetail?.skipped).toBe(false);
			expect(indexDetail?.tokens).toBeGreaterThan(0);
		});

		test("skips large files when calculating covered code tokens", () => {
			const smallContent = "small file content";
			const largeContent = "line\n".repeat(200);

			const fileContents = new Map([
				["src/small.ts", smallContent],
				["src/large-generated.ts", largeContent],
			]);

			const result = calculateCoveredCodeTokens(
				["src/small.ts", "src/large-generated.ts"],
				fileContents,
				{ fileMaxLines: 100 },
			);

			expect(result.filesCounted).toBe(1);
			expect(result.filesSkipped).toBe(1);

			const largeDetail = result.fileDetails.find(
				(f) => f.path === "src/large-generated.ts",
			);
			expect(largeDetail?.skipped).toBe(true);
			expect(largeDetail?.skipReason).toBe("too_large");
		});

		test("handles mixed binary and large files", () => {
			const normalContent = "const x = 1;";
			const binaryContent = "binary\0data";
			const largeContent = "line\n".repeat(500);

			const fileContents = new Map([
				["src/normal.ts", normalContent],
				["assets/icon.png", binaryContent],
				["generated/big-file.ts", largeContent],
			]);

			const result = calculateCoveredCodeTokens(
				["src/normal.ts", "assets/icon.png", "generated/big-file.ts"],
				fileContents,
				{ skipBinaryFiles: true, fileMaxLines: 100 },
			);

			expect(result.filesCounted).toBe(1);
			expect(result.filesSkipped).toBe(2);
			expect(result.totalTokens).toBe(countTokens(normalContent));
		});
	});

	describe("node token budget calculation with skip options", () => {
		test("calculates correct budget when binary files are skipped", () => {
			const nodePath = "AGENTS.md";
			const nodeContent = "# Documentation\n\nBuild and development info.";
			const coveredFilePaths = [
				"src/index.ts",
				"src/utils.ts",
				"assets/image.png",
			];

			const fileContents = new Map([
				["src/index.ts", "a".repeat(400)], // 100 tokens
				["src/utils.ts", "a".repeat(400)], // 100 tokens
				["assets/image.png", `PNG\0\0\0${"x".repeat(10000)}`], // Binary - skipped
			]);

			const result = calculateNodeTokenBudget(
				nodePath,
				nodeContent,
				coveredFilePaths,
				fileContents,
				5,
				{ skipBinaryFiles: true },
			);

			// Binary file should be skipped, so only 200 tokens of covered code
			expect(result.coveredCodeTokens).toBe(200);
			expect(result.filesCounted).toBe(2);
			expect(result.filesSkipped).toBe(1);

			// Node tokens / covered code tokens * 100 = budget percent
			const expectedBudget = (result.nodeTokens / 200) * 100;
			expect(result.budgetPercent).toBeCloseTo(expectedBudget, 1);
		});

		test("calculates correct budget when large files are skipped", () => {
			const nodePath = "src/AGENTS.md";
			const nodeContent = "# Source Documentation";
			const coveredFilePaths = ["src/app.ts", "src/generated/schema.ts"];

			const smallContent = "a".repeat(200); // 50 tokens
			const largeContent = "line\n".repeat(10000); // Very large

			const fileContents = new Map([
				["src/app.ts", smallContent],
				["src/generated/schema.ts", largeContent],
			]);

			const result = calculateNodeTokenBudget(
				nodePath,
				nodeContent,
				coveredFilePaths,
				fileContents,
				5,
				{ fileMaxLines: 8000 },
			);

			// Large file should be skipped
			expect(result.filesCounted).toBe(1);
			expect(result.filesSkipped).toBe(1);
			expect(result.coveredCodeTokens).toBe(50);
		});
	});

	describe("hierarchy token budget with skip options", () => {
		test("calculates budget for hierarchy with binary files excluded", () => {
			// Set up a simple hierarchy with one root AGENTS.md
			const intentFiles = [createIntentFile("AGENTS.md")];
			const _hierarchy = buildHierarchy(intentFiles, "agents");

			// Define covered files including binary
			const coveredFilesMap = new Map([
				[
					"AGENTS.md",
					{
						coveredFiles: ["src/index.ts", "assets/logo.png", "src/utils.ts"],
					},
				],
			]);

			const nodeContents = new Map([
				["AGENTS.md", "a".repeat(40)], // 10 tokens
			]);

			const fileContents = new Map([
				["src/index.ts", "a".repeat(200)], // 50 tokens
				["assets/logo.png", "PNG\0binary"], // Binary
				["src/utils.ts", "a".repeat(200)], // 50 tokens
			]);

			const result = calculateHierarchyTokenBudget(
				coveredFilesMap,
				nodeContents,
				fileContents,
				5,
				{ skipBinaryFiles: true },
			);

			expect(result.totalNodes).toBe(1);

			const nodeResult = result.nodeResults.get("AGENTS.md");
			expect(nodeResult).toBeDefined();
			expect(nodeResult?.filesCounted).toBe(2);
			expect(nodeResult?.filesSkipped).toBe(1);
			expect(nodeResult?.coveredCodeTokens).toBe(100); // 50 + 50 (binary excluded)
		});

		test("identifies nodes exceeding budget after skipping binary/large files", () => {
			// Create a scenario where budget is exceeded
			const coveredFilesMap = new Map([
				[
					"AGENTS.md",
					{
						coveredFiles: ["src/small.ts", "src/binary.bin"],
					},
				],
			]);

			const nodeContents = new Map([
				["AGENTS.md", "a".repeat(24)], // 6 tokens
			]);

			const fileContents = new Map([
				["src/small.ts", "a".repeat(400)], // 100 tokens
				["src/binary.bin", `data\0data${"x".repeat(10000)}`], // Binary (would be huge if counted)
			]);

			// Without skip options, binary would be counted and budget would be low
			// With skip options, only small.ts is counted, budget = 6/100 = 6%
			const result = calculateHierarchyTokenBudget(
				coveredFilesMap,
				nodeContents,
				fileContents,
				5,
				{ skipBinaryFiles: true },
			);

			expect(result.exceedingCount).toBe(1);
			expect(result.nodesExceedingBudget).toHaveLength(1);
			expect(result.nodesExceedingBudget[0]?.nodePath).toBe("AGENTS.md");
			expect(result.nodesExceedingBudget[0]?.budgetPercent).toBe(6);
		});

		test("nodes under budget when binary files are skipped", () => {
			const coveredFilesMap = new Map([
				[
					"AGENTS.md",
					{
						coveredFiles: ["src/code.ts", "assets/huge-binary.bin"],
					},
				],
			]);

			const nodeContents = new Map([
				["AGENTS.md", "a".repeat(8)], // 2 tokens
			]);

			const fileContents = new Map([
				["src/code.ts", "a".repeat(400)], // 100 tokens
				// If binary was counted, budget would be (2 / (100 + huge)) which is tiny
				// Since binary is skipped, budget = 2/100 = 2%
				["assets/huge-binary.bin", `\0${"x".repeat(100000)}`],
			]);

			const result = calculateHierarchyTokenBudget(
				coveredFilesMap,
				nodeContents,
				fileContents,
				5,
				{ skipBinaryFiles: true },
			);

			expect(result.exceedingCount).toBe(0);
			expect(result.nodesExceedingBudget).toHaveLength(0);

			const nodeResult = result.nodeResults.get("AGENTS.md");
			expect(nodeResult?.budgetPercent).toBe(2);
			expect(nodeResult?.exceedsBudget).toBe(false);
		});
	});

	describe("full flow: hierarchy coverage to token budget with skipping", () => {
		test("complete flow with mixed file types", () => {
			// 1. Create intent files and build hierarchy
			const nodeContent =
				"# Project Documentation\n\n## Build Commands\n\n- `npm build`\n- `npm test`";
			const intentFiles = [createIntentFile("AGENTS.md")];
			const hierarchy = buildHierarchy(intentFiles, "agents");

			// 2. Define all files in the repository
			const allFiles = [
				"AGENTS.md",
				"src/index.ts",
				"src/utils.ts",
				"src/api/handler.ts",
				"assets/logo.png",
				"assets/icon.svg",
				"generated/huge-schema.ts",
			];

			// 3. Calculate covered files for the node
			const rootNode = hierarchy.roots[0];
			expect(rootNode).toBeDefined();

			const coveredResult = getCoveredFilesForNode(
				rootNode!,
				allFiles,
				hierarchy,
			);

			// All files except AGENTS.md should be covered
			expect(coveredResult.coveredFiles).toContain("src/index.ts");
			expect(coveredResult.coveredFiles).toContain("assets/logo.png");

			// 4. Create file contents (some binary, some large)
			const fileContents = new Map([
				["src/index.ts", "export function main() { return 'hello'; }"],
				["src/utils.ts", "export const util = () => true;"],
				["src/api/handler.ts", "export async function handle() {}"],
				["assets/logo.png", "PNG\0\0\0binary-image-data"],
				["assets/icon.svg", "<svg></svg>"],
				["generated/huge-schema.ts", "// Schema\n".repeat(10000)], // 10k lines
			]);

			// 5. Calculate token budget with skip options
			const options: TokenCountOptions = {
				skipBinaryFiles: true,
				fileMaxLines: 8000,
			};

			const nodeTokens = countTokens(nodeContent);

			const coveredCodeResult = calculateCoveredCodeTokens(
				coveredResult.coveredFiles,
				fileContents,
				options,
			);

			// 6. Verify skipping behavior
			// Binary file (logo.png) should be skipped
			const logoDetail = coveredCodeResult.fileDetails.find(
				(f) => f.path === "assets/logo.png",
			);
			expect(logoDetail?.skipped).toBe(true);
			expect(logoDetail?.skipReason).toBe("binary");

			// Large file (huge-schema.ts) should be skipped
			const schemaDetail = coveredCodeResult.fileDetails.find(
				(f) => f.path === "generated/huge-schema.ts",
			);
			expect(schemaDetail?.skipped).toBe(true);
			expect(schemaDetail?.skipReason).toBe("too_large");

			// Normal files should be counted
			const indexDetail = coveredCodeResult.fileDetails.find(
				(f) => f.path === "src/index.ts",
			);
			expect(indexDetail?.skipped).toBe(false);
			expect(indexDetail?.tokens).toBeGreaterThan(0);

			// SVG is not binary (no null bytes)
			const svgDetail = coveredCodeResult.fileDetails.find(
				(f) => f.path === "assets/icon.svg",
			);
			expect(svgDetail?.skipped).toBe(false);

			// 7. Calculate final budget
			const budgetPercent =
				coveredCodeResult.totalTokens > 0
					? (nodeTokens / coveredCodeResult.totalTokens) * 100
					: 0;

			// Budget should be reasonable since binary/large files are excluded
			expect(coveredCodeResult.filesSkipped).toBe(2); // logo.png and huge-schema.ts
			expect(coveredCodeResult.filesCounted).toBe(4); // index.ts, utils.ts, handler.ts, icon.svg
			expect(budgetPercent).toBeGreaterThan(0);
		});

		test("budget enforcement respects configuration", () => {
			// Test with different threshold values
			const nodeContent = "a".repeat(40); // 10 tokens
			const coveredFiles = ["src/code.ts"];
			const fileContents = new Map([
				["src/code.ts", "a".repeat(400)], // 100 tokens
			]);

			// Budget = 10/100 = 10%

			// With 5% threshold, should exceed
			const result5 = calculateNodeTokenBudget(
				"AGENTS.md",
				nodeContent,
				coveredFiles,
				fileContents,
				5,
			);
			expect(result5.exceedsBudget).toBe(true);

			// With 10% threshold, should be exactly at threshold (not exceeding)
			const result10 = calculateNodeTokenBudget(
				"AGENTS.md",
				nodeContent,
				coveredFiles,
				fileContents,
				10,
			);
			expect(result10.exceedsBudget).toBe(false);

			// With 15% threshold, should be under
			const result15 = calculateNodeTokenBudget(
				"AGENTS.md",
				nodeContent,
				coveredFiles,
				fileContents,
				15,
			);
			expect(result15.exceedsBudget).toBe(false);
		});
	});

	describe("edge cases", () => {
		test("handles empty covered files list", () => {
			const result = calculateCoveredCodeTokens([], new Map(), {
				skipBinaryFiles: true,
			});

			expect(result.totalTokens).toBe(0);
			expect(result.filesCounted).toBe(0);
			expect(result.filesSkipped).toBe(0);
		});

		test("handles all files being skipped", () => {
			const fileContents = new Map([
				["binary1.bin", "\0binary1"],
				["binary2.bin", "\0binary2"],
			]);

			const result = calculateCoveredCodeTokens(
				["binary1.bin", "binary2.bin"],
				fileContents,
				{ skipBinaryFiles: true },
			);

			expect(result.totalTokens).toBe(0);
			expect(result.filesCounted).toBe(0);
			expect(result.filesSkipped).toBe(2);
		});

		test("handles files not in content map gracefully", () => {
			const fileContents = new Map([["existing.ts", "const x = 1;"]]);

			const result = calculateCoveredCodeTokens(
				["existing.ts", "missing.ts"],
				fileContents,
				{},
			);

			// missing.ts should be silently ignored
			expect(result.filesCounted).toBe(1);
			expect(result.filesSkipped).toBe(0);
			expect(result.fileDetails).toHaveLength(1);
		});

		test("binary check takes precedence over size check", () => {
			// Content that is both binary AND large
			const content = `\0${"a\n".repeat(20000)}`;

			const result = countTokensWithOptions(content, {
				skipBinaryFiles: true,
				fileMaxLines: 100,
			});

			// Should be marked as binary, not too_large
			expect(result.skipped).toBe(true);
			expect(result.skipReason).toBe("binary");
		});

		test("zero covered code tokens results in zero budget percent", () => {
			const result = calculateNodeTokenBudget(
				"AGENTS.md",
				"Some documentation content",
				[],
				new Map(),
				5,
			);

			expect(result.coveredCodeTokens).toBe(0);
			expect(result.budgetPercent).toBe(0);
			expect(result.exceedsBudget).toBe(false);
		});
	});
});
