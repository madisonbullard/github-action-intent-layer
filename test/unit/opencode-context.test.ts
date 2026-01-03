/**
 * Unit tests for OpenCode context payload builder
 */

import { describe, expect, test } from "bun:test";
import type { PRChangedFile, PRMetadata } from "../../src/github/context";
import type { IntentLayerDetectionResult } from "../../src/intent/detector";
import {
	type AnalysisContextPayload,
	buildAnalysisContextPayloadFromPRContext,
	buildIntentContext,
	ContextBuildError,
	type FileContentReader,
	getNodeContentStatus,
	hasProposedUpdates,
	isInitializationScenario,
	type PRContext,
} from "../../src/opencode/context";

describe("OpenCode Context", () => {
	// Helper to create mock PR metadata
	function createMockPRMetadata(
		overrides: Partial<PRMetadata> = {},
	): PRMetadata {
		return {
			number: 123,
			title: "Test PR",
			description: "Test description",
			labels: [],
			author: {
				login: "testuser",
				id: 1,
				avatarUrl: "https://example.com/avatar.png",
				isBot: false,
			},
			state: "open",
			isDraft: false,
			merged: false,
			baseBranch: "main",
			headBranch: "feature/test",
			headSha: "abc123",
			baseSha: "def456",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-02T00:00:00Z",
			commitsCount: 3,
			changedFilesCount: 2,
			additions: 100,
			deletions: 50,
			url: "https://github.com/owner/repo/pull/123",
			...overrides,
		};
	}

	// Helper to create mock changed file
	function createMockChangedFile(
		overrides: Partial<PRChangedFile> = {},
	): PRChangedFile {
		return {
			sha: "file-sha",
			filename: "src/index.ts",
			status: "modified",
			additions: 10,
			deletions: 5,
			changes: 15,
			blobUrl: "https://github.com/blob",
			rawUrl: "https://github.com/raw",
			contentsUrl: "https://api.github.com/contents",
			patch: "@@ -1,5 +1,10 @@\n+added line",
			previousFilename: null,
			...overrides,
		};
	}

	// Helper to create mock PR context
	function createMockPRContext(overrides: Partial<PRContext> = {}): PRContext {
		return {
			metadata: createMockPRMetadata(),
			commits: [
				{
					sha: "commit-sha-1",
					message: "Initial commit",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2024-01-01T00:00:00Z",
					},
					committer: {
						name: "Test User",
						email: "test@example.com",
						date: "2024-01-01T00:00:00Z",
					},
					gitHubAuthor: null,
					gitHubCommitter: null,
					url: "https://github.com/commit/1",
					commentCount: 0,
					parentShas: [],
				},
			],
			linkedIssues: [],
			reviewComments: [],
			changedFiles: [createMockChangedFile()],
			...overrides,
		};
	}

	// Helper to create mock detection result
	function createMockDetectionResult(
		overrides: Partial<IntentLayerDetectionResult> = {},
	): IntentLayerDetectionResult {
		return {
			agentsFiles: [],
			claudeFiles: [],
			...overrides,
		};
	}

	// Helper to create a mock IntentFile
	function createMockIntentFile(
		path: string,
		type: "agents" | "claude",
		sha = "mock-sha",
	) {
		return {
			path,
			type,
			sha,
			isSymlink: false,
		};
	}

	// Mock file content reader
	const mockFileReader: FileContentReader = async (filePath: string) => {
		if (filePath === "AGENTS.md") {
			return "# Root AGENTS.md\n\nProject documentation.";
		}
		if (filePath === "src/AGENTS.md") {
			return "# Source AGENTS.md\n\nSource code documentation.";
		}
		return "";
	};

	describe("ContextBuildError", () => {
		test("creates error with message", () => {
			const error = new ContextBuildError("test message");
			expect(error.message).toBe("test message");
			expect(error.name).toBe("ContextBuildError");
			expect(error.originalCause).toBeUndefined();
		});

		test("creates error with message and cause", () => {
			const cause = new Error("underlying error");
			const error = new ContextBuildError("test message", cause);
			expect(error.message).toBe("test message");
			expect(error.originalCause).toBe(cause);
		});

		test("is instanceof Error", () => {
			const error = new ContextBuildError("test");
			expect(error instanceof Error).toBe(true);
			expect(error instanceof ContextBuildError).toBe(true);
		});
	});

	describe("buildAnalysisContextPayloadFromPRContext", () => {
		test("builds context with no existing intent layer", async () => {
			const prContext = createMockPRContext();
			const detectionResult = createMockDetectionResult();

			const context = await buildAnalysisContextPayloadFromPRContext(
				prContext,
				detectionResult,
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: true },
			);

			expect(context.prContext).toBe(prContext);
			expect(context.summary.intentLayerExists).toBe(false);
			expect(context.summary.isInitialization).toBe(true);
			expect(context.summary.totalChangedFiles).toBe(1);
		});

		test("builds context with existing agents files", async () => {
			const prContext = createMockPRContext({
				changedFiles: [
					createMockChangedFile({ filename: "src/index.ts" }),
					createMockChangedFile({ filename: "src/utils.ts" }),
				],
			});

			const detectionResult = createMockDetectionResult({
				agentsFiles: [
					createMockIntentFile("AGENTS.md", "agents"),
					createMockIntentFile("src/AGENTS.md", "agents"),
				],
			});

			const context = await buildAnalysisContextPayloadFromPRContext(
				prContext,
				detectionResult,
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: true },
			);

			expect(context.summary.intentLayerExists).toBe(true);
			expect(context.summary.isInitialization).toBe(false);
			expect(context.summary.existingAgentsNodesCount).toBe(2);
			expect(context.agentsHierarchy.nodesByPath.size).toBe(2);
		});

		test("uses claude hierarchy when fileType is claude", async () => {
			const prContext = createMockPRContext();
			const detectionResult = createMockDetectionResult({
				claudeFiles: [createMockIntentFile("CLAUDE.md", "claude")],
			});

			const context = await buildAnalysisContextPayloadFromPRContext(
				prContext,
				detectionResult,
				mockFileReader,
				{ fileType: "claude", newNodesAllowed: true },
			);

			expect(context.summary.existingClaudeNodesCount).toBe(1);
			expect(context.claudeHierarchy.nodesByPath.size).toBe(1);
		});

		test("calculates correct summary statistics", async () => {
			const prContext = createMockPRContext({
				metadata: createMockPRMetadata({
					additions: 200,
					deletions: 100,
				}),
				commits: [
					{
						sha: "1",
						message: "commit 1",
						author: {
							name: "Test",
							email: "test@test.com",
							date: "2024-01-01T00:00:00Z",
						},
						committer: {
							name: "Test",
							email: "test@test.com",
							date: "2024-01-01T00:00:00Z",
						},
						gitHubAuthor: null,
						gitHubCommitter: null,
						url: "url1",
						commentCount: 0,
						parentShas: [],
					},
					{
						sha: "2",
						message: "commit 2",
						author: {
							name: "Test",
							email: "test@test.com",
							date: "2024-01-01T00:00:00Z",
						},
						committer: {
							name: "Test",
							email: "test@test.com",
							date: "2024-01-01T00:00:00Z",
						},
						gitHubAuthor: null,
						gitHubCommitter: null,
						url: "url2",
						commentCount: 0,
						parentShas: [],
					},
				],
				linkedIssues: [
					{
						number: 1,
						owner: null,
						repo: null,
						keyword: "fixes",
						rawMatch: "Fixes #1",
					},
				],
				reviewComments: [
					{
						id: 1,
						pullRequestReviewId: null,
						body: "comment",
						diffHunk: "",
						path: "file.ts",
						position: 1,
						originalPosition: 1,
						commitId: "abc",
						originalCommitId: "abc",
						inReplyToId: null,
						author: {
							login: "user",
							id: 1,
							avatarUrl: "",
							isBot: false,
						},
						authorAssociation: "OWNER",
						url: "url",
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						startLine: null,
						originalStartLine: null,
						startSide: null,
						line: null,
						originalLine: null,
						side: null,
					},
				],
				changedFiles: [
					createMockChangedFile({ additions: 50, deletions: 25 }),
					createMockChangedFile({
						filename: "other.ts",
						additions: 150,
						deletions: 75,
					}),
				],
			});

			const context = await buildAnalysisContextPayloadFromPRContext(
				prContext,
				createMockDetectionResult(),
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: true },
			);

			expect(context.summary.totalChangedFiles).toBe(2);
			expect(context.summary.totalAdditions).toBe(200);
			expect(context.summary.totalDeletions).toBe(100);
			expect(context.summary.commitsCount).toBe(2);
			expect(context.summary.linkedIssuesCount).toBe(1);
			expect(context.summary.reviewCommentsCount).toBe(1);
		});

		test("respects newNodesAllowed configuration", async () => {
			const prContext = createMockPRContext({
				changedFiles: [
					createMockChangedFile({ filename: "new-package/file1.ts" }),
					createMockChangedFile({ filename: "new-package/file2.ts" }),
					createMockChangedFile({ filename: "new-package/file3.ts" }),
					createMockChangedFile({ filename: "new-package/file4.ts" }),
				],
			});

			// With newNodesAllowed: false
			const contextNoNew = await buildAnalysisContextPayloadFromPRContext(
				prContext,
				createMockDetectionResult(),
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: false },
			);

			expect(contextNoNew.semanticBoundaries.newNodesAllowed).toBe(false);
			expect(contextNoNew.intentContext.potentialNewNodes).toHaveLength(0);
		});
	});

	describe("buildIntentContext", () => {
		test("fetches content for nodes needing updates", async () => {
			const mockNode = {
				file: createMockIntentFile("AGENTS.md", "agents"),
				directory: "",
				parent: undefined,
				children: [],
				depth: 0,
			};

			const nodesNeedingUpdate = {
				candidates: [
					{
						node: mockNode,
						changedFiles: [],
						changeSummary: {
							filesAdded: 0,
							filesModified: 1,
							filesRemoved: 0,
							filesRenamed: 0,
							totalAdditions: 10,
							totalDeletions: 5,
						},
						updateReason: "1 file modified",
					},
				],
				totalNodes: 1,
				hasUpdates: true,
			};

			const parentNodesReview = {
				candidates: [],
				totalParentNodes: 0,
				hasRecommendedUpdates: false,
			};

			const semanticBoundaries = {
				candidates: [],
				totalCandidates: 0,
				hasCandidates: false,
				newNodesAllowed: true,
			};

			const context = await buildIntentContext(
				nodesNeedingUpdate,
				parentNodesReview,
				semanticBoundaries,
				mockFileReader,
			);

			expect(context.nodesToUpdate).toHaveLength(1);
			expect(context.nodesToUpdate[0]?.currentContent).toBe(
				"# Root AGENTS.md\n\nProject documentation.",
			);
		});

		test("returns empty string for non-existent files", async () => {
			const mockNode = {
				file: createMockIntentFile("nonexistent/AGENTS.md", "agents"),
				directory: "nonexistent",
				parent: undefined,
				children: [],
				depth: 0,
			};

			const nodesNeedingUpdate = {
				candidates: [
					{
						node: mockNode,
						changedFiles: [],
						changeSummary: {
							filesAdded: 1,
							filesModified: 0,
							filesRemoved: 0,
							filesRenamed: 0,
							totalAdditions: 50,
							totalDeletions: 0,
						},
						updateReason: "1 file added",
					},
				],
				totalNodes: 1,
				hasUpdates: true,
			};

			const errorReader: FileContentReader = async () => {
				throw new Error("File not found");
			};

			const context = await buildIntentContext(
				nodesNeedingUpdate,
				{ candidates: [], totalParentNodes: 0, hasRecommendedUpdates: false },
				{
					candidates: [],
					totalCandidates: 0,
					hasCandidates: false,
					newNodesAllowed: true,
				},
				errorReader,
			);

			expect(context.nodesToUpdate[0]?.currentContent).toBe("");
		});
	});

	describe("isInitializationScenario", () => {
		test("returns true when no intent layer exists", async () => {
			const context = await buildAnalysisContextPayloadFromPRContext(
				createMockPRContext(),
				createMockDetectionResult(),
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: true },
			);

			expect(isInitializationScenario(context)).toBe(true);
		});

		test("returns false when intent layer exists", async () => {
			const context = await buildAnalysisContextPayloadFromPRContext(
				createMockPRContext(),
				createMockDetectionResult({
					agentsFiles: [createMockIntentFile("AGENTS.md", "agents")],
				}),
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: true },
			);

			expect(isInitializationScenario(context)).toBe(false);
		});
	});

	describe("hasProposedUpdates", () => {
		test("returns false when no updates needed", async () => {
			const context = await buildAnalysisContextPayloadFromPRContext(
				createMockPRContext({
					changedFiles: [], // No changed files
				}),
				createMockDetectionResult(),
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: false },
			);

			expect(hasProposedUpdates(context)).toBe(false);
		});

		test("returns true when nodes need updates", async () => {
			const context = await buildAnalysisContextPayloadFromPRContext(
				createMockPRContext({
					changedFiles: [createMockChangedFile({ filename: "src/index.ts" })],
				}),
				createMockDetectionResult({
					agentsFiles: [createMockIntentFile("src/AGENTS.md", "agents")],
				}),
				mockFileReader,
				{ fileType: "agents", newNodesAllowed: true },
			);

			// This should return true because there's a changed file in src/
			// and there's an AGENTS.md in src/
			expect(hasProposedUpdates(context)).toBe(true);
		});
	});

	describe("getNodeContentStatus", () => {
		test("returns status for all nodes", async () => {
			const mockNode = {
				file: createMockIntentFile("AGENTS.md", "agents"),
				directory: "",
				parent: undefined,
				children: [],
				depth: 0,
			};

			// Build a minimal context manually for testing
			const context: AnalysisContextPayload = {
				prContext: createMockPRContext(),
				intentContext: {
					nodesToUpdate: [
						{
							node: mockNode,
							changedFiles: [],
							changeSummary: {
								filesAdded: 0,
								filesModified: 1,
								filesRemoved: 0,
								filesRenamed: 0,
								totalAdditions: 10,
								totalDeletions: 5,
							},
							updateReason: "test",
							currentContent: "# Content",
						},
					],
					parentNodesToReview: [],
					potentialNewNodes: [],
				},
				agentsHierarchy: {
					roots: [mockNode],
					nodesByPath: new Map([["AGENTS.md", mockNode]]),
					fileType: "agents",
				},
				claudeHierarchy: {
					roots: [],
					nodesByPath: new Map(),
					fileType: "claude",
				},
				changedFilesMapping: {
					files: [],
					byNode: new Map(),
					summary: {
						totalChangedFiles: 0,
						coveredFiles: 0,
						uncoveredFiles: 0,
						ignoredFiles: 0,
						affectedNodes: 0,
					},
				},
				nodesNeedingUpdate: {
					candidates: [],
					totalNodes: 0,
					hasUpdates: false,
				},
				parentNodesReview: {
					candidates: [],
					totalParentNodes: 0,
					hasRecommendedUpdates: false,
				},
				semanticBoundaries: {
					candidates: [],
					totalCandidates: 0,
					hasCandidates: false,
					newNodesAllowed: true,
				},
				summary: {
					totalChangedFiles: 0,
					totalAdditions: 0,
					totalDeletions: 0,
					commitsCount: 0,
					linkedIssuesCount: 0,
					reviewCommentsCount: 0,
					existingAgentsNodesCount: 1,
					existingClaudeNodesCount: 0,
					nodesNeedingUpdateCount: 1,
					parentNodesToReviewCount: 0,
					potentialNewNodesCount: 0,
					intentLayerExists: true,
					isInitialization: false,
				},
			};

			const status = getNodeContentStatus(context);

			expect(status).toHaveLength(1);
			expect(status[0]).toEqual({
				nodePath: "AGENTS.md",
				hasContent: true,
				contentLength: 9,
			});
		});

		test("handles nodes with empty content", async () => {
			const mockNode = {
				file: createMockIntentFile("empty/AGENTS.md", "agents"),
				directory: "empty",
				parent: undefined,
				children: [],
				depth: 0,
			};

			const context: AnalysisContextPayload = {
				prContext: createMockPRContext(),
				intentContext: {
					nodesToUpdate: [
						{
							node: mockNode,
							changedFiles: [],
							changeSummary: {
								filesAdded: 0,
								filesModified: 1,
								filesRemoved: 0,
								filesRenamed: 0,
								totalAdditions: 10,
								totalDeletions: 5,
							},
							updateReason: "test",
							currentContent: "",
						},
					],
					parentNodesToReview: [],
					potentialNewNodes: [],
				},
				agentsHierarchy: {
					roots: [],
					nodesByPath: new Map(),
					fileType: "agents",
				},
				claudeHierarchy: {
					roots: [],
					nodesByPath: new Map(),
					fileType: "claude",
				},
				changedFilesMapping: {
					files: [],
					byNode: new Map(),
					summary: {
						totalChangedFiles: 0,
						coveredFiles: 0,
						uncoveredFiles: 0,
						ignoredFiles: 0,
						affectedNodes: 0,
					},
				},
				nodesNeedingUpdate: {
					candidates: [],
					totalNodes: 0,
					hasUpdates: false,
				},
				parentNodesReview: {
					candidates: [],
					totalParentNodes: 0,
					hasRecommendedUpdates: false,
				},
				semanticBoundaries: {
					candidates: [],
					totalCandidates: 0,
					hasCandidates: false,
					newNodesAllowed: true,
				},
				summary: {
					totalChangedFiles: 0,
					totalAdditions: 0,
					totalDeletions: 0,
					commitsCount: 0,
					linkedIssuesCount: 0,
					reviewCommentsCount: 0,
					existingAgentsNodesCount: 0,
					existingClaudeNodesCount: 0,
					nodesNeedingUpdateCount: 1,
					parentNodesToReviewCount: 0,
					potentialNewNodesCount: 0,
					intentLayerExists: false,
					isInitialization: true,
				},
			};

			const status = getNodeContentStatus(context);

			expect(status).toHaveLength(1);
			expect(status[0]).toEqual({
				nodePath: "empty/AGENTS.md",
				hasContent: false,
				contentLength: 0,
			});
		});
	});
});
