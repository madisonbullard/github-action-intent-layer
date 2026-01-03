import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRDiff } from "../../src/github/context";
import {
	determineNodesNeedingUpdate,
	filterIgnoredFiles,
	generateUpdateReason,
	getAffectedDirectories,
	getAffectedNodes,
	getChangedFilesForNode,
	getIgnoredChangedFiles,
	getNodesNeedingUpdate,
	getUncoveredChangedFiles,
	hasAffectedNodes,
	identifySemanticBoundaries,
	mapChangedFilesToNodes,
	mapChangedFileToCoveringNode,
	type NodeChangeSummary,
	reviewParentNodes,
	UNCOVERED_KEY,
} from "../../src/intent/analyzer";
import type { IntentFile } from "../../src/intent/detector";
import { buildHierarchy } from "../../src/intent/hierarchy";
import { IntentLayerIgnore } from "../../src/patterns/ignore";

/**
 * Helper to create an IntentFile for testing.
 */
function createIntentFile(
	path: string,
	type: "agents" | "claude" = "agents",
): IntentFile {
	return {
		path,
		type,
		sha: `sha-${path.replace(/\//g, "-")}`,
		isSymlink: false,
	};
}

/**
 * Helper to create a PRChangedFile for testing.
 */
function createChangedFile(
	filename: string,
	status: PRChangedFile["status"] = "modified",
	additions = 10,
	deletions = 5,
): PRChangedFile {
	return {
		sha: `sha-${filename.replace(/\//g, "-")}`,
		filename,
		status,
		additions,
		deletions,
		changes: additions + deletions,
		blobUrl: `https://github.com/test/repo/blob/main/${filename}`,
		rawUrl: `https://github.com/test/repo/raw/main/${filename}`,
		contentsUrl: `https://api.github.com/repos/test/repo/contents/${filename}`,
		patch: null,
		previousFilename: null,
	};
}

/**
 * Helper to create a PRDiff for testing.
 */
function createDiff(files: PRChangedFile[]): PRDiff {
	return {
		files,
		summary: {
			totalFiles: files.length,
			totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
			totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
			filesAdded: files.filter((f) => f.status === "added").length,
			filesRemoved: files.filter((f) => f.status === "removed").length,
			filesModified: files.filter((f) => f.status === "modified").length,
			filesRenamed: files.filter((f) => f.status === "renamed").length,
		},
		rawDiff: null,
	};
}

describe("mapChangedFileToCoveringNode", () => {
	test("maps file to root node when only root exists", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const changedFile = createChangedFile("src/index.ts");

		const result = mapChangedFileToCoveringNode(changedFile, hierarchy);

		expect(result.file).toBe(changedFile);
		expect(result.coveringNode?.file.path).toBe("AGENTS.md");
		expect(result.isIgnored).toBe(false);
	});

	test("maps file to most specific covering node", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const changedFile = createChangedFile("src/components/Button.tsx");

		const result = mapChangedFileToCoveringNode(changedFile, hierarchy);

		expect(result.coveringNode?.file.path).toBe("src/AGENTS.md");
	});

	test("returns undefined coveringNode when file is not covered", () => {
		// No root AGENTS.md, only in packages/api/
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const changedFile = createChangedFile("src/index.ts");

		const result = mapChangedFileToCoveringNode(changedFile, hierarchy);

		expect(result.coveringNode).toBeUndefined();
	});

	test("marks file as ignored when matching .intentlayerignore", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const changedFile = createChangedFile("src/index.test.ts");
		const result = mapChangedFileToCoveringNode(changedFile, hierarchy, ignore);

		expect(result.isIgnored).toBe(true);
		// Still finds the covering node even for ignored files
		expect(result.coveringNode?.file.path).toBe("AGENTS.md");
	});

	test("handles file in exact directory of intent node", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const changedFile = createChangedFile("src/index.ts");

		const result = mapChangedFileToCoveringNode(changedFile, hierarchy);

		expect(result.coveringNode?.file.path).toBe("src/AGENTS.md");
	});
});

describe("mapChangedFilesToNodes", () => {
	test("returns empty result for empty diff", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([]);

		const result = mapChangedFilesToNodes(diff, hierarchy);

		expect(result.files).toHaveLength(0);
		expect(result.byNode.size).toBe(0);
		expect(result.summary.totalChangedFiles).toBe(0);
		expect(result.summary.affectedNodes).toBe(0);
	});

	test("maps all changed files to their covering nodes", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("package.json"),
			createChangedFile("src/index.ts"),
			createChangedFile("src/utils/helper.ts"),
		]);

		const result = mapChangedFilesToNodes(diff, hierarchy);

		expect(result.files).toHaveLength(3);
		expect(result.byNode.size).toBe(2); // AGENTS.md and src/AGENTS.md
		expect(result.byNode.get("AGENTS.md")).toHaveLength(1);
		expect(result.byNode.get("src/AGENTS.md")).toHaveLength(2);
	});

	test("groups uncovered files under UNCOVERED_KEY", () => {
		// No root AGENTS.md
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"), // Not covered
			createChangedFile("packages/api/handler.ts"), // Covered
		]);

		const result = mapChangedFilesToNodes(diff, hierarchy);

		expect(result.byNode.has(UNCOVERED_KEY)).toBe(true);
		expect(result.byNode.get(UNCOVERED_KEY)).toHaveLength(1);
		expect(result.byNode.get(UNCOVERED_KEY)![0]!.file.filename).toBe(
			"src/index.ts",
		);
		expect(result.summary.uncoveredFiles).toBe(1);
		expect(result.summary.coveredFiles).toBe(1);
	});

	test("calculates correct summary statistics", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const diff = createDiff([
			createChangedFile("README.md"),
			createChangedFile("packages/api/handler.ts"),
			createChangedFile("packages/api/handler.test.ts"), // Ignored
			createChangedFile("packages/core/index.ts"), // Covered by root
		]);

		const result = mapChangedFilesToNodes(diff, hierarchy, ignore);

		expect(result.summary.totalChangedFiles).toBe(4);
		expect(result.summary.coveredFiles).toBe(4); // All covered by some node
		expect(result.summary.uncoveredFiles).toBe(0);
		expect(result.summary.ignoredFiles).toBe(1);
		expect(result.summary.affectedNodes).toBe(2); // AGENTS.md and packages/api/AGENTS.md
	});

	test("handles empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("packages/api/handler.ts"),
		]);

		const result = mapChangedFilesToNodes(diff, hierarchy);

		expect(result.files).toHaveLength(2);
		expect(result.byNode.size).toBe(1); // Only UNCOVERED_KEY
		expect(result.byNode.has(UNCOVERED_KEY)).toBe(true);
		expect(result.summary.uncoveredFiles).toBe(2);
		expect(result.summary.coveredFiles).toBe(0);
		expect(result.summary.affectedNodes).toBe(0);
	});

	test("handles complex hierarchy with multiple levels", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("README.md"), // Root
			createChangedFile("packages/shared.ts"), // packages/
			createChangedFile("packages/api/handler.ts"), // packages/api/
			createChangedFile("packages/api/routes/users.ts"), // packages/api/
			createChangedFile("packages/core/index.ts"), // packages/
		]);

		const result = mapChangedFilesToNodes(diff, hierarchy);

		expect(result.byNode.get("AGENTS.md")).toHaveLength(1);
		expect(result.byNode.get("packages/AGENTS.md")).toHaveLength(2);
		expect(result.byNode.get("packages/api/AGENTS.md")).toHaveLength(2);
		expect(result.summary.affectedNodes).toBe(3);
	});
});

describe("getAffectedNodes", () => {
	test("returns empty array when no nodes affected", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([createChangedFile("src/index.ts")]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const nodes = getAffectedNodes(mapping);

		expect(nodes).toHaveLength(0);
	});

	test("returns unique affected nodes sorted by path", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("README.md"),
			createChangedFile("src/index.ts"),
			createChangedFile("src/utils.ts"),
			createChangedFile("packages/api/handler.ts"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const nodes = getAffectedNodes(mapping);

		expect(nodes).toHaveLength(3);
		expect(nodes.map((n) => n.file.path)).toEqual([
			"AGENTS.md",
			"packages/api/AGENTS.md",
			"src/AGENTS.md",
		]);
	});

	test("does not include duplicate nodes", () => {
		const intentFiles = [createIntentFile("src/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("src/utils.ts"),
			createChangedFile("src/components/Button.tsx"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const nodes = getAffectedNodes(mapping);

		expect(nodes).toHaveLength(1);
	});
});

describe("getChangedFilesForNode", () => {
	test("returns files for specific node", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("README.md"),
			createChangedFile("src/index.ts"),
			createChangedFile("src/utils.ts"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const srcFiles = getChangedFilesForNode("src/AGENTS.md", mapping);

		expect(srcFiles).toHaveLength(2);
		expect(srcFiles.map((f) => f.file.filename)).toEqual([
			"src/index.ts",
			"src/utils.ts",
		]);
	});

	test("returns empty array for non-existent node", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([createChangedFile("README.md")]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const files = getChangedFilesForNode("nonexistent/AGENTS.md", mapping);

		expect(files).toHaveLength(0);
	});
});

describe("getUncoveredChangedFiles", () => {
	test("returns uncovered files", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"), // Uncovered
			createChangedFile("README.md"), // Uncovered
			createChangedFile("packages/api/handler.ts"), // Covered
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const uncovered = getUncoveredChangedFiles(mapping);

		expect(uncovered).toHaveLength(2);
		expect(uncovered.map((f) => f.file.filename).sort()).toEqual([
			"README.md",
			"src/index.ts",
		]);
	});

	test("returns empty array when all files covered", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("README.md"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const uncovered = getUncoveredChangedFiles(mapping);

		expect(uncovered).toHaveLength(0);
	});
});

describe("getIgnoredChangedFiles", () => {
	test("returns ignored files", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts\n*.spec.ts");

		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("src/index.test.ts"),
			createChangedFile("src/utils.spec.ts"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
		const ignored = getIgnoredChangedFiles(mapping);

		expect(ignored).toHaveLength(2);
		expect(ignored.map((f) => f.file.filename).sort()).toEqual([
			"src/index.test.ts",
			"src/utils.spec.ts",
		]);
	});

	test("returns empty array when no files ignored", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("README.md"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const ignored = getIgnoredChangedFiles(mapping);

		expect(ignored).toHaveLength(0);
	});
});

describe("hasAffectedNodes", () => {
	test("returns true when nodes are affected", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([createChangedFile("src/index.ts")]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		expect(hasAffectedNodes(mapping)).toBe(true);
	});

	test("returns false when no nodes are affected", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// All files outside packages/api/
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("README.md"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		expect(hasAffectedNodes(mapping)).toBe(false);
	});

	test("returns false for empty diff", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		expect(hasAffectedNodes(mapping)).toBe(false);
	});
});

describe("filterIgnoredFiles", () => {
	test("removes ignored files from result", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("src/index.test.ts"),
			createChangedFile("src/utils.ts"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
		const filtered = filterIgnoredFiles(mapping);

		expect(filtered.files).toHaveLength(2);
		expect(filtered.summary.totalChangedFiles).toBe(2);
		expect(filtered.summary.ignoredFiles).toBe(0);
	});

	test("rebuilds byNode map correctly", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const diff = createDiff([
			createChangedFile("README.md"),
			createChangedFile("src/index.ts"),
			createChangedFile("src/index.test.ts"), // Ignored
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
		const filtered = filterIgnoredFiles(mapping);

		expect(filtered.byNode.get("AGENTS.md")).toHaveLength(1);
		expect(filtered.byNode.get("src/AGENTS.md")).toHaveLength(1);
	});

	test("recalculates affected nodes correctly", () => {
		const intentFiles = [createIntentFile("src/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.ts");

		// All files will be ignored
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("src/utils.ts"),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
		const filtered = filterIgnoredFiles(mapping);

		expect(filtered.summary.affectedNodes).toBe(0);
		expect(filtered.files).toHaveLength(0);
	});

	test("handles uncovered files correctly", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.md");

		const diff = createDiff([
			createChangedFile("README.md"), // Uncovered and ignored
			createChangedFile("src/index.ts"), // Uncovered
			createChangedFile("packages/api/handler.ts"), // Covered
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
		const filtered = filterIgnoredFiles(mapping);

		expect(filtered.summary.uncoveredFiles).toBe(1);
		expect(filtered.byNode.get(UNCOVERED_KEY)).toHaveLength(1);
	});
});

describe("determineNodesNeedingUpdate", () => {
	test("returns empty result for empty diff", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.candidates).toHaveLength(0);
		expect(result.totalNodes).toBe(0);
		expect(result.hasUpdates).toBe(false);
	});

	test("identifies nodes needing updates based on changed files", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("README.md"),
			createChangedFile("src/index.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.hasUpdates).toBe(true);
		expect(result.totalNodes).toBe(2);
		expect(result.candidates.map((c) => c.node.file.path).sort()).toEqual([
			"AGENTS.md",
			"src/AGENTS.md",
		]);
	});

	test("excludes ignored files from triggering updates", () => {
		const intentFiles = [createIntentFile("src/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		// All files in src/ are either ignored or test files
		const diff = createDiff([
			createChangedFile("src/index.test.ts"), // Ignored
			createChangedFile("src/utils.test.ts"), // Ignored
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);

		const result = determineNodesNeedingUpdate(mapping);

		// Node should NOT need update because all files are ignored
		expect(result.hasUpdates).toBe(false);
		expect(result.totalNodes).toBe(0);
	});

	test("includes node if at least one non-ignored file exists", () => {
		const intentFiles = [createIntentFile("src/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const diff = createDiff([
			createChangedFile("src/index.ts"), // Not ignored
			createChangedFile("src/index.test.ts"), // Ignored
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.hasUpdates).toBe(true);
		expect(result.totalNodes).toBe(1);
		expect(result.candidates[0]!.changedFiles).toHaveLength(1);
		expect(result.candidates[0]!.changedFiles[0]!.file.filename).toBe(
			"src/index.ts",
		);
	});

	test("calculates change summary correctly", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/new-file.ts", "added", 50, 0),
			createChangedFile("src/existing.ts", "modified", 20, 10),
			createChangedFile("src/old-file.ts", "removed", 0, 30),
			createChangedFile("src/renamed.ts", "renamed", 5, 5),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.candidates).toHaveLength(1);
		const summary = result.candidates[0]!.changeSummary;
		expect(summary.filesAdded).toBe(1);
		expect(summary.filesModified).toBe(1);
		expect(summary.filesRemoved).toBe(1);
		expect(summary.filesRenamed).toBe(1);
		expect(summary.totalAdditions).toBe(75); // 50 + 20 + 0 + 5
		expect(summary.totalDeletions).toBe(45); // 0 + 10 + 30 + 5
	});

	test("only includes nearest covering node, not parents", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/handler.ts"),
			createChangedFile("packages/api/routes/users.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		// Only packages/api/AGENTS.md should be identified, not parents
		expect(result.totalNodes).toBe(1);
		expect(result.candidates[0]!.node.file.path).toBe("packages/api/AGENTS.md");
	});

	test("handles multiple nodes with changes correctly", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/web/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("README.md"), // Root
			createChangedFile("packages/api/handler.ts"), // packages/api
			createChangedFile("packages/web/App.tsx"), // packages/web
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.totalNodes).toBe(3);
		expect(result.candidates.map((c) => c.node.file.path).sort()).toEqual([
			"AGENTS.md",
			"packages/api/AGENTS.md",
			"packages/web/AGENTS.md",
		]);
	});

	test("returns candidates sorted by path", () => {
		const intentFiles = [
			createIntentFile("packages/web/AGENTS.md"),
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/web/App.tsx"),
			createChangedFile("README.md"),
			createChangedFile("packages/api/handler.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.candidates.map((c) => c.node.file.path)).toEqual([
			"AGENTS.md",
			"packages/api/AGENTS.md",
			"packages/web/AGENTS.md",
		]);
	});
});

describe("generateUpdateReason", () => {
	/**
	 * Helper to create a NodeChangeSummary for testing.
	 */
	function createChangeSummary(
		options: Partial<NodeChangeSummary> = {},
	): NodeChangeSummary {
		return {
			filesAdded: options.filesAdded ?? 0,
			filesModified: options.filesModified ?? 0,
			filesRemoved: options.filesRemoved ?? 0,
			filesRenamed: options.filesRenamed ?? 0,
			totalAdditions: options.totalAdditions ?? 0,
			totalDeletions: options.totalDeletions ?? 0,
		};
	}

	/**
	 * Helper to create mock ChangedFileCoverage array for testing.
	 */
	function createMockCoverageArray(count: number) {
		return Array.from({ length: count }, (_, i) => ({
			file: createChangedFile(`file${i}.ts`),
			coveringNode: undefined,
			isIgnored: false,
		}));
	}

	test("generates reason for files added only", () => {
		const summary = createChangeSummary({ filesAdded: 3, totalAdditions: 100 });
		const files = createMockCoverageArray(3);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("3 files added");
		expect(reason).toContain("new functionality introduced");
	});

	test("generates reason for single file added", () => {
		const summary = createChangeSummary({ filesAdded: 1, totalAdditions: 50 });
		const files = createMockCoverageArray(1);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("1 file added");
		expect(reason).not.toContain("1 files added");
	});

	test("generates reason for files modified only", () => {
		const summary = createChangeSummary({
			filesModified: 2,
			totalAdditions: 30,
			totalDeletions: 20,
		});
		const files = createMockCoverageArray(2);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("2 files modified");
		expect(reason).toContain("code updates");
	});

	test("generates reason for significant modifications", () => {
		const summary = createChangeSummary({
			filesModified: 2,
			totalAdditions: 80,
			totalDeletions: 40,
		});
		const files = createMockCoverageArray(2);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("2 files modified");
		expect(reason).toContain("significant code changes");
		expect(reason).toContain("80 lines added");
		expect(reason).toContain("40 lines deleted");
	});

	test("generates reason for files removed only", () => {
		const summary = createChangeSummary({
			filesRemoved: 2,
			totalDeletions: 100,
		});
		const files = createMockCoverageArray(2);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("2 files removed");
		expect(reason).toContain("functionality removed or consolidated");
	});

	test("generates reason for files renamed", () => {
		const summary = createChangeSummary({ filesRenamed: 1 });
		const files = createMockCoverageArray(1);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("1 file renamed");
	});

	test("generates reason for mixed changes", () => {
		const summary = createChangeSummary({
			filesAdded: 2,
			filesModified: 3,
			filesRemoved: 1,
			totalAdditions: 100,
			totalDeletions: 50,
		});
		const files = createMockCoverageArray(6);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("2 files added");
		expect(reason).toContain("3 files modified");
		expect(reason).toContain("1 file removed");
		expect(reason).toContain("100 lines added");
		expect(reason).toContain("50 lines deleted");
	});

	test("includes line counts for significant changes (50+ lines)", () => {
		const summary = createChangeSummary({
			filesModified: 1,
			totalAdditions: 30,
			totalDeletions: 25,
		});
		const files = createMockCoverageArray(1);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("30 lines added");
		expect(reason).toContain("25 lines deleted");
	});

	test("excludes line counts for small changes (< 50 lines)", () => {
		const summary = createChangeSummary({
			filesModified: 1,
			totalAdditions: 20,
			totalDeletions: 10,
		});
		const files = createMockCoverageArray(1);

		const reason = generateUpdateReason(summary, files);

		expect(reason).not.toContain("lines added");
		expect(reason).not.toContain("lines deleted");
	});

	test("handles singular line counts correctly", () => {
		const summary = createChangeSummary({
			filesAdded: 1,
			totalAdditions: 49,
			totalDeletions: 1,
		});
		const files = createMockCoverageArray(1);

		const reason = generateUpdateReason(summary, files);

		// "49 lines added, 1 line deleted" (singular for 1)
		expect(reason).toContain("49 lines added");
		expect(reason).toContain("1 line deleted");
		expect(reason).not.toContain("1 lines deleted");
	});

	test("provides fallback for edge case with no categorized changes", () => {
		// This is an edge case where changeSummary counts are all 0
		// but we still have files (shouldn't happen in practice)
		const summary = createChangeSummary({});
		const files = createMockCoverageArray(2);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("2 files changed in coverage area");
	});

	test("handles single file fallback correctly", () => {
		const summary = createChangeSummary({});
		const files = createMockCoverageArray(1);

		const reason = generateUpdateReason(summary, files);

		expect(reason).toContain("1 file changed in coverage area");
		expect(reason).not.toContain("1 files changed");
	});
});

describe("determineNodesNeedingUpdate - updateReason", () => {
	test("populates updateReason for candidates", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/new-file.ts", "added", 50, 0),
			createChangedFile("src/existing.ts", "modified", 20, 10),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]!.updateReason).toBeDefined();
		expect(result.candidates[0]!.updateReason).toContain("1 file added");
		expect(result.candidates[0]!.updateReason).toContain("1 file modified");
	});

	test("updateReason reflects significant changes", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/big-change.ts", "modified", 100, 50),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = determineNodesNeedingUpdate(mapping);

		expect(result.candidates[0]!.updateReason).toContain("significant");
		expect(result.candidates[0]!.updateReason).toContain("100 lines added");
	});
});

describe("getNodesNeedingUpdate", () => {
	test("combines mapping and determination in one call", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("README.md"),
			createChangedFile("src/index.ts"),
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(true);
		expect(result.totalNodes).toBe(2);
	});

	test("applies ignore patterns correctly", () => {
		const intentFiles = [createIntentFile("src/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const diff = createDiff([
			createChangedFile("src/index.test.ts"), // Ignored
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy, ignore);

		expect(result.hasUpdates).toBe(false);
	});

	test("works with empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([createChangedFile("src/index.ts")]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(false);
		expect(result.totalNodes).toBe(0);
	});
});

describe("reviewParentNodes", () => {
	test("returns empty result when no direct updates", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		expect(result.candidates).toHaveLength(0);
		expect(result.totalParentNodes).toBe(0);
		expect(result.hasRecommendedUpdates).toBe(false);
	});

	test("returns empty result when updated nodes have no parents", () => {
		// Root-level node has no parents
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([createChangedFile("src/index.ts")]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		expect(result.candidates).toHaveLength(0);
		expect(result.totalParentNodes).toBe(0);
	});

	test("identifies parent nodes when child nodes are updated", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([createChangedFile("packages/api/handler.ts")]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		// packages/api/AGENTS.md has two parents: packages/AGENTS.md and AGENTS.md
		expect(result.totalParentNodes).toBe(2);
		expect(result.candidates.map((c) => c.node.file.path)).toContain(
			"packages/AGENTS.md",
		);
		expect(result.candidates.map((c) => c.node.file.path)).toContain(
			"AGENTS.md",
		);
	});

	test("defaults to not recommending parent updates for small changes", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([createChangedFile("src/index.ts")]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		expect(result.hasRecommendedUpdates).toBe(false);
		expect(result.candidates[0]?.recommendUpdate).toBe(false);
	});

	test("recommends parent update when multiple children are updated (3+)", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/web/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/handler.ts"),
			createChangedFile("packages/web/App.tsx"),
			createChangedFile("packages/core/index.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		// packages/AGENTS.md has 3 children updated
		const packagesParent = result.candidates.find(
			(c) => c.node.file.path === "packages/AGENTS.md",
		);
		expect(packagesParent?.recommendUpdate).toBe(true);
		expect(packagesParent?.updatedChildren).toHaveLength(3);
		expect(result.hasRecommendedUpdates).toBe(true);
	});

	test("recommends parent update for significant structural changes (5+ added/removed)", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// 5 files added in src/
		const diff = createDiff([
			createChangedFile("src/file1.ts", "added"),
			createChangedFile("src/file2.ts", "added"),
			createChangedFile("src/file3.ts", "added"),
			createChangedFile("src/file4.ts", "added"),
			createChangedFile("src/file5.ts", "added"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		const rootParent = result.candidates.find(
			(c) => c.node.file.path === "AGENTS.md",
		);
		expect(rootParent?.recommendUpdate).toBe(true);
	});

	test("recommends parent update for large number of changed files (10+)", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// 10 modified files in src/
		const changedFiles = Array.from({ length: 10 }, (_, i) =>
			createChangedFile(`src/file${i}.ts`, "modified"),
		);
		const diff = createDiff(changedFiles);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		const rootParent = result.candidates.find(
			(c) => c.node.file.path === "AGENTS.md",
		);
		expect(rootParent?.recommendUpdate).toBe(true);
	});

	test("orders candidates by depth descending (deepest first)", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/api/routes/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/routes/users.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		// Should be ordered: packages/api/AGENTS.md, packages/AGENTS.md, AGENTS.md
		expect(result.candidates.map((c) => c.node.file.path)).toEqual([
			"packages/api/AGENTS.md",
			"packages/AGENTS.md",
			"AGENTS.md",
		]);
	});

	test("aggregates statistics across children correctly", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/web/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/handler.ts", "modified", 20, 5),
			createChangedFile("packages/api/routes.ts", "added", 50, 0),
			createChangedFile("packages/web/App.tsx", "modified", 30, 10),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		const packagesParent = result.candidates.find(
			(c) => c.node.file.path === "packages/AGENTS.md",
		);
		expect(packagesParent?.totalChangedFilesInChildren).toBe(3);
		expect(packagesParent?.totalAdditionsInChildren).toBe(100); // 20 + 50 + 30
		expect(packagesParent?.totalDeletionsInChildren).toBe(15); // 5 + 0 + 10
	});

	test("handles complex hierarchy with multiple parent chains", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/handler.ts"),
			createChangedFile("src/index.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		// Root AGENTS.md is parent of both chains
		// packages/AGENTS.md is parent only of packages/api
		const rootParent = result.candidates.find(
			(c) => c.node.file.path === "AGENTS.md",
		);
		const packagesParent = result.candidates.find(
			(c) => c.node.file.path === "packages/AGENTS.md",
		);

		// Root has 2 updated children (src/AGENTS.md and packages/api/AGENTS.md)
		expect(rootParent?.updatedChildren).toHaveLength(2);
		// packages/AGENTS.md has 1 updated child
		expect(packagesParent?.updatedChildren).toHaveLength(1);
	});

	test("provides meaningful recommendation reasons", () => {
		const intentFiles = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/web/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/handler.ts"),
			createChangedFile("packages/web/App.tsx"),
			createChangedFile("packages/core/index.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);

		const result = reviewParentNodes(directUpdates);

		const packagesParent = result.candidates.find(
			(c) => c.node.file.path === "packages/AGENTS.md",
		);
		expect(packagesParent?.recommendationReason).toContain(
			"Multiple child nodes",
		);
		expect(packagesParent?.recommendationReason).toContain("3");
	});
});

describe("identifySemanticBoundaries", () => {
	test("returns empty result when new_nodes is false", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// Uncovered files in src/ - would normally be candidates
		const diff = createDiff([
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/utils.ts", "added", 100, 0),
			createChangedFile("src/helpers.ts", "added", 100, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, false, "agents");

		expect(result.hasCandidates).toBe(false);
		expect(result.newNodesAllowed).toBe(false);
		expect(result.candidates).toHaveLength(0);
	});

	test("returns empty result when all files are covered", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 50, 10),
			createChangedFile("src/utils.ts", "modified", 30, 5),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.hasCandidates).toBe(false);
		expect(result.newNodesAllowed).toBe(true);
	});

	test("identifies semantic boundary for uncovered directory with multiple files", () => {
		// No root AGENTS.md, only in packages/api/
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// Multiple uncovered files in src/
		const diff = createDiff([
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/utils.ts", "added", 50, 0),
			createChangedFile("src/helpers.ts", "added", 40, 0),
			createChangedFile("packages/api/handler.ts", "modified", 10, 5),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.hasCandidates).toBe(true);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]!.directory).toBe("src");
		expect(result.candidates[0]!.suggestedNodePath).toBe("src/AGENTS.md");
		expect(result.candidates[0]!.uncoveredFiles).toHaveLength(3);
	});

	test("respects minimum file threshold (needs 3+ files)", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// Only 2 files in src/ - not enough
		const diff = createDiff([
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/utils.ts", "added", 100, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.hasCandidates).toBe(false);
	});

	test("respects minimum changes threshold", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// 3 files but very small changes (< 50 total)
		const diff = createDiff([
			createChangedFile("src/a.ts", "modified", 5, 5),
			createChangedFile("src/b.ts", "modified", 5, 5),
			createChangedFile("src/c.ts", "modified", 5, 5),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.hasCandidates).toBe(false);
	});

	test("suggests CLAUDE.md when fileType is claude", () => {
		const intentFiles = [createIntentFile("packages/api/CLAUDE.md", "claude")];
		const hierarchy = buildHierarchy(intentFiles, "claude");
		const diff = createDiff([
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/utils.ts", "added", 50, 0),
			createChangedFile("src/helpers.ts", "added", 40, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "claude");

		expect(result.candidates[0]!.suggestedNodePath).toBe("src/CLAUDE.md");
	});

	test("excludes ignored files from candidates", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		// 3 uncovered files but 2 are ignored
		const diff = createDiff([
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/index.test.ts", "added", 50, 0), // Ignored
			createChangedFile("src/utils.test.ts", "added", 40, 0), // Ignored
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		// Only 1 non-ignored file, below threshold
		expect(result.hasCandidates).toBe(false);
	});

	test("orders candidates by confidence (highest first)", () => {
		const intentFiles: IntentFile[] = [];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// Multiple directories with uncovered files
		const diff = createDiff([
			// src/ - 3 files, standard directory name
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/utils.ts", "added", 50, 0),
			createChangedFile("src/helpers.ts", "added", 40, 0),
			// packages/api/ - 5 files, package boundary
			createChangedFile("packages/api/a.ts", "added", 50, 0),
			createChangedFile("packages/api/b.ts", "added", 50, 0),
			createChangedFile("packages/api/c.ts", "added", 50, 0),
			createChangedFile("packages/api/d.ts", "added", 50, 0),
			createChangedFile("packages/api/e.ts", "added", 50, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.hasCandidates).toBe(true);
		expect(result.candidates.length).toBeGreaterThanOrEqual(2);
		// packages/api should be first due to more files + package boundary
		expect(result.candidates[0]!.directory).toBe("packages/api");
	});

	test("boosts confidence for standard directory names", () => {
		const hierarchy = buildHierarchy([], "agents");
		// Same number of files, but "components" is a standard name
		const diff = createDiff([
			createChangedFile("components/Button.tsx", "added", 100, 0),
			createChangedFile("components/Input.tsx", "added", 50, 0),
			createChangedFile("components/Card.tsx", "added", 40, 0),
			createChangedFile("my-custom-dir/a.ts", "added", 100, 0),
			createChangedFile("my-custom-dir/b.ts", "added", 50, 0),
			createChangedFile("my-custom-dir/c.ts", "added", 40, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		const componentsCandidate = result.candidates.find(
			(c) => c.directory === "components",
		);
		const customCandidate = result.candidates.find(
			(c) => c.directory === "my-custom-dir",
		);

		expect(componentsCandidate).toBeDefined();
		expect(customCandidate).toBeDefined();
		expect(componentsCandidate!.confidence).toBeGreaterThan(
			customCandidate!.confidence,
		);
	});

	test("generates meaningful reason for candidates", () => {
		const intentFiles: IntentFile[] = [];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/handler.ts", "added", 100, 0),
			createChangedFile("packages/api/routes.ts", "added", 50, 0),
			createChangedFile("packages/api/utils.ts", "added", 40, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.candidates[0]!.reason).toContain("3 uncovered files");
		expect(result.candidates[0]!.reason).toContain("3 new file(s) added");
		expect(result.candidates[0]!.reason).toContain(
			"represents a package/module boundary",
		);
	});

	test("calculates change summary correctly for candidates", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([
			createChangedFile("src/new.ts", "added", 100, 0),
			createChangedFile("src/modified.ts", "modified", 20, 10),
			createChangedFile("src/another.ts", "modified", 30, 15),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.candidates[0]!.changeSummary.filesAdded).toBe(1);
		expect(result.candidates[0]!.changeSummary.filesModified).toBe(2);
		expect(result.candidates[0]!.changeSummary.totalAdditions).toBe(150);
		expect(result.candidates[0]!.changeSummary.totalDeletions).toBe(25);
	});

	test("handles multiple directories with candidates", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([
			// src/
			createChangedFile("src/a.ts", "added", 100, 0),
			createChangedFile("src/b.ts", "added", 50, 0),
			createChangedFile("src/c.ts", "added", 40, 0),
			// lib/
			createChangedFile("lib/a.ts", "added", 100, 0),
			createChangedFile("lib/b.ts", "added", 50, 0),
			createChangedFile("lib/c.ts", "added", 40, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.totalCandidates).toBe(2);
		expect(result.candidates.map((c) => c.directory).sort()).toEqual([
			"lib",
			"src",
		]);
	});

	test("handles empty diff", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		expect(result.hasCandidates).toBe(false);
		expect(result.candidates).toHaveLength(0);
	});

	test("handles root directory uncovered files", () => {
		const intentFiles = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		// Files at root level (no directory)
		const diff = createDiff([
			createChangedFile("index.ts", "added", 100, 0),
			createChangedFile("config.ts", "added", 50, 0),
			createChangedFile("utils.ts", "added", 40, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const result = identifySemanticBoundaries(mapping, true, "agents");

		if (result.hasCandidates) {
			// Root directory candidate
			expect(result.candidates[0]!.directory).toBe("");
			expect(result.candidates[0]!.suggestedNodePath).toBe("AGENTS.md");
		}
	});
});

describe("getAffectedDirectories", () => {
	test("returns unique directories from changed files", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("src/index.ts"),
			createChangedFile("src/utils.ts"),
			createChangedFile("packages/api/handler.ts"),
			createChangedFile("README.md"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const directories = getAffectedDirectories(mapping);

		expect(directories).toEqual(["", "packages/api", "src"]);
	});

	test("returns empty array for empty diff", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const directories = getAffectedDirectories(mapping);

		expect(directories).toEqual([]);
	});

	test("handles nested directories correctly", () => {
		const intentFiles = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(intentFiles, "agents");
		const diff = createDiff([
			createChangedFile("packages/api/routes/users.ts"),
			createChangedFile("packages/api/routes/posts.ts"),
			createChangedFile("packages/api/handlers/auth.ts"),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const directories = getAffectedDirectories(mapping);

		expect(directories).toEqual([
			"packages/api/handlers",
			"packages/api/routes",
		]);
	});
});
