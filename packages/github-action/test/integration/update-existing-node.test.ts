/**
 * Integration test: update existing node
 *
 * Tests the scenario where a repository has an existing AGENTS.md file at the root
 * and files are changed that are covered by that node. The action should determine
 * that the existing node needs an update based on the changed files.
 */

import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRDiff } from "../../src/github/context";
import {
	determineNodesNeedingUpdate,
	generateUpdateReason,
	getAffectedNodes,
	getNodesNeedingUpdate,
	mapChangedFilesToNodes,
	type NodeChangeSummary,
	reviewParentNodes,
} from "../../src/intent/analyzer";
import {
	hasIntentLayer,
	type IntentFile,
	type IntentLayerDetectionResult,
} from "../../src/intent/detector";
import { buildHierarchy, findCoveringNode } from "../../src/intent/hierarchy";
import { type LoadedFixture, loadFixture } from "../fixtures";

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
 * Helper to create a PRDiff from changed files.
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

/**
 * Create IntentFile array from fixture configuration.
 */
function createIntentFilesFromFixture(fixture: LoadedFixture): IntentFile[] {
	return fixture.config.expectedIntentFiles.map((path) => ({
		path,
		directory: path.includes("/")
			? path.substring(0, path.lastIndexOf("/"))
			: "",
		fileName: path.includes("/")
			? path.substring(path.lastIndexOf("/") + 1)
			: path,
		type: path.endsWith("AGENTS.md")
			? ("agents" as const)
			: ("claude" as const),
		content: fixture.files[path] ?? "",
		sha: `blob-${path.replace(/\//g, "-")}`,
		isSymlink: false,
		symlinkTarget: undefined,
	}));
}

describe("Integration: update existing node", () => {
	let fixture: LoadedFixture;

	// Load the basic-agents fixture
	fixture = loadFixture("basic-agents");

	test("fixture is configured correctly for updating existing node", () => {
		expect(fixture.config.description).toContain("AGENTS.md");
		expect(fixture.config.expectedIntentFiles).toContain("AGENTS.md");
		expect(fixture.config.expectedBehavior?.shouldSuggestRootAgentsMd).toBe(
			false,
		);
		expect(fixture.config.expectedBehavior?.canUpdateExistingNode).toBe(true);
	});

	test("hasIntentLayer returns true when intent files exist", () => {
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: createIntentFilesFromFixture(fixture),
			claudeFiles: [],
		};

		expect(hasIntentLayer(detectionResult)).toBe(true);
	});

	test("hierarchy is built correctly with root AGENTS.md", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.nodesByPath.size).toBe(1);
		expect(hierarchy.fileType).toBe("agents");
		expect(hierarchy.roots[0]!.file.path).toBe("AGENTS.md");
		expect(hierarchy.roots[0]!.directory).toBe("");
		expect(hierarchy.roots[0]!.depth).toBe(0);
	});

	test("changed files are mapped to the covering node", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		// Create a diff with files that exist in the fixture
		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 20, 10),
			createChangedFile("src/utils/helper.ts", "modified", 15, 5),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		// All files should be covered by the root AGENTS.md
		expect(mapping.summary.totalChangedFiles).toBe(2);
		expect(mapping.summary.coveredFiles).toBe(2);
		expect(mapping.summary.uncoveredFiles).toBe(0);
		expect(mapping.summary.affectedNodes).toBe(1);

		// Verify files are mapped to the correct node
		const nodeFiles = mapping.byNode.get("AGENTS.md");
		expect(nodeFiles).toBeDefined();
		expect(nodeFiles).toHaveLength(2);
	});

	test("findCoveringNode returns root node for all fixture files", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		// Test files at different levels
		const testPaths = [
			"src/index.ts",
			"src/utils/helper.ts",
			"src/api/handler.ts",
		];

		for (const path of testPaths) {
			const coveringNode = findCoveringNode(path, hierarchy);
			expect(coveringNode).toBeDefined();
			expect(coveringNode!.file.path).toBe("AGENTS.md");
		}
	});

	test("getAffectedNodes returns the root node when files are changed", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 20, 10),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const affectedNodes = getAffectedNodes(mapping);

		expect(affectedNodes).toHaveLength(1);
		expect(affectedNodes[0]!.file.path).toBe("AGENTS.md");
	});

	test("determineNodesNeedingUpdate identifies node for update", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 50, 25),
			createChangedFile("src/api/handler.ts", "added", 100, 0),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const result = determineNodesNeedingUpdate(mapping);

		expect(result.hasUpdates).toBe(true);
		expect(result.totalNodes).toBe(1);
		expect(result.candidates).toHaveLength(1);

		const candidate = result.candidates[0]!;
		expect(candidate.node.file.path).toBe("AGENTS.md");
		expect(candidate.changedFiles).toHaveLength(2);
		expect(candidate.changeSummary.filesModified).toBe(1);
		expect(candidate.changeSummary.filesAdded).toBe(1);
		expect(candidate.changeSummary.totalAdditions).toBe(150);
		expect(candidate.changeSummary.totalDeletions).toBe(25);
	});

	test("getNodesNeedingUpdate combines mapping and determination", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/utils/helper.ts", "modified", 30, 10),
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(true);
		expect(result.candidates[0]!.node.file.path).toBe("AGENTS.md");
	});

	test("generateUpdateReason creates meaningful descriptions", () => {
		const changeSummary: NodeChangeSummary = {
			filesAdded: 2,
			filesModified: 3,
			filesRemoved: 0,
			filesRenamed: 0,
			totalAdditions: 200,
			totalDeletions: 50,
		};

		const reason = generateUpdateReason(changeSummary, []);

		expect(reason).toContain("2 files added");
		expect(reason).toContain("3 files modified");
		expect(reason).toContain("200 lines added");
	});

	test("update reason indicates new functionality for added files only", () => {
		const changeSummary: NodeChangeSummary = {
			filesAdded: 3,
			filesModified: 0,
			filesRemoved: 0,
			filesRenamed: 0,
			totalAdditions: 150,
			totalDeletions: 0,
		};

		const reason = generateUpdateReason(changeSummary, []);

		expect(reason).toContain("new functionality introduced");
	});

	test("update reason indicates removal for deleted files only", () => {
		const changeSummary: NodeChangeSummary = {
			filesAdded: 0,
			filesModified: 0,
			filesRemoved: 2,
			filesRenamed: 0,
			totalAdditions: 0,
			totalDeletions: 100,
		};

		const reason = generateUpdateReason(changeSummary, []);

		expect(reason).toContain("functionality removed or consolidated");
	});

	test("update reason indicates significant changes for large modifications", () => {
		const changeSummary: NodeChangeSummary = {
			filesAdded: 0,
			filesModified: 5,
			filesRemoved: 0,
			filesRenamed: 0,
			totalAdditions: 300,
			totalDeletions: 200,
		};

		const reason = generateUpdateReason(changeSummary, []);

		expect(reason).toContain("significant code changes");
	});

	test("reviewParentNodes returns empty when root node has no parent", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 50, 25),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const directUpdates = determineNodesNeedingUpdate(mapping);
		const parentReview = reviewParentNodes(directUpdates);

		// Root node has no parents, so parent review should be empty
		expect(parentReview.candidates).toHaveLength(0);
		expect(parentReview.totalParentNodes).toBe(0);
		expect(parentReview.hasRecommendedUpdates).toBe(false);
	});

	test("handles renamed files in change summary", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const renamedFile = createChangedFile("src/newName.ts", "renamed", 0, 0);
		renamedFile.previousFilename = "src/oldName.ts";

		const diff = createDiff([renamedFile]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const result = determineNodesNeedingUpdate(mapping);

		expect(result.hasUpdates).toBe(true);
		expect(result.candidates[0]!.changeSummary.filesRenamed).toBe(1);
	});

	test("multiple file changes aggregate correctly in summary", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 50, 10),
			createChangedFile("src/new.ts", "added", 100, 0),
			createChangedFile("src/old.ts", "removed", 0, 75),
			createChangedFile("README.md", "modified", 10, 5),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const result = determineNodesNeedingUpdate(mapping);

		const summary = result.candidates[0]!.changeSummary;
		expect(summary.filesModified).toBe(2);
		expect(summary.filesAdded).toBe(1);
		expect(summary.filesRemoved).toBe(1);
		expect(summary.totalAdditions).toBe(160);
		expect(summary.totalDeletions).toBe(90);
	});

	test("full flow: detect → build → map → determine → review", () => {
		// 1. Detection: existing AGENTS.md file
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: createIntentFilesFromFixture(fixture),
			claudeFiles: [],
		};

		// 2. Verify intent layer exists
		expect(hasIntentLayer(detectionResult)).toBe(true);

		// 3. Build hierarchy
		const hierarchy = buildHierarchy(detectionResult.agentsFiles, "agents");
		expect(hierarchy.roots).toHaveLength(1);

		// 4. Create diff representing typical PR changes
		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 30, 10),
			createChangedFile("src/api/handler.ts", "modified", 50, 20),
			createChangedFile("src/utils/newUtil.ts", "added", 80, 0),
		]);

		// 5. Map changed files to nodes
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		expect(mapping.summary.coveredFiles).toBe(3);
		expect(mapping.summary.affectedNodes).toBe(1);

		// 6. Determine nodes needing update
		const nodesNeedingUpdate = determineNodesNeedingUpdate(mapping);
		expect(nodesNeedingUpdate.hasUpdates).toBe(true);
		expect(nodesNeedingUpdate.candidates[0]!.node.file.path).toBe("AGENTS.md");

		// 7. Review parent nodes (none for root)
		const parentReview = reviewParentNodes(nodesNeedingUpdate);
		expect(parentReview.candidates).toHaveLength(0);

		// Final verification: the system correctly identified that AGENTS.md needs
		// an update due to changes in files it covers
		const candidate = nodesNeedingUpdate.candidates[0]!;
		expect(candidate.updateReason).toBeTruthy();
		expect(candidate.changedFiles).toHaveLength(3);
	});

	test("handles edge case: no changed files", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		const diff = createDiff([]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const result = determineNodesNeedingUpdate(mapping);

		expect(result.hasUpdates).toBe(false);
		expect(result.candidates).toHaveLength(0);
	});

	test("handles edge case: changes only to AGENTS.md itself", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		// Change the AGENTS.md file itself
		const diff = createDiff([
			createChangedFile("AGENTS.md", "modified", 10, 5),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		// AGENTS.md should be covered by itself (root covers root directory)
		expect(mapping.summary.coveredFiles).toBe(1);
		expect(mapping.summary.affectedNodes).toBe(1);

		const result = determineNodesNeedingUpdate(mapping);
		// Note: In practice, changes to AGENTS.md itself might be filtered
		// differently, but at the mapping level it's still detected
		expect(result.hasUpdates).toBe(true);
	});
});
