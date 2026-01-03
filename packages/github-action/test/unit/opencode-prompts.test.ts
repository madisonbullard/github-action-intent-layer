import { describe, expect, test } from "bun:test";
import type {
	LinkedIssue,
	PRChangedFile,
	PRCommit,
	PRMetadata,
} from "../../src/github/context";
import type { SemanticBoundaryCandidate } from "../../src/intent/analyzer";
import type { IntentFile } from "../../src/intent/detector";
import {
	ANALYST_ROLE,
	buildAnalysisPrompt,
	buildInitializationPrompt,
	buildNewNodePrompt,
	buildNodeSplitPrompt,
	buildSingleNodeUpdatePrompt,
	CONTENT_GUIDELINES,
	collectCustomPrompts,
	formatChangedFiles,
	formatCommits,
	formatLinkedIssues,
	formatNodeUpdateCandidate,
	formatParentNodeCandidates,
	formatPRMetadata,
	formatSemanticBoundaryCandidates,
	type IntentContext,
	type IntentNodeWithContent,
	type NodeSplitContext,
	type NodeUpdateCandidateWithContent,
	OUTPUT_SCHEMA_DESCRIPTION,
	type ParentNodeReviewCandidateWithContent,
	type PRContext,
	type PromptConfig,
} from "../../src/opencode/prompts";
import { PatternMatchedPromptResolver } from "../../src/patterns/prompts";

// ============================================================================
// Test fixtures
// ============================================================================

function createMockIntentFile(
	path: string,
	type: "agents" | "claude" = "agents",
): IntentFile {
	return {
		path,
		type,
		sha: "abc123",
		isSymlink: false,
	};
}

function createMockPRMetadata(overrides: Partial<PRMetadata> = {}): PRMetadata {
	return {
		number: 42,
		title: "Add new feature",
		description: "This PR adds a new feature",
		labels: [{ name: "enhancement", color: "84b6eb", description: null }],
		author: {
			login: "testuser",
			id: 123,
			avatarUrl: "https://example.com/avatar.png",
			isBot: false,
		},
		state: "open",
		isDraft: false,
		merged: false,
		baseBranch: "main",
		headBranch: "feature/new-feature",
		headSha: "def456",
		baseSha: "abc123",
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2024-01-02T00:00:00Z",
		commitsCount: 3,
		changedFilesCount: 5,
		additions: 100,
		deletions: 20,
		url: "https://github.com/owner/repo/pull/42",
		...overrides,
	};
}

function createMockCommit(overrides: Partial<PRCommit> = {}): PRCommit {
	return {
		sha: "commit123",
		message: "feat: add new feature",
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
		url: "https://github.com/owner/repo/commit/commit123",
		commentCount: 0,
		parentShas: ["parent123"],
		...overrides,
	};
}

function createMockChangedFile(
	overrides: Partial<PRChangedFile> = {},
): PRChangedFile {
	return {
		sha: "file123",
		filename: "src/example.ts",
		status: "modified",
		additions: 10,
		deletions: 5,
		changes: 15,
		blobUrl: "https://github.com/owner/repo/blob/abc/src/example.ts",
		rawUrl: "https://github.com/owner/repo/raw/abc/src/example.ts",
		contentsUrl:
			"https://api.github.com/repos/owner/repo/contents/src/example.ts",
		patch: "@@ -1,5 +1,10 @@\n+import { foo } from 'bar';\n",
		previousFilename: null,
		...overrides,
	};
}

function createMockLinkedIssue(
	overrides: Partial<LinkedIssue> = {},
): LinkedIssue {
	return {
		number: 123,
		owner: null,
		repo: null,
		keyword: "fixes",
		rawMatch: "Fixes #123",
		...overrides,
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("OUTPUT_SCHEMA_DESCRIPTION", () => {
	test("includes JSON structure", () => {
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain('"updates"');
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain('"nodePath"');
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain('"action"');
	});

	test("includes action types", () => {
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain('"create"');
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain('"update"');
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain('"delete"');
	});

	test("includes critical rules", () => {
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain("CRITICAL RULES");
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain("suggestedContent");
		expect(OUTPUT_SCHEMA_DESCRIPTION).toContain("currentContent");
	});
});

describe("ANALYST_ROLE", () => {
	test("describes intent layer analyst role", () => {
		expect(ANALYST_ROLE).toContain("Intent Layer Analyst");
		expect(ANALYST_ROLE).toContain("AGENTS.md");
		expect(ANALYST_ROLE).toContain("CLAUDE.md");
	});

	test("emphasizes conservative approach", () => {
		expect(ANALYST_ROLE).toContain("conservative");
	});
});

describe("CONTENT_GUIDELINES", () => {
	test("provides writing guidelines", () => {
		expect(CONTENT_GUIDELINES).toContain("concise");
		expect(CONTENT_GUIDELINES).toContain("why");
		expect(CONTENT_GUIDELINES).toContain("patterns");
	});
});

describe("formatPRMetadata", () => {
	test("formats basic PR metadata", () => {
		const metadata = createMockPRMetadata();
		const result = formatPRMetadata(metadata);

		expect(result).toContain("# Pull Request #42: Add new feature");
		expect(result).toContain("This PR adds a new feature");
		expect(result).toContain("feature/new-feature → main");
		expect(result).toContain("Files changed: 5");
		expect(result).toContain("+100 / -20");
	});

	test("formats PR without description", () => {
		const metadata = createMockPRMetadata({ description: null });
		const result = formatPRMetadata(metadata);

		expect(result).not.toContain("## Description");
	});

	test("includes labels", () => {
		const metadata = createMockPRMetadata({
			labels: [
				{ name: "bug", color: "d73a4a", description: null },
				{ name: "priority:high", color: "ff0000", description: null },
			],
		});
		const result = formatPRMetadata(metadata);

		expect(result).toContain("Labels: bug, priority:high");
	});
});

describe("formatCommits", () => {
	test("formats commit list", () => {
		const commits = [
			createMockCommit({ sha: "abc1234567", message: "feat: first commit" }),
			createMockCommit({ sha: "def2345678", message: "fix: second commit" }),
		];
		const result = formatCommits(commits);

		expect(result).toContain("## Commits");
		expect(result).toContain("abc1234: feat: first commit");
		expect(result).toContain("def2345: fix: second commit");
	});

	test("handles empty commits", () => {
		const result = formatCommits([]);
		expect(result).toBe("No commits.");
	});

	test("truncates long commit messages", () => {
		const longMessage = "a".repeat(300);
		const commits = [createMockCommit({ message: longMessage })];
		const result = formatCommits(commits);

		expect(result).toContain("...");
		expect(result.length).toBeLessThan(400);
	});
});

describe("formatLinkedIssues", () => {
	test("formats linked issues", () => {
		const issues = [
			createMockLinkedIssue({ number: 123, keyword: "fixes" }),
			createMockLinkedIssue({ number: 456, keyword: "closes" }),
		];
		const result = formatLinkedIssues(issues);

		expect(result).toContain("## Linked Issues");
		expect(result).toContain("fixes #123");
		expect(result).toContain("closes #456");
	});

	test("handles cross-repo issues", () => {
		const issues = [
			createMockLinkedIssue({
				number: 789,
				owner: "other-owner",
				repo: "other-repo",
				keyword: "resolves",
			}),
		];
		const result = formatLinkedIssues(issues);

		expect(result).toContain("resolves other-owner/other-repo#789");
	});

	test("returns empty string for no issues", () => {
		const result = formatLinkedIssues([]);
		expect(result).toBe("");
	});
});

describe("formatChangedFiles", () => {
	test("formats changed files with patches", () => {
		const files = [
			createMockChangedFile({
				filename: "src/foo.ts",
				status: "modified",
				additions: 10,
				deletions: 5,
				patch: "@@ -1,5 +1,10 @@\n+new line\n",
			}),
		];
		const result = formatChangedFiles(files);

		expect(result).toContain("## Changed Files");
		expect(result).toContain("### src/foo.ts (modified)");
		expect(result).toContain("+10 / -5");
		expect(result).toContain("```diff");
		expect(result).toContain("+new line");
	});

	test("handles renamed files", () => {
		const files = [
			createMockChangedFile({
				filename: "src/new-name.ts",
				status: "renamed",
				previousFilename: "src/old-name.ts",
			}),
		];
		const result = formatChangedFiles(files);

		expect(result).toContain("Renamed from: src/old-name.ts");
	});

	test("handles files without patches", () => {
		const files = [
			createMockChangedFile({
				filename: "binary.png",
				patch: null,
			}),
		];
		const result = formatChangedFiles(files);

		expect(result).toContain("(patch not available");
	});

	test("truncates long patches", () => {
		const longPatch = Array(150).fill("+ line").join("\n");
		const files = [createMockChangedFile({ patch: longPatch })];
		const result = formatChangedFiles(files, 50);

		expect(result).toContain("truncated");
	});
});

describe("formatNodeUpdateCandidate", () => {
	test("formats node update candidate", () => {
		const candidate: NodeUpdateCandidateWithContent = {
			node: {
				file: createMockIntentFile("packages/api/AGENTS.md"),
				directory: "packages/api",
				parent: undefined,
				children: [],
				depth: 1,
			},
			changedFiles: [
				{
					file: createMockChangedFile({ filename: "packages/api/client.ts" }),
					coveringNode: undefined,
					isIgnored: false,
				},
			],
			changeSummary: {
				filesAdded: 0,
				filesModified: 1,
				filesRemoved: 0,
				filesRenamed: 0,
				totalAdditions: 10,
				totalDeletions: 5,
			},
			updateReason: "1 file modified; code updates",
			currentContent: "# API Package\n\nThis is the API package.",
		};

		const result = formatNodeUpdateCandidate(candidate);

		expect(result).toContain("### packages/api/AGENTS.md");
		expect(result).toContain("**Update Reason:** 1 file modified");
		expect(result).toContain("**Current Content:**");
		expect(result).toContain("# API Package");
		expect(result).toContain("packages/api/client.ts");
	});

	test("truncates file list when many files", () => {
		const changedFiles = Array(15)
			.fill(null)
			.map((_, i) => ({
				file: createMockChangedFile({ filename: `src/file${i}.ts` }),
				coveringNode: undefined,
				isIgnored: false,
			}));

		const candidate: NodeUpdateCandidateWithContent = {
			node: {
				file: createMockIntentFile("AGENTS.md"),
				directory: "",
				parent: undefined,
				children: [],
				depth: 0,
			},
			changedFiles,
			changeSummary: {
				filesAdded: 0,
				filesModified: 15,
				filesRemoved: 0,
				filesRenamed: 0,
				totalAdditions: 100,
				totalDeletions: 50,
			},
			updateReason: "15 files modified",
			currentContent: "# Root",
		};

		const result = formatNodeUpdateCandidate(candidate);

		expect(result).toContain("... and 5 more files");
	});
});

describe("formatParentNodeCandidates", () => {
	test("formats parent node candidates", () => {
		const candidates: ParentNodeReviewCandidateWithContent[] = [
			{
				node: {
					file: createMockIntentFile("AGENTS.md"),
					directory: "",
					parent: undefined,
					children: [],
					depth: 0,
				},
				updatedChildren: [],
				totalChangedFilesInChildren: 5,
				totalAdditionsInChildren: 100,
				totalDeletionsInChildren: 20,
				recommendUpdate: false,
				recommendationReason: "Parent nodes typically don't need updates",
				currentContent: "# Root AGENTS.md",
			},
		];

		const result = formatParentNodeCandidates(candidates);

		expect(result).toContain("## Parent Nodes");
		expect(result).toContain("### AGENTS.md");
		expect(result).toContain("**Recommendation:** No update needed");
		expect(result).toContain("# Root AGENTS.md");
	});

	test("returns empty string when no candidates", () => {
		const result = formatParentNodeCandidates([]);
		expect(result).toBe("");
	});
});

describe("formatSemanticBoundaryCandidates", () => {
	test("formats semantic boundary candidates when allowed", () => {
		const candidates: SemanticBoundaryCandidate[] = [
			{
				directory: "packages/new-package",
				suggestedNodePath: "packages/new-package/AGENTS.md",
				uncoveredFiles: [
					{
						file: createMockChangedFile({
							filename: "packages/new-package/index.ts",
						}),
						coveringNode: undefined,
						isIgnored: false,
					},
				],
				changeSummary: {
					filesAdded: 3,
					filesModified: 0,
					filesRemoved: 0,
					filesRenamed: 0,
					totalAdditions: 100,
					totalDeletions: 0,
				},
				reason: "3 uncovered files in new-package",
				confidence: 0.75,
			},
		];

		const result = formatSemanticBoundaryCandidates(candidates, true);

		expect(result).toContain("## Potential New Intent Nodes");
		expect(result).toContain("### packages/new-package/AGENTS.md");
		expect(result).toContain("**Confidence:** 75%");
		expect(result).toContain("packages/new-package/index.ts");
	});

	test("returns empty string when new nodes not allowed", () => {
		const candidates: SemanticBoundaryCandidate[] = [
			{
				directory: "packages/new",
				suggestedNodePath: "packages/new/AGENTS.md",
				uncoveredFiles: [],
				changeSummary: {
					filesAdded: 0,
					filesModified: 0,
					filesRemoved: 0,
					filesRenamed: 0,
					totalAdditions: 0,
					totalDeletions: 0,
				},
				reason: "test",
				confidence: 0.5,
			},
		];

		const result = formatSemanticBoundaryCandidates(candidates, false);
		expect(result).toBe("");
	});

	test("returns empty string when no candidates", () => {
		const result = formatSemanticBoundaryCandidates([], true);
		expect(result).toBe("");
	});
});

describe("buildAnalysisPrompt", () => {
	test("builds complete analysis prompt", () => {
		const prContext: PRContext = {
			metadata: createMockPRMetadata(),
			commits: [createMockCommit()],
			linkedIssues: [createMockLinkedIssue()],
			reviewComments: [],
			changedFiles: [createMockChangedFile()],
		};

		const intentContext: IntentContext = {
			nodesToUpdate: [
				{
					node: {
						file: createMockIntentFile("AGENTS.md"),
						directory: "",
						parent: undefined,
						children: [],
						depth: 0,
					},
					changedFiles: [
						{
							file: createMockChangedFile(),
							coveringNode: undefined,
							isIgnored: false,
						},
					],
					changeSummary: {
						filesAdded: 0,
						filesModified: 1,
						filesRemoved: 0,
						filesRenamed: 0,
						totalAdditions: 10,
						totalDeletions: 5,
					},
					updateReason: "1 file modified",
					currentContent: "# Root",
				},
			],
			parentNodesToReview: [],
			potentialNewNodes: [],
		};

		const config: PromptConfig = {
			fileType: "agents",
			newNodesAllowed: true,
			splitLargeNodes: true,
		};

		const result = buildAnalysisPrompt(prContext, intentContext, config);

		// Contains role and schema
		expect(result).toContain("Intent Layer Analyst");
		expect(result).toContain('"updates"');

		// Contains PR context
		expect(result).toContain("Pull Request #42");
		expect(result).toContain("Commits");
		expect(result).toContain("Linked Issues");

		// Contains configuration
		expect(result).toContain("Managing: AGENTS.md files");
		expect(result).toContain("New node creation: allowed");

		// Contains intent context
		expect(result).toContain("Intent Nodes Requiring Update");

		// Contains final instructions
		expect(result).toContain("Respond with ONLY the JSON object");
	});

	test("handles both file types configuration", () => {
		const prContext: PRContext = {
			metadata: createMockPRMetadata(),
			commits: [],
			linkedIssues: [],
			reviewComments: [],
			changedFiles: [],
		};

		const intentContext: IntentContext = {
			nodesToUpdate: [],
			parentNodesToReview: [],
			potentialNewNodes: [],
		};

		const config: PromptConfig = {
			fileType: "both",
			newNodesAllowed: false,
			splitLargeNodes: false,
		};

		const result = buildAnalysisPrompt(prContext, intentContext, config);

		expect(result).toContain("Managing: AGENTS.md and CLAUDE.md files");
		expect(result).toContain("New node creation: NOT allowed");
	});
});

describe("buildSingleNodeUpdatePrompt", () => {
	test("builds single node update prompt", () => {
		const nodeWithContent: IntentNodeWithContent = {
			node: {
				file: createMockIntentFile("packages/api/AGENTS.md"),
				directory: "packages/api",
				parent: undefined,
				children: [],
				depth: 1,
			},
			currentContent: "# API Package\n\nOld content here.",
		};

		const changedFiles = [
			createMockChangedFile({ filename: "packages/api/client.ts" }),
		];

		const result = buildSingleNodeUpdatePrompt(
			nodeWithContent,
			changedFiles,
			"API endpoints changed",
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("Intent Layer Analyst");
		expect(result).toContain("Update Single Intent Node");
		expect(result).toContain("packages/api/AGENTS.md");
		expect(result).toContain("API endpoints changed");
		expect(result).toContain("# API Package");
		expect(result).toContain("packages/api/client.ts");
		expect(result).toContain("Respond with ONLY the JSON object");
	});
});

describe("buildNewNodePrompt", () => {
	test("builds new node creation prompt", () => {
		const candidate: SemanticBoundaryCandidate = {
			directory: "packages/new-service",
			suggestedNodePath: "packages/new-service/AGENTS.md",
			uncoveredFiles: [
				{
					file: createMockChangedFile({
						filename: "packages/new-service/index.ts",
					}),
					coveringNode: undefined,
					isIgnored: false,
				},
			],
			changeSummary: {
				filesAdded: 3,
				filesModified: 0,
				filesRemoved: 0,
				filesRenamed: 0,
				totalAdditions: 150,
				totalDeletions: 0,
			},
			reason: "New service package added",
			confidence: 0.8,
		};

		const result = buildNewNodePrompt(
			candidate,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("Intent Layer Analyst");
		expect(result).toContain("Create New Intent Node");
		expect(result).toContain("packages/new-service/AGENTS.md");
		expect(result).toContain("packages/new-service");
		expect(result).toContain("New service package added");
		expect(result).toContain("packages/new-service/index.ts");
	});
});

describe("buildInitializationPrompt", () => {
	test("builds initialization prompt for agents", () => {
		const changedFiles = [
			createMockChangedFile({ filename: "src/index.ts" }),
			createMockChangedFile({ filename: "src/utils.ts" }),
		];

		const result = buildInitializationPrompt(
			createMockPRMetadata(),
			changedFiles,
			"agents",
		);

		expect(result).toContain("Intent Layer Analyst");
		expect(result).toContain("Initialize Intent Layer");
		expect(result).toContain("AGENTS.md");
		expect(result).toContain("does not have an intent layer yet");
		expect(result).toContain("src/index.ts");
		expect(result).toContain("Respond with ONLY the JSON object");
	});

	test("builds initialization prompt for claude", () => {
		const result = buildInitializationPrompt(
			createMockPRMetadata(),
			[],
			"claude",
		);

		expect(result).toContain("CLAUDE.md");
	});

	test("truncates file list for large PRs", () => {
		const changedFiles = Array(50)
			.fill(null)
			.map((_, i) => createMockChangedFile({ filename: `src/file${i}.ts` }));

		const result = buildInitializationPrompt(
			createMockPRMetadata(),
			changedFiles,
			"agents",
		);

		expect(result).toContain("... and 20 more files");
	});
});

describe("buildNodeSplitPrompt", () => {
	function createMockSplitContext(
		overrides: Partial<NodeSplitContext> = {},
	): NodeSplitContext {
		return {
			nodePath: "packages/core/AGENTS.md",
			currentContent:
				"# Core Package\n\nThis package contains utilities and helpers.",
			nodeDirectory: "packages/core",
			budgetPercent: 8.5,
			budgetThreshold: 5,
			splitSuggestions: [
				{
					suggestedDirectory: "packages/core/utils",
					suggestedNodePath: "packages/core/utils/AGENTS.md",
					coveredFiles: [
						"packages/core/utils/helpers.ts",
						"packages/core/utils/validators.ts",
						"packages/core/utils/formatters.ts",
					],
					coveragePercent: 35.2,
				},
				{
					suggestedDirectory: "packages/core/services",
					suggestedNodePath: "packages/core/services/AGENTS.md",
					coveredFiles: [
						"packages/core/services/api.ts",
						"packages/core/services/auth.ts",
						"packages/core/services/cache.ts",
						"packages/core/services/queue.ts",
					],
					coveragePercent: 42.8,
				},
			],
			...overrides,
		};
	}

	test("builds split prompt with budget analysis", () => {
		const splitContext = createMockSplitContext();

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("Intent Layer Analyst");
		expect(result).toContain("Split Large Intent Node");
		expect(result).toContain("packages/core/AGENTS.md");
		expect(result).toContain("Budget Analysis");
		expect(result).toContain("Current budget: 8.5%");
		expect(result).toContain("Threshold: 5%");
		expect(result).toContain("Exceeds budget by 3.5 percentage points");
	});

	test("includes current content", () => {
		const splitContext = createMockSplitContext({
			currentContent: "# My Custom Content\n\nSpecial documentation here.",
		});

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("Current Content");
		expect(result).toContain("# My Custom Content");
		expect(result).toContain("Special documentation here");
	});

	test("includes split suggestions with coverage info", () => {
		const splitContext = createMockSplitContext();

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("Suggested Splits");
		expect(result).toContain("packages/core/utils/AGENTS.md");
		expect(result).toContain("packages/core/utils");
		expect(result).toContain("35.2% of parent's covered code");
		expect(result).toContain("packages/core/utils/helpers.ts");
		expect(result).toContain("packages/core/services/AGENTS.md");
		expect(result).toContain("42.8% of parent's covered code");
	});

	test("truncates long file lists in suggestions", () => {
		const manyFiles = Array(15)
			.fill(null)
			.map((_, i) => `packages/core/utils/file${i}.ts`);

		const splitContext = createMockSplitContext({
			splitSuggestions: [
				{
					suggestedDirectory: "packages/core/utils",
					suggestedNodePath: "packages/core/utils/AGENTS.md",
					coveredFiles: manyFiles,
					coveragePercent: 60,
				},
			],
		});

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("... and 5 more files");
	});

	test("includes instructions for split process", () => {
		const splitContext = createMockSplitContext();

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("Instructions");
		expect(result).toContain("Update the parent node");
		expect(result).toContain("Create new child nodes");
		expect(result).toContain("cross-cutting concerns");
		expect(result).toContain("Respond with ONLY the JSON object");
	});

	test("uses correct file type for claude", () => {
		const splitContext = createMockSplitContext({
			nodePath: "packages/core/CLAUDE.md",
			splitSuggestions: [
				{
					suggestedDirectory: "packages/core/utils",
					suggestedNodePath: "packages/core/utils/CLAUDE.md",
					coveredFiles: ["packages/core/utils/helpers.ts"],
					coveragePercent: 50,
				},
			],
		});

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"claude",
		);

		expect(result).toContain("CLAUDE.md");
		expect(result).toContain("packages/core/utils/CLAUDE.md");
	});

	test("includes PR context", () => {
		const splitContext = createMockSplitContext();
		const prMetadata = createMockPRMetadata({
			title: "Refactor core utilities",
			description: "Major refactoring of the core package",
		});

		const result = buildNodeSplitPrompt(splitContext, prMetadata, "agents");

		expect(result).toContain("PR Context: Refactor core utilities");
		expect(result).toContain("Major refactoring of the core package");
	});

	test("handles empty current content", () => {
		const splitContext = createMockSplitContext({
			currentContent: "",
		});

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain("(empty file)");
	});

	test("includes schema description", () => {
		const splitContext = createMockSplitContext();

		const result = buildNodeSplitPrompt(
			splitContext,
			createMockPRMetadata(),
			"agents",
		);

		expect(result).toContain('"updates"');
		expect(result).toContain('"create"');
		expect(result).toContain('"update"');
	});
});

describe("collectCustomPrompts", () => {
	test("returns empty string when no resolver provided", () => {
		const changedFiles = [createMockChangedFile({ filename: "src/index.ts" })];
		const result = collectCustomPrompts(changedFiles, undefined, "agents");
		expect(result).toBe("");
	});

	test("returns empty string when resolver has no patterns", () => {
		const changedFiles = [createMockChangedFile({ filename: "src/index.ts" })];
		const resolver = new PatternMatchedPromptResolver();
		const result = collectCustomPrompts(changedFiles, resolver, "agents");
		expect(result).toBe("");
	});

	test("returns empty string when no patterns match", () => {
		const changedFiles = [createMockChangedFile({ filename: "src/index.ts" })];
		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "test/**", prompt: "Test guidance" },
		]);
		const result = collectCustomPrompts(changedFiles, resolver, "agents");
		expect(result).toBe("");
	});

	test("returns formatted custom prompts when patterns match", () => {
		const changedFiles = [
			createMockChangedFile({ filename: "packages/api/client.ts" }),
			createMockChangedFile({ filename: "packages/api/handlers.ts" }),
		];
		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "packages/api/**", prompt: "API-specific guidance" },
		]);
		const result = collectCustomPrompts(changedFiles, resolver, "agents");

		expect(result).toContain("## Custom Guidance");
		expect(result).toContain("API-specific guidance");
		expect(result).toContain("packages/api/client.ts");
	});

	test("uses file-type specific prompts when available", () => {
		const changedFiles = [createMockChangedFile({ filename: "src/index.ts" })];
		const resolver = new PatternMatchedPromptResolver([
			{
				pattern: "**/*",
				prompt: "General guidance",
				agents_prompt: "Agents-specific guidance",
				claude_prompt: "Claude-specific guidance",
			},
		]);

		const agentsResult = collectCustomPrompts(changedFiles, resolver, "agents");
		expect(agentsResult).toContain("Agents-specific guidance");
		expect(agentsResult).not.toContain("General guidance");

		const claudeResult = collectCustomPrompts(changedFiles, resolver, "claude");
		expect(claudeResult).toContain("Claude-specific guidance");
		expect(claudeResult).not.toContain("General guidance");
	});

	test("groups files by matching prompt to avoid duplication", () => {
		const changedFiles = [
			createMockChangedFile({ filename: "src/a.ts" }),
			createMockChangedFile({ filename: "src/b.ts" }),
			createMockChangedFile({ filename: "src/c.ts" }),
			createMockChangedFile({ filename: "src/d.ts" }),
		];
		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "**/*", prompt: "Same guidance for all" },
		]);

		const result = collectCustomPrompts(changedFiles, resolver, "agents");

		// Should only appear once, not four times
		const matches = result.match(/Same guidance for all/g);
		expect(matches).toHaveLength(1);

		// Should show truncated file list with +N more
		expect(result).toContain("+1 more");
	});
});

describe("buildAnalysisPrompt with custom prompts", () => {
	test("includes custom prompts section when resolver matches files", () => {
		const prContext: PRContext = {
			metadata: createMockPRMetadata(),
			commits: [],
			linkedIssues: [],
			reviewComments: [],
			changedFiles: [
				createMockChangedFile({ filename: "packages/api/client.ts" }),
			],
		};

		const intentContext: IntentContext = {
			nodesToUpdate: [],
			parentNodesToReview: [],
			potentialNewNodes: [],
		};

		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "packages/api/**", prompt: "API package guidance" },
		]);

		const config: PromptConfig = {
			fileType: "agents",
			newNodesAllowed: true,
			splitLargeNodes: false,
			promptResolver: resolver,
		};

		const result = buildAnalysisPrompt(prContext, intentContext, config);

		expect(result).toContain("## Custom Guidance");
		expect(result).toContain("API package guidance");
	});

	test("omits custom prompts section when no patterns match", () => {
		const prContext: PRContext = {
			metadata: createMockPRMetadata(),
			commits: [],
			linkedIssues: [],
			reviewComments: [],
			changedFiles: [createMockChangedFile({ filename: "src/index.ts" })],
		};

		const intentContext: IntentContext = {
			nodesToUpdate: [],
			parentNodesToReview: [],
			potentialNewNodes: [],
		};

		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "test/**", prompt: "Test guidance" },
		]);

		const config: PromptConfig = {
			fileType: "agents",
			newNodesAllowed: true,
			splitLargeNodes: false,
			promptResolver: resolver,
		};

		const result = buildAnalysisPrompt(prContext, intentContext, config);

		expect(result).not.toContain("## Custom Guidance");
	});
});

describe("buildSingleNodeUpdatePrompt with custom prompts", () => {
	test("includes custom prompts when resolver matches files", () => {
		const nodeWithContent: IntentNodeWithContent = {
			node: {
				file: createMockIntentFile("packages/api/AGENTS.md"),
				directory: "packages/api",
				parent: undefined,
				children: [],
				depth: 1,
			},
			currentContent: "# API",
		};

		const changedFiles = [
			createMockChangedFile({ filename: "packages/api/client.ts" }),
		];

		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "packages/api/**", prompt: "API guidance" },
		]);

		const result = buildSingleNodeUpdatePrompt(
			nodeWithContent,
			changedFiles,
			"API changes",
			createMockPRMetadata(),
			"agents",
			resolver,
		);

		expect(result).toContain("## Custom Guidance");
		expect(result).toContain("API guidance");
	});
});

describe("buildNewNodePrompt with custom prompts", () => {
	test("includes custom prompts when resolver matches files", () => {
		const candidate: SemanticBoundaryCandidate = {
			directory: "packages/api",
			suggestedNodePath: "packages/api/AGENTS.md",
			uncoveredFiles: [
				{
					file: createMockChangedFile({ filename: "packages/api/index.ts" }),
					coveringNode: undefined,
					isIgnored: false,
				},
			],
			changeSummary: {
				filesAdded: 1,
				filesModified: 0,
				filesRemoved: 0,
				filesRenamed: 0,
				totalAdditions: 50,
				totalDeletions: 0,
			},
			reason: "New package",
			confidence: 0.8,
		};

		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "packages/api/**", prompt: "API package guidance" },
		]);

		const result = buildNewNodePrompt(
			candidate,
			createMockPRMetadata(),
			"agents",
			resolver,
		);

		expect(result).toContain("## Custom Guidance");
		expect(result).toContain("API package guidance");
	});
});

describe("buildInitializationPrompt with custom prompts", () => {
	test("includes custom prompts when resolver matches files", () => {
		const changedFiles = [createMockChangedFile({ filename: "src/index.ts" })];

		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "src/**", prompt: "Source file guidance" },
		]);

		const result = buildInitializationPrompt(
			createMockPRMetadata(),
			changedFiles,
			"agents",
			resolver,
		);

		expect(result).toContain("## Custom Guidance");
		expect(result).toContain("Source file guidance");
	});
});
