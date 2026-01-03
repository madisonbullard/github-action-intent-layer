import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRDiff } from "../../src/github/context";
import {
	determineNodesNeedingUpdate,
	filterIgnoredFiles,
	getAffectedNodes,
	getChangedFilesForNode,
	getIgnoredChangedFiles,
	getNodesNeedingUpdate,
	getUncoveredChangedFiles,
	hasAffectedNodes,
	mapChangedFilesToNodes,
	mapChangedFileToCoveringNode,
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
