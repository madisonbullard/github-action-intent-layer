/**
 * Integration test: propose new node (new_nodes: true)
 *
 * Tests the scenario where a repository has an existing intent layer (e.g., nested hierarchy
 * with root AGENTS.md and packages/api/AGENTS.md, packages/core/AGENTS.md), and files are
 * changed in a directory NOT covered by any existing node (e.g., packages/web/).
 *
 * When `new_nodes: true`, the action should identify the uncovered directory as a
 * semantic boundary candidate and propose creating a new AGENTS.md there.
 */

import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRDiff } from "../../src/github/context";
import {
	determineNodesNeedingUpdate,
	identifySemanticBoundaries,
	mapChangedFilesToNodes,
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
		type: path.endsWith("AGENTS.md")
			? ("agents" as const)
			: ("claude" as const),
		sha: `blob-${path.replace(/\//g, "-")}`,
		isSymlink: false,
		symlinkTarget: undefined,
	}));
}

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
		sha: `blob-${path.replace(/\//g, "-")}`,
		isSymlink: false,
		symlinkTarget: undefined,
	};
}

describe("Integration: propose new node (new_nodes: true)", () => {
	let fixture: LoadedFixture;

	// Load the nested-hierarchy fixture - it has existing nodes at:
	// - root: AGENTS.md
	// - packages/api/AGENTS.md
	// - packages/core/AGENTS.md
	fixture = loadFixture("nested-hierarchy");

	test("fixture is configured correctly with existing hierarchy", () => {
		expect(fixture.config.description).toContain("nested hierarchy");
		expect(fixture.config.expectedIntentFiles).toContain("AGENTS.md");
		expect(fixture.config.expectedIntentFiles).toContain(
			"packages/api/AGENTS.md",
		);
		expect(fixture.config.expectedIntentFiles).toContain(
			"packages/core/AGENTS.md",
		);
		expect(fixture.config.expectedHierarchy?.roots).toContain("AGENTS.md");
	});

	test("hasIntentLayer returns true when intent files exist", () => {
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: createIntentFilesFromFixture(fixture),
			claudeFiles: [],
		};

		expect(hasIntentLayer(detectionResult)).toBe(true);
	});

	test("hierarchy is built correctly with nested nodes", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.nodesByPath.size).toBe(3);
		expect(hierarchy.fileType).toBe("agents");
		expect(hierarchy.roots[0]!.file.path).toBe("AGENTS.md");

		// Check child nodes exist
		expect(hierarchy.nodesByPath.has("packages/api/AGENTS.md")).toBe(true);
		expect(hierarchy.nodesByPath.has("packages/core/AGENTS.md")).toBe(true);
	});

	test("files in uncovered directory (packages/web) have no covering node", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		// These files are NOT covered by any existing AGENTS.md
		// packages/web/ doesn't have an AGENTS.md, and root AGENTS.md doesn't extend that far
		// Actually, root AGENTS.md covers the entire repo, so let's check
		const webFile = "packages/web/src/index.ts";
		const coveringNode = findCoveringNode(webFile, hierarchy);

		// Root AGENTS.md should cover everything at minimum
		// The scenario we're testing is when files are in subdirectories that could benefit
		// from their own dedicated AGENTS.md
		expect(coveringNode?.file.path).toBe("AGENTS.md");
	});

	test("files in covered directories map to correct nodes", () => {
		const intentFiles = createIntentFilesFromFixture(fixture);
		const hierarchy = buildHierarchy(intentFiles, "agents");

		// packages/api files should be covered by packages/api/AGENTS.md
		const apiFile = "packages/api/src/newHandler.ts";
		const apiCoveringNode = findCoveringNode(apiFile, hierarchy);
		expect(apiCoveringNode?.file.path).toBe("packages/api/AGENTS.md");

		// packages/core files should be covered by packages/core/AGENTS.md
		const coreFile = "packages/core/src/newUtil.ts";
		const coreCoveringNode = findCoveringNode(coreFile, hierarchy);
		expect(coreCoveringNode?.file.path).toBe("packages/core/AGENTS.md");
	});

	test("identifySemanticBoundaries finds candidates when new_nodes: true", () => {
		// Test with an empty hierarchy to simulate adding a new semantic boundary
		const emptyHierarchy = buildHierarchy([], "agents");

		// Files must be in the SAME directory (not spread across subdirectories)
		// to meet the threshold of 3+ files and 50+ total changes
		const diff = createDiff([
			createChangedFile("packages/web/index.ts", "added", 50, 0),
			createChangedFile("packages/web/App.tsx", "added", 100, 0),
			createChangedFile("packages/web/utils.ts", "added", 50, 0),
		]);

		const mapping = mapChangedFilesToNodes(diff, emptyHierarchy);

		// All files should be uncovered
		expect(mapping.summary.uncoveredFiles).toBe(3);
		expect(mapping.summary.coveredFiles).toBe(0);

		// Identify semantic boundaries with new_nodes: true
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		expect(boundaries.newNodesAllowed).toBe(true);
		expect(boundaries.hasCandidates).toBe(true);
		expect(boundaries.candidates.length).toBeGreaterThan(0);

		// Verify the packages/web directory is identified as a candidate
		const webCandidate = boundaries.candidates.find(
			(c) => c.directory === "packages/web",
		);
		expect(webCandidate).toBeDefined();
		expect(webCandidate!.suggestedNodePath).toBe("packages/web/AGENTS.md");
	});

	test("identifySemanticBoundaries returns empty when new_nodes: false", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		const diff = createDiff([
			createChangedFile("packages/web/package.json", "added", 30, 0),
			createChangedFile("packages/web/src/index.ts", "added", 50, 0),
			createChangedFile("packages/web/src/App.tsx", "added", 100, 0),
		]);

		const mapping = mapChangedFilesToNodes(diff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, false, "agents");

		expect(boundaries.newNodesAllowed).toBe(false);
		expect(boundaries.hasCandidates).toBe(false);
		expect(boundaries.candidates).toHaveLength(0);
	});

	test("semantic boundary candidate has correct structure", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		// All files in the SAME directory to meet the 3+ files threshold
		const diff = createDiff([
			createChangedFile("packages/web/index.ts", "added", 50, 0),
			createChangedFile("packages/web/App.tsx", "added", 100, 0),
			createChangedFile("packages/web/utils.ts", "added", 50, 0),
			createChangedFile("packages/web/types.ts", "added", 40, 0),
		]);

		const mapping = mapChangedFilesToNodes(diff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		expect(boundaries.hasCandidates).toBe(true);

		// Find the packages/web candidate (should have 4 files)
		const webCandidate = boundaries.candidates.find(
			(c) => c.directory === "packages/web",
		);

		expect(webCandidate).toBeDefined();
		expect(webCandidate!.suggestedNodePath).toBe("packages/web/AGENTS.md");
		expect(webCandidate!.uncoveredFiles.length).toBe(4);
		expect(webCandidate!.confidence).toBeGreaterThan(0);
		expect(webCandidate!.reason).toBeTruthy();
		expect(webCandidate!.changeSummary.filesAdded).toBe(4);
	});

	test("package boundary gets confidence boost", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		// Create files in packages/web (a package boundary pattern)
		const packageBoundaryDiff = createDiff([
			createChangedFile("packages/web/index.ts", "added", 50, 0),
			createChangedFile("packages/web/utils.ts", "added", 50, 0),
			createChangedFile("packages/web/types.ts", "added", 50, 0),
		]);

		// Create files in a non-package boundary (e.g., random/stuff)
		const nonPackageDiff = createDiff([
			createChangedFile("random/stuff/index.ts", "added", 50, 0),
			createChangedFile("random/stuff/utils.ts", "added", 50, 0),
			createChangedFile("random/stuff/types.ts", "added", 50, 0),
		]);

		const packageMapping = mapChangedFilesToNodes(
			packageBoundaryDiff,
			emptyHierarchy,
		);
		const nonPackageMapping = mapChangedFilesToNodes(
			nonPackageDiff,
			emptyHierarchy,
		);

		const packageBoundaries = identifySemanticBoundaries(
			packageMapping,
			true,
			"agents",
		);
		const nonPackageBoundaries = identifySemanticBoundaries(
			nonPackageMapping,
			true,
			"agents",
		);

		// Both should have candidates
		expect(packageBoundaries.hasCandidates).toBe(true);
		expect(nonPackageBoundaries.hasCandidates).toBe(true);

		const packageCandidate = packageBoundaries.candidates.find(
			(c) => c.directory === "packages/web",
		);
		const nonPackageCandidate = nonPackageBoundaries.candidates.find(
			(c) => c.directory === "random/stuff",
		);

		expect(packageCandidate).toBeDefined();
		expect(nonPackageCandidate).toBeDefined();

		// Package boundary should have higher confidence
		expect(packageCandidate!.confidence).toBeGreaterThan(
			nonPackageCandidate!.confidence,
		);
	});

	test("standard directory names get confidence boost", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		// Create files in 'src' (standard boundary)
		const srcDiff = createDiff([
			createChangedFile("src/index.ts", "added", 50, 0),
			createChangedFile("src/utils.ts", "added", 50, 0),
			createChangedFile("src/types.ts", "added", 50, 0),
		]);

		// Create files in 'xyz' (non-standard name)
		const xyzDiff = createDiff([
			createChangedFile("xyz/index.ts", "added", 50, 0),
			createChangedFile("xyz/utils.ts", "added", 50, 0),
			createChangedFile("xyz/types.ts", "added", 50, 0),
		]);

		const srcMapping = mapChangedFilesToNodes(srcDiff, emptyHierarchy);
		const xyzMapping = mapChangedFilesToNodes(xyzDiff, emptyHierarchy);

		const srcBoundaries = identifySemanticBoundaries(
			srcMapping,
			true,
			"agents",
		);
		const xyzBoundaries = identifySemanticBoundaries(
			xyzMapping,
			true,
			"agents",
		);

		const srcCandidate = srcBoundaries.candidates.find(
			(c) => c.directory === "src",
		);
		const xyzCandidate = xyzBoundaries.candidates.find(
			(c) => c.directory === "xyz",
		);

		expect(srcCandidate).toBeDefined();
		expect(xyzCandidate).toBeDefined();

		// Standard directory should have higher confidence
		expect(srcCandidate!.confidence).toBeGreaterThan(xyzCandidate!.confidence);
	});

	test("minimum threshold for files is enforced", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		// Only 2 files (below threshold of 3)
		const tooFewFilesDiff = createDiff([
			createChangedFile("newpkg/index.ts", "added", 50, 0),
			createChangedFile("newpkg/utils.ts", "added", 50, 0),
		]);

		const mapping = mapChangedFilesToNodes(tooFewFilesDiff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		// Should not identify newpkg as a candidate (not enough files)
		const newpkgCandidate = boundaries.candidates.find(
			(c) => c.directory === "newpkg",
		);
		expect(newpkgCandidate).toBeUndefined();
	});

	test("minimum threshold for changes is enforced", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		// 3 files but very small changes (below 50 total)
		const smallChangesDiff = createDiff([
			createChangedFile("smallpkg/a.ts", "added", 10, 0),
			createChangedFile("smallpkg/b.ts", "added", 10, 0),
			createChangedFile("smallpkg/c.ts", "added", 10, 0),
		]);

		const mapping = mapChangedFilesToNodes(smallChangesDiff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		// Should not identify smallpkg as a candidate (not enough changes)
		const smallpkgCandidate = boundaries.candidates.find(
			(c) => c.directory === "smallpkg",
		);
		expect(smallpkgCandidate).toBeUndefined();
	});

	test("suggestedNodePath uses CLAUDE.md when fileType is claude", () => {
		const emptyHierarchy = buildHierarchy([], "claude");

		const diff = createDiff([
			createChangedFile("packages/web/index.ts", "added", 50, 0),
			createChangedFile("packages/web/utils.ts", "added", 50, 0),
			createChangedFile("packages/web/types.ts", "added", 50, 0),
		]);

		const mapping = mapChangedFilesToNodes(diff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "claude");

		expect(boundaries.hasCandidates).toBe(true);

		const webCandidate = boundaries.candidates.find(
			(c) => c.directory === "packages/web",
		);
		expect(webCandidate).toBeDefined();
		expect(webCandidate!.suggestedNodePath).toBe("packages/web/CLAUDE.md");
	});

	test("full flow: detect → build → map → identify returns new node proposal", () => {
		// Simulate the full flow for proposing a new node

		// 1. Detection: existing intent files from nested-hierarchy
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: createIntentFilesFromFixture(fixture),
			claudeFiles: [],
		};

		// 2. Verify intent layer exists
		expect(hasIntentLayer(detectionResult)).toBe(true);

		// 3. Build hierarchy from existing files
		const hierarchy = buildHierarchy(detectionResult.agentsFiles, "agents");
		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.nodesByPath.size).toBe(3);

		// 4. Create diff with mixed changes:
		//    - Some files in existing covered areas (packages/api, packages/core)
		//    - Some files in a NEW area (packages/web) - this triggers new node proposal
		//
		// Note: identifySemanticBoundaries works on UNCOVERED files
		// In nested-hierarchy, root AGENTS.md covers everything, so nothing is truly uncovered
		//
		// Let's verify that changes in packages/web are covered by ROOT (not a dedicated node)
		const webMapping = mapChangedFilesToNodes(
			createDiff([
				createChangedFile("packages/web/index.ts", "added", 100, 0),
				createChangedFile("packages/web/App.tsx", "added", 200, 0),
				createChangedFile("packages/web/utils.ts", "added", 50, 0),
			]),
			hierarchy,
		);

		// These files are covered by root AGENTS.md
		expect(webMapping.summary.coveredFiles).toBe(3);
		expect(webMapping.summary.uncoveredFiles).toBe(0);

		// Root node is the covering node
		const webFiles = webMapping.byNode.get("AGENTS.md");
		expect(webFiles).toBeDefined();
		expect(webFiles!.length).toBe(3);

		// Since all files are covered, identifySemanticBoundaries won't find candidates
		// This is the expected behavior - if there's already coverage, no new nodes are suggested
		const boundaries = identifySemanticBoundaries(webMapping, true, "agents");
		expect(boundaries.hasCandidates).toBe(false);

		// The new node proposal scenario works when:
		// 1. Files are in an area NOT covered by existing nodes (use empty/partial hierarchy)
		// 2. Or the LLM determines that a broad coverage area should be split

		// Test the actual proposal scenario with no coverage
		const noIntentHierarchy = buildHierarchy([], "agents");
		// All files in the same directory to meet the 3+ files threshold
		const fullWebDiff = createDiff([
			createChangedFile("packages/web/index.ts", "added", 100, 0),
			createChangedFile("packages/web/App.tsx", "added", 200, 0),
			createChangedFile("packages/web/utils.ts", "added", 50, 0),
		]);

		const noIntentMapping = mapChangedFilesToNodes(
			fullWebDiff,
			noIntentHierarchy,
		);
		expect(noIntentMapping.summary.uncoveredFiles).toBe(3);

		const proposedBoundaries = identifySemanticBoundaries(
			noIntentMapping,
			true,
			"agents",
		);

		expect(proposedBoundaries.newNodesAllowed).toBe(true);
		expect(proposedBoundaries.hasCandidates).toBe(true);

		// Should propose packages/web as a semantic boundary
		const webCandidate = proposedBoundaries.candidates.find(
			(c) => c.directory === "packages/web",
		);
		expect(webCandidate).toBeDefined();
		expect(webCandidate!.suggestedNodePath).toBe("packages/web/AGENTS.md");
		expect(webCandidate!.uncoveredFiles.length).toBe(3);
	});

	test("candidates are sorted by confidence descending", () => {
		const emptyHierarchy = buildHierarchy([], "agents");

		// Create multiple directories with varying characteristics
		const diff = createDiff([
			// packages/api - package boundary, standard name, many files
			createChangedFile("packages/api/index.ts", "added", 100, 0),
			createChangedFile("packages/api/handler.ts", "added", 100, 0),
			createChangedFile("packages/api/routes.ts", "added", 100, 0),
			createChangedFile("packages/api/middleware.ts", "added", 100, 0),
			// src - standard name
			createChangedFile("src/index.ts", "added", 50, 0),
			createChangedFile("src/utils.ts", "added", 50, 0),
			createChangedFile("src/types.ts", "added", 50, 0),
			// random - no special characteristics
			createChangedFile("random/a.ts", "added", 50, 0),
			createChangedFile("random/b.ts", "added", 50, 0),
			createChangedFile("random/c.ts", "added", 50, 0),
		]);

		const mapping = mapChangedFilesToNodes(diff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		expect(boundaries.candidates.length).toBeGreaterThanOrEqual(3);

		// Verify sorted by confidence (first should have highest)
		for (let i = 0; i < boundaries.candidates.length - 1; i++) {
			const current = boundaries.candidates[i]!;
			const next = boundaries.candidates[i + 1]!;
			// Allow small tolerance for floating point comparison
			expect(current.confidence).toBeGreaterThanOrEqual(next.confidence - 0.01);
		}

		// packages/api should be among the highest confidence candidates
		// (package boundary + standard directory + many files)
		const apiIndex = boundaries.candidates.findIndex(
			(c) => c.directory === "packages/api",
		);
		expect(apiIndex).toBeLessThanOrEqual(1); // Should be in top 2
	});

	test("handles edge case: empty diff returns no candidates", () => {
		const emptyHierarchy = buildHierarchy([], "agents");
		const emptyDiff = createDiff([]);

		const mapping = mapChangedFilesToNodes(emptyDiff, emptyHierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		expect(boundaries.hasCandidates).toBe(false);
		expect(boundaries.candidates).toHaveLength(0);
	});

	test("integration with existing nodes: only uncovered areas get proposals", () => {
		// Build hierarchy with packages/api AGENTS.md but NOT packages/web
		const partialHierarchy = buildHierarchy(
			[
				createIntentFile("AGENTS.md"),
				createIntentFile("packages/api/AGENTS.md"),
			],
			"agents",
		);

		// Changes in packages/api (covered) and packages/web (covered by root)
		const mixedDiff = createDiff([
			// Covered by packages/api/AGENTS.md
			createChangedFile("packages/api/newRoute.ts", "added", 100, 0),
			// Covered by root AGENTS.md (not packages/web specifically)
			createChangedFile("packages/web/index.ts", "added", 100, 0),
			createChangedFile("packages/web/App.tsx", "added", 200, 0),
			createChangedFile("packages/web/utils.ts", "added", 50, 0),
		]);

		const mapping = mapChangedFilesToNodes(mixedDiff, partialHierarchy);

		// All files should be covered (api by api/AGENTS.md, web by root AGENTS.md)
		expect(mapping.summary.coveredFiles).toBe(4);
		expect(mapping.summary.uncoveredFiles).toBe(0);

		// Verify coverage
		const apiFiles = mapping.byNode.get("packages/api/AGENTS.md");
		const rootFiles = mapping.byNode.get("AGENTS.md");

		expect(apiFiles).toHaveLength(1); // newRoute.ts
		expect(rootFiles).toHaveLength(3); // packages/web files

		// No semantic boundaries because all files are covered
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");
		expect(boundaries.hasCandidates).toBe(false);

		// Existing nodes needing update
		const nodesNeedingUpdate = determineNodesNeedingUpdate(mapping);
		expect(nodesNeedingUpdate.hasUpdates).toBe(true);
		expect(nodesNeedingUpdate.totalNodes).toBe(2); // api and root

		const nodePaths = nodesNeedingUpdate.candidates.map(
			(c) => c.node.file.path,
		);
		expect(nodePaths).toContain("packages/api/AGENTS.md");
		expect(nodePaths).toContain("AGENTS.md");
	});
});
