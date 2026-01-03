/**
 * Integration test: symlink handling (both directions)
 *
 * Tests the scenarios where AGENTS.md and CLAUDE.md are symlinked to each other.
 * This includes:
 * - AGENTS.md as source, CLAUDE.md as symlink (symlink_source: agents)
 * - CLAUDE.md as source, AGENTS.md as symlink (symlink_source: claude)
 *
 * Per PLAN.md section "4. Symlink Strategy":
 * - symlinks are real filesystem symlinks committed to git
 * - symlink_source determines which file is source of truth
 * - Git mode 120000 indicates a symbolic link
 */

import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRDiff } from "../../src/github/context";
import {
	getNodesNeedingUpdate,
	mapChangedFilesToNodes,
} from "../../src/intent/analyzer";
import {
	detectSymlinkRelationships,
	hasIntentLayer,
	type IntentFile,
	type IntentLayerDetectionResult,
	validateSymlinkConfig,
} from "../../src/intent/detector";
import { buildHierarchy, findCoveringNode } from "../../src/intent/hierarchy";
import {
	createMockBlobResponse,
	type LoadedFixture,
	loadFixture,
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
 * Create IntentFile array from fixture, handling symlinks correctly.
 * This simulates what detectIntentLayer would return.
 */
function createIntentFilesFromFixture(
	fixture: LoadedFixture,
	fileType: "agents" | "claude",
): IntentFile[] {
	const filename = fileType === "agents" ? "AGENTS.md" : "CLAUDE.md";
	const files: IntentFile[] = [];

	for (const entry of fixture.tree.tree) {
		if (
			entry.path === filename ||
			(entry.path?.endsWith(`/${filename}`) ?? false)
		) {
			const isSymlink = entry.mode === "120000";
			let symlinkTarget: string | undefined;

			if (isSymlink && fixture.tree.symlinkTargets) {
				symlinkTarget = fixture.tree.symlinkTargets[entry.sha];
			}

			files.push({
				path: entry.path,
				type: fileType,
				sha: entry.sha,
				isSymlink,
				symlinkTarget,
			});
		}
	}

	return files;
}

/**
 * Create full detection result from fixture.
 */
function createDetectionResultFromFixture(
	fixture: LoadedFixture,
): IntentLayerDetectionResult {
	return {
		agentsFiles: createIntentFilesFromFixture(fixture, "agents"),
		claudeFiles: createIntentFilesFromFixture(fixture, "claude"),
	};
}

describe("Integration: symlink handling - AGENTS.md as source", () => {
	let fixture: LoadedFixture;

	// Load the symlink-agents-source fixture
	fixture = loadFixture("symlink-agents-source");

	test("fixture is configured correctly for AGENTS.md as source", () => {
		expect(fixture.config.description).toContain("AGENTS.md as symlink source");
		expect(fixture.config.expectedBehavior?.symlinkSource).toBe("agents");
		expect(fixture.config.expectedBehavior?.shouldDetectSymlink).toBe(true);
		expect(fixture.config.expectedSymlinks).toHaveLength(1);
		expect(fixture.config.expectedSymlinks[0]!.source).toBe("AGENTS.md");
		expect(fixture.config.expectedSymlinks[0]!.target).toBe("CLAUDE.md");
	});

	test("fixture tree has CLAUDE.md as symlink (mode 120000)", () => {
		const claudeEntry = fixture.tree.tree.find((e) => e.path === "CLAUDE.md");
		expect(claudeEntry).toBeDefined();
		expect(claudeEntry!.mode).toBe("120000");

		const agentsEntry = fixture.tree.tree.find((e) => e.path === "AGENTS.md");
		expect(agentsEntry).toBeDefined();
		expect(agentsEntry!.mode).toBe("100644");
	});

	test("symlink target points to AGENTS.md", () => {
		const claudeEntry = fixture.tree.tree.find((e) => e.path === "CLAUDE.md");
		expect(claudeEntry).toBeDefined();
		const symlinkTarget = fixture.tree.symlinkTargets?.[claudeEntry!.sha];
		expect(symlinkTarget).toBe("AGENTS.md");
	});

	test("createMockBlobResponse returns symlink target for symlinked file", () => {
		const claudeEntry = fixture.tree.tree.find((e) => e.path === "CLAUDE.md");
		const blobResponse = createMockBlobResponse(fixture, claudeEntry!.sha);

		const decodedContent = Buffer.from(
			blobResponse.data.content,
			"base64",
		).toString("utf-8");
		expect(decodedContent).toBe("AGENTS.md");
	});

	test("detection correctly identifies AGENTS.md as regular file and CLAUDE.md as symlink", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);

		// AGENTS.md should exist and NOT be a symlink
		expect(detectionResult.agentsFiles).toHaveLength(1);
		expect(detectionResult.agentsFiles[0]!.path).toBe("AGENTS.md");
		expect(detectionResult.agentsFiles[0]!.isSymlink).toBe(false);

		// CLAUDE.md should exist and BE a symlink
		expect(detectionResult.claudeFiles).toHaveLength(1);
		expect(detectionResult.claudeFiles[0]!.path).toBe("CLAUDE.md");
		expect(detectionResult.claudeFiles[0]!.isSymlink).toBe(true);
		expect(detectionResult.claudeFiles[0]!.symlinkTarget).toBe("AGENTS.md");
	});

	test("hasIntentLayer returns true", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		expect(hasIntentLayer(detectionResult)).toBe(true);
	});

	test("detectSymlinkRelationships identifies CLAUDE.md -> AGENTS.md relationship", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const relationships = detectSymlinkRelationships(detectionResult);

		expect(relationships).toHaveLength(1);
		expect(relationships[0]!.directory).toBe("");
		expect(relationships[0]!.sourceType).toBe("agents");
		expect(relationships[0]!.source.path).toBe("AGENTS.md");
		expect(relationships[0]!.symlink.path).toBe("CLAUDE.md");
	});

	test("validateSymlinkConfig passes with symlink enabled", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const validation = validateSymlinkConfig(detectionResult, true);

		expect(validation.valid).toBe(true);
		expect(validation.error).toBeUndefined();
	});

	test("hierarchy is built using source file (AGENTS.md)", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		// When AGENTS.md is the source, build hierarchy from agents files
		const hierarchy = buildHierarchy(detectionResult.agentsFiles, "agents");

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.roots[0]!.file.path).toBe("AGENTS.md");
		expect(hierarchy.roots[0]!.file.isSymlink).toBe(false);
	});

	test("changed files map to the source file node", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const hierarchy = buildHierarchy(detectionResult.agentsFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 20, 10),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		expect(mapping.summary.coveredFiles).toBe(1);
		expect(mapping.summary.affectedNodes).toBe(1);

		const coveringNode = findCoveringNode("src/index.ts", hierarchy);
		expect(coveringNode).toBeDefined();
		expect(coveringNode!.file.path).toBe("AGENTS.md");
	});

	test("getNodesNeedingUpdate returns source node for updates", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const hierarchy = buildHierarchy(detectionResult.agentsFiles, "agents");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 50, 25),
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(true);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]!.node.file.path).toBe("AGENTS.md");
	});
});

describe("Integration: symlink handling - CLAUDE.md as source", () => {
	let fixture: LoadedFixture;

	// Load the symlink-claude-source fixture
	fixture = loadFixture("symlink-claude-source");

	test("fixture is configured correctly for CLAUDE.md as source", () => {
		expect(fixture.config.description).toContain("CLAUDE.md as symlink source");
		expect(fixture.config.expectedBehavior?.symlinkSource).toBe("claude");
		expect(fixture.config.expectedBehavior?.shouldDetectSymlink).toBe(true);
		expect(fixture.config.expectedSymlinks).toHaveLength(1);
		expect(fixture.config.expectedSymlinks[0]!.source).toBe("CLAUDE.md");
		expect(fixture.config.expectedSymlinks[0]!.target).toBe("AGENTS.md");
	});

	test("fixture tree has AGENTS.md as symlink (mode 120000)", () => {
		const agentsEntry = fixture.tree.tree.find((e) => e.path === "AGENTS.md");
		expect(agentsEntry).toBeDefined();
		expect(agentsEntry!.mode).toBe("120000");

		const claudeEntry = fixture.tree.tree.find((e) => e.path === "CLAUDE.md");
		expect(claudeEntry).toBeDefined();
		expect(claudeEntry!.mode).toBe("100644");
	});

	test("symlink target points to CLAUDE.md", () => {
		const agentsEntry = fixture.tree.tree.find((e) => e.path === "AGENTS.md");
		expect(agentsEntry).toBeDefined();
		const symlinkTarget = fixture.tree.symlinkTargets?.[agentsEntry!.sha];
		expect(symlinkTarget).toBe("CLAUDE.md");
	});

	test("createMockBlobResponse returns symlink target for symlinked file", () => {
		const agentsEntry = fixture.tree.tree.find((e) => e.path === "AGENTS.md");
		const blobResponse = createMockBlobResponse(fixture, agentsEntry!.sha);

		const decodedContent = Buffer.from(
			blobResponse.data.content,
			"base64",
		).toString("utf-8");
		expect(decodedContent).toBe("CLAUDE.md");
	});

	test("detection correctly identifies CLAUDE.md as regular file and AGENTS.md as symlink", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);

		// CLAUDE.md should exist and NOT be a symlink
		expect(detectionResult.claudeFiles).toHaveLength(1);
		expect(detectionResult.claudeFiles[0]!.path).toBe("CLAUDE.md");
		expect(detectionResult.claudeFiles[0]!.isSymlink).toBe(false);

		// AGENTS.md should exist and BE a symlink
		expect(detectionResult.agentsFiles).toHaveLength(1);
		expect(detectionResult.agentsFiles[0]!.path).toBe("AGENTS.md");
		expect(detectionResult.agentsFiles[0]!.isSymlink).toBe(true);
		expect(detectionResult.agentsFiles[0]!.symlinkTarget).toBe("CLAUDE.md");
	});

	test("hasIntentLayer returns true", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		expect(hasIntentLayer(detectionResult)).toBe(true);
	});

	test("detectSymlinkRelationships identifies AGENTS.md -> CLAUDE.md relationship", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const relationships = detectSymlinkRelationships(detectionResult);

		expect(relationships).toHaveLength(1);
		expect(relationships[0]!.directory).toBe("");
		expect(relationships[0]!.sourceType).toBe("claude");
		expect(relationships[0]!.source.path).toBe("CLAUDE.md");
		expect(relationships[0]!.symlink.path).toBe("AGENTS.md");
	});

	test("validateSymlinkConfig passes with symlink enabled", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const validation = validateSymlinkConfig(detectionResult, true);

		expect(validation.valid).toBe(true);
		expect(validation.error).toBeUndefined();
	});

	test("hierarchy is built using source file (CLAUDE.md)", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		// When CLAUDE.md is the source, build hierarchy from claude files
		const hierarchy = buildHierarchy(detectionResult.claudeFiles, "claude");

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.roots[0]!.file.path).toBe("CLAUDE.md");
		expect(hierarchy.roots[0]!.file.isSymlink).toBe(false);
	});

	test("changed files map to the source file node", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const hierarchy = buildHierarchy(detectionResult.claudeFiles, "claude");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 20, 10),
		]);

		const mapping = mapChangedFilesToNodes(diff, hierarchy);

		expect(mapping.summary.coveredFiles).toBe(1);
		expect(mapping.summary.affectedNodes).toBe(1);

		const coveringNode = findCoveringNode("src/index.ts", hierarchy);
		expect(coveringNode).toBeDefined();
		expect(coveringNode!.file.path).toBe("CLAUDE.md");
	});

	test("getNodesNeedingUpdate returns source node for updates", () => {
		const detectionResult = createDetectionResultFromFixture(fixture);
		const hierarchy = buildHierarchy(detectionResult.claudeFiles, "claude");

		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 50, 25),
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(true);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]!.node.file.path).toBe("CLAUDE.md");
	});
});

describe("Integration: symlink validation edge cases", () => {
	test("validation fails when both files exist without symlink relationship", () => {
		// Simulate a conflict: both files exist, neither is a symlink
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "agents-sha",
					isSymlink: false,
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "claude-sha",
					isSymlink: false,
				},
			],
		};

		const validation = validateSymlinkConfig(detectionResult, true);

		expect(validation.valid).toBe(false);
		expect(validation.error).toContain("Symlink configuration conflict");
		expect(validation.conflictDirectories).toContain("(root)");
	});

	test("validation passes when symlink is disabled even with both files", () => {
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "agents-sha",
					isSymlink: false,
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "claude-sha",
					isSymlink: false,
				},
			],
		};

		const validation = validateSymlinkConfig(detectionResult, false);

		expect(validation.valid).toBe(true);
	});

	test("validation handles nested directory symlink relationships", () => {
		// Root: AGENTS.md is source, CLAUDE.md is symlink
		// src/: CLAUDE.md is source, AGENTS.md is symlink
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "root-agents-sha",
					isSymlink: false,
				},
				{
					path: "src/AGENTS.md",
					type: "agents",
					sha: "src-agents-sha",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "root-claude-sha",
					isSymlink: true,
					symlinkTarget: "AGENTS.md",
				},
				{
					path: "src/CLAUDE.md",
					type: "claude",
					sha: "src-claude-sha",
					isSymlink: false,
				},
			],
		};

		const validation = validateSymlinkConfig(detectionResult, true);
		expect(validation.valid).toBe(true);

		const relationships = detectSymlinkRelationships(detectionResult);
		expect(relationships).toHaveLength(2);

		// Root: CLAUDE.md -> AGENTS.md (agents is source)
		const rootRelationship = relationships.find((r) => r.directory === "");
		expect(rootRelationship?.sourceType).toBe("agents");

		// src/: AGENTS.md -> CLAUDE.md (claude is source)
		const srcRelationship = relationships.find((r) => r.directory === "src");
		expect(srcRelationship?.sourceType).toBe("claude");
	});

	test("different symlink sources at different levels work correctly", () => {
		// Demonstrates mixed symlink directions in the same repository
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "root-agents",
					isSymlink: false,
				},
				{
					path: "packages/api/AGENTS.md",
					type: "agents",
					sha: "api-agents",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "root-claude",
					isSymlink: true,
					symlinkTarget: "AGENTS.md",
				},
				{
					path: "packages/api/CLAUDE.md",
					type: "claude",
					sha: "api-claude",
					isSymlink: false,
				},
			],
		};

		const relationships = detectSymlinkRelationships(detectionResult);

		// Root: source is AGENTS.md
		const rootRel = relationships.find((r) => r.directory === "");
		expect(rootRel?.sourceType).toBe("agents");
		expect(rootRel?.source.path).toBe("AGENTS.md");

		// packages/api: source is CLAUDE.md
		const apiRel = relationships.find((r) => r.directory === "packages/api");
		expect(apiRel?.sourceType).toBe("claude");
		expect(apiRel?.source.path).toBe("packages/api/CLAUDE.md");
	});
});

describe("Integration: full symlink workflow", () => {
	test("complete flow: detect -> validate -> build hierarchy -> map changes (agents source)", () => {
		const fixture = loadFixture("symlink-agents-source");

		// 1. Detect intent layer
		const detectionResult = createDetectionResultFromFixture(fixture);
		expect(hasIntentLayer(detectionResult)).toBe(true);

		// 2. Detect symlink relationships
		const relationships = detectSymlinkRelationships(detectionResult);
		expect(relationships).toHaveLength(1);
		expect(relationships[0]!.sourceType).toBe("agents");

		// 3. Validate symlink config
		const validation = validateSymlinkConfig(detectionResult, true);
		expect(validation.valid).toBe(true);

		// 4. Determine source file type and build hierarchy
		const sourceType = relationships[0]!.sourceType;
		const sourceFiles =
			sourceType === "agents"
				? detectionResult.agentsFiles
				: detectionResult.claudeFiles;
		const hierarchy = buildHierarchy(sourceFiles, sourceType);

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.roots[0]!.file.isSymlink).toBe(false);

		// 5. Map changed files
		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 100, 50),
			createChangedFile("package.json", "modified", 5, 2),
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(true);
		expect(result.candidates[0]!.node.file.path).toBe("AGENTS.md");
	});

	test("complete flow: detect -> validate -> build hierarchy -> map changes (claude source)", () => {
		const fixture = loadFixture("symlink-claude-source");

		// 1. Detect intent layer
		const detectionResult = createDetectionResultFromFixture(fixture);
		expect(hasIntentLayer(detectionResult)).toBe(true);

		// 2. Detect symlink relationships
		const relationships = detectSymlinkRelationships(detectionResult);
		expect(relationships).toHaveLength(1);
		expect(relationships[0]!.sourceType).toBe("claude");

		// 3. Validate symlink config
		const validation = validateSymlinkConfig(detectionResult, true);
		expect(validation.valid).toBe(true);

		// 4. Determine source file type and build hierarchy
		const sourceType = relationships[0]!.sourceType;
		const sourceFiles =
			sourceType === "agents"
				? detectionResult.agentsFiles
				: detectionResult.claudeFiles;
		const hierarchy = buildHierarchy(sourceFiles, sourceType);

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.roots[0]!.file.isSymlink).toBe(false);

		// 5. Map changed files
		const diff = createDiff([
			createChangedFile("src/index.ts", "modified", 100, 50),
			createChangedFile("package.json", "modified", 5, 2),
		]);

		const result = getNodesNeedingUpdate(diff, hierarchy);

		expect(result.hasUpdates).toBe(true);
		expect(result.candidates[0]!.node.file.path).toBe("CLAUDE.md");
	});
});
