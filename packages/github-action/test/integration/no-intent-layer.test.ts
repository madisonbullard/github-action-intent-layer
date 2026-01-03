/**
 * Integration test: no intent layer → initialization suggestion
 *
 * Tests the scenario where a repository has no existing AGENTS.md or CLAUDE.md files.
 * The action should suggest creating only the root AGENTS.md file (per PLAN.md task 12.1
 * and section "16. Initial State").
 */

import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRDiff } from "../../src/github/context";
import {
	filterSemanticBoundariesForInitialization,
	identifySemanticBoundaries,
	mapChangedFilesToNodes,
} from "../../src/intent/analyzer";
import {
	hasIntentLayer,
	type IntentLayerDetectionResult,
} from "../../src/intent/detector";
import { buildHierarchy } from "../../src/intent/hierarchy";
import {
	type LoadedFixture,
	loadFixture,
	shouldSuggestRootAgentsMd,
} from "../fixtures";

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
 * Create a diff from fixture files (simulating a PR that adds all files).
 */
function createDiffFromFixture(fixture: LoadedFixture): PRDiff {
	const files = Object.keys(fixture.files).map((path) =>
		createChangedFile(path, "added", 50, 0),
	);
	return createDiff(files);
}

describe("Integration: no intent layer → initialization suggestion", () => {
	let fixture: LoadedFixture;

	// Load the no-intent-layer fixture
	fixture = loadFixture("no-intent-layer");

	test("fixture is configured correctly for initialization", () => {
		expect(fixture.config.description).toContain("without any intent layer");
		expect(fixture.config.expectedIntentFiles).toHaveLength(0);
		expect(fixture.config.expectedBehavior?.shouldSuggestRootAgentsMd).toBe(
			true,
		);
		expect(fixture.config.expectedBehavior?.shouldSuggestHierarchy).toBe(false);
	});

	test("hasIntentLayer returns false when no intent files exist", () => {
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [],
			claudeFiles: [],
		};

		expect(hasIntentLayer(detectionResult)).toBe(false);
	});

	test("shouldSuggestRootAgentsMd helper returns true for fixture", () => {
		expect(shouldSuggestRootAgentsMd(fixture)).toBe(true);
	});

	test("empty hierarchy is built when no intent files exist", () => {
		const hierarchy = buildHierarchy([], "agents");

		expect(hierarchy.roots).toHaveLength(0);
		expect(hierarchy.nodesByPath.size).toBe(0);
		expect(hierarchy.fileType).toBe("agents");
	});

	test("all changed files are uncovered when no intent layer exists", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		// All files should be uncovered
		expect(mapping.summary.uncoveredFiles).toBe(diff.files.length);
		expect(mapping.summary.coveredFiles).toBe(0);
		expect(mapping.summary.affectedNodes).toBe(0);
	});

	test("semantic boundaries are identified for uncovered files", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		expect(boundaries.newNodesAllowed).toBe(true);
		expect(boundaries.hasCandidates).toBe(true);
		// Should identify at least one candidate (could be root or src/)
		expect(boundaries.candidates.length).toBeGreaterThan(0);
	});

	test("semantic boundaries are empty when new_nodes is false", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		const boundaries = identifySemanticBoundaries(mapping, false, "agents");

		expect(boundaries.newNodesAllowed).toBe(false);
		expect(boundaries.hasCandidates).toBe(false);
		expect(boundaries.candidates).toHaveLength(0);
	});

	test("filterSemanticBoundariesForInitialization returns only root AGENTS.md", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// Should suggest only the root AGENTS.md
		expect(filtered.hasCandidates).toBe(true);
		expect(filtered.candidates).toHaveLength(1);
		expect(filtered.candidates[0]!.directory).toBe("");
		expect(filtered.candidates[0]!.suggestedNodePath).toBe("AGENTS.md");
	});

	test("initialization suggestion includes uncovered files in root directory", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// Root candidate includes files from root directory
		// Note: identifySemanticBoundaries groups files by directory, so root candidate
		// only includes root-level files (README.md, package.json, tsconfig.json)
		expect(filtered.candidates[0]!.uncoveredFiles.length).toBeGreaterThan(0);
	});

	test("initialization suggestion has reasonable confidence", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// Root candidate from identifySemanticBoundaries has a calculated confidence
		// (not 1.0, which is only used when filterSemanticBoundariesForInitialization
		// has to create a synthetic root candidate from subdirectory candidates)
		expect(filtered.candidates[0]!.confidence).toBeGreaterThan(0);
	});

	test("initialization suggestion has meaningful reason", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// Root candidate preserves its original reason from identifySemanticBoundaries
		// which describes the uncovered files
		expect(filtered.candidates[0]!.reason).toContain("uncovered files");
	});

	test("initialization works with CLAUDE.md when fileType is claude", () => {
		const hierarchy = buildHierarchy([], "claude");
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "claude");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"claude",
		);

		expect(filtered.hasCandidates).toBe(true);
		expect(filtered.candidates).toHaveLength(1);
		expect(filtered.candidates[0]!.suggestedNodePath).toBe("CLAUDE.md");
	});

	test("full flow: detect → map → identify → filter returns root suggestion", () => {
		// Simulate the full flow that would happen in the action

		// 1. Detection: no intent files
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [],
			claudeFiles: [],
		};

		// 2. Check if intent layer exists
		const hasLayer = hasIntentLayer(detectionResult);
		expect(hasLayer).toBe(false);

		// 3. Build hierarchy (empty)
		const hierarchy = buildHierarchy([], "agents");

		// 4. Map changed files
		const diff = createDiffFromFixture(fixture);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		// 5. Identify semantic boundaries
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		// 6. Filter for initialization (since no intent layer exists)
		const initSuggestion = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// Final result: only root AGENTS.md should be suggested
		expect(initSuggestion.hasCandidates).toBe(true);
		expect(initSuggestion.candidates).toHaveLength(1);
		expect(initSuggestion.candidates[0]!.suggestedNodePath).toBe("AGENTS.md");
		expect(initSuggestion.candidates[0]!.directory).toBe("");

		// Should NOT suggest hierarchy (per fixture expectation)
		// This is enforced by the filter returning only one candidate
		expect(initSuggestion.totalCandidates).toBe(1);
	});

	test("handles edge case: empty diff with no intent layer", () => {
		const hierarchy = buildHierarchy([], "agents");
		const diff = createDiff([]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// No candidates when there are no changed files
		expect(filtered.hasCandidates).toBe(false);
		expect(filtered.candidates).toHaveLength(0);
	});

	test("handles edge case: only root-level files changed", () => {
		const hierarchy = buildHierarchy([], "agents");
		// Only root-level files (no subdirectories)
		const diff = createDiff([
			createChangedFile("README.md", "modified", 10, 5),
			createChangedFile("package.json", "modified", 5, 2),
			createChangedFile("index.ts", "added", 100, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// Should suggest root AGENTS.md for root-level files
		expect(filtered.hasCandidates).toBe(true);
		expect(filtered.candidates[0]!.suggestedNodePath).toBe("AGENTS.md");
	});

	test("handles edge case: only subdirectory files changed - aggregates to root", () => {
		const hierarchy = buildHierarchy([], "agents");
		// Only subdirectory files with enough files per directory to meet threshold
		// src/ needs 3+ files and 50+ total changes
		const diff = createDiff([
			createChangedFile("src/index.ts", "added", 100, 0),
			createChangedFile("src/utils.ts", "added", 50, 0),
			createChangedFile("src/helper.ts", "added", 50, 0),
		]);
		const mapping = mapChangedFilesToNodes(diff, hierarchy);
		const boundaries = identifySemanticBoundaries(mapping, true, "agents");

		// identifySemanticBoundaries should create a src/ candidate (no root candidate)
		expect(boundaries.hasCandidates).toBe(true);
		const hasRootCandidate = boundaries.candidates.some(
			(c) => c.directory === "",
		);
		expect(hasRootCandidate).toBe(false);

		const filtered = filterSemanticBoundariesForInitialization(
			boundaries,
			"agents",
		);

		// filterSemanticBoundariesForInitialization should create a synthetic root
		// candidate that aggregates all subdirectory files
		expect(filtered.hasCandidates).toBe(true);
		expect(filtered.candidates).toHaveLength(1);
		expect(filtered.candidates[0]!.suggestedNodePath).toBe("AGENTS.md");
		expect(filtered.candidates[0]!.directory).toBe("");
		// All files from src/ should be aggregated into root
		expect(filtered.candidates[0]!.uncoveredFiles).toHaveLength(3);
		// Synthetic root candidate should have confidence 1.0
		expect(filtered.candidates[0]!.confidence).toBe(1.0);
		// Synthetic root candidate should have "Initialize intent layer" reason
		expect(filtered.candidates[0]!.reason).toContain("Initialize intent layer");
	});
});
