/**
 * Integration test: `output: new_pr` mode
 *
 * Tests the scenario where the action creates a separate PR for intent layer
 * updates rather than posting comments on the original PR.
 *
 * When `output: new_pr`:
 * 1. Create a separate branch (`intent-layer/<pr-number>`)
 * 2. Apply all suggested changes to that branch (no approval checkboxes needed)
 * 3. Open a PR targeting the original PR's branch
 * 4. Post a single comment on the original PR linking to the intent layer PR
 */

import { describe, expect, mock, test } from "bun:test";
import type { GitHubClient } from "../../src/github/client";
import {
	generateIntentLayerLinkComment,
	hasIntentLayerLinkMarker,
	INTENT_LAYER_LINK_MARKER,
	postIntentLayerLinkComment,
} from "../../src/github/comments";
import {
	applyUpdatesToBranch,
	createIntentLayerBranch,
	generateIntentLayerBranchName,
	generateIntentLayerPRBody,
	generateIntentLayerPRTitle,
	openIntentLayerPullRequest,
} from "../../src/github/commits";
import type { IntentUpdate } from "../../src/opencode/output-schema";

/**
 * Create a mock GitHub client for testing new_pr mode operations.
 */
function createMockClient(overrides: Record<string, unknown> = {}) {
	const defaults = {
		getFileContent: mock(async () => {
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		}),
		createOrUpdateFile: mock(async () => ({
			commit: {
				sha: "newcommitsha123",
				html_url: "https://github.com/owner/repo/commit/newcommitsha123",
			},
			content: {
				sha: "blobsha123",
			},
		})),
		createBranch: mock(async (branchName: string, baseSha: string) => ({
			ref: `refs/heads/${branchName}`,
			object: { sha: baseSha, type: "commit" },
		})),
		createPullRequest: mock(
			async (title: string, _body: string, head: string, base: string) => ({
				number: 99,
				title,
				html_url: "https://github.com/owner/repo/pull/99",
				head: { ref: head },
				base: { ref: base },
			}),
		),
		getIssueComments: mock(async () => []),
		createComment: mock(async (_prNumber: number, body: string) => ({
			id: 12345,
			html_url: "https://github.com/owner/repo/pull/42#issuecomment-12345",
			body,
		})),
		updateComment: mock(async (_commentId: number, body: string) => ({
			id: 12345,
			html_url: "https://github.com/owner/repo/pull/42#issuecomment-12345",
			body,
		})),
	};
	return { ...defaults, ...overrides } as unknown as GitHubClient;
}

describe("Integration: output new_pr mode", () => {
	describe("Branch creation for intent layer PR", () => {
		test("creates branch with correct naming convention", async () => {
			const mockCreateBranch = mock(
				async (branchName: string, sha: string) => ({
					ref: `refs/heads/${branchName}`,
					object: { sha, type: "commit" },
				}),
			);

			const client = createMockClient({
				createBranch: mockCreateBranch,
			});

			const result = await createIntentLayerBranch(
				client,
				42,
				"base-sha-abc123",
			);

			expect(result.branchName).toBe("intent-layer/42");
			expect(result.sha).toBe("base-sha-abc123");
			expect(result.ref).toBe("refs/heads/intent-layer/42");
			expect(mockCreateBranch).toHaveBeenCalledWith(
				"intent-layer/42",
				"base-sha-abc123",
			);
		});

		test("branch name follows intent-layer/<pr-number> format", () => {
			expect(generateIntentLayerBranchName(1)).toBe("intent-layer/1");
			expect(generateIntentLayerBranchName(42)).toBe("intent-layer/42");
			expect(generateIntentLayerBranchName(9999)).toBe("intent-layer/9999");
		});
	});

	describe("Applying updates to branch", () => {
		test("applies multiple intent updates without approval checkboxes", async () => {
			let commitCount = 0;
			const mockGetFileContent = mock(async () => {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			});

			const createdFiles: string[] = [];
			const mockCreateOrUpdateFile = mock(async (path: string) => {
				createdFiles.push(path);
				return {
					commit: {
						sha: `sha${++commitCount}`,
						html_url: `https://github.com/commit/sha${commitCount}`,
					},
					content: { sha: "blobsha" },
				};
			});

			const client = createMockClient({
				getFileContent: mockGetFileContent,
				createOrUpdateFile: mockCreateOrUpdateFile,
			});

			const updates: IntentUpdate[] = [
				{
					nodePath: "AGENTS.md",
					action: "create",
					reason: "Initialize root intent layer",
					suggestedContent: "# Root AGENTS.md\n\nProject documentation.\n",
				},
				{
					nodePath: "packages/api/AGENTS.md",
					action: "create",
					reason: "New API package documentation",
					suggestedContent: "# API Package\n\nAPI documentation.\n",
				},
				{
					nodePath: "packages/core/AGENTS.md",
					action: "create",
					reason: "New core package documentation",
					suggestedContent: "# Core Package\n\nCore documentation.\n",
				},
			];

			const result = await applyUpdatesToBranch(client, updates, {
				branch: "intent-layer/42",
			});

			expect(result.appliedCount).toBe(3);
			expect(result.totalCount).toBe(3);
			expect(result.errors).toHaveLength(0);
			expect(createdFiles).toContain("AGENTS.md");
			expect(createdFiles).toContain("packages/api/AGENTS.md");
			expect(createdFiles).toContain("packages/core/AGENTS.md");
		});

		test("handles mixed create and update actions", async () => {
			let fileCallCount = 0;
			const mockGetFileContent = mock(async (path: string) => {
				fileCallCount++;
				if (path === "AGENTS.md") {
					// Root file exists - for update action
					return {
						sha: "existingsha",
						type: "file",
						content: Buffer.from("# Old Content\n").toString("base64"),
					};
				}
				// New files don't exist - for create action
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			});

			let commitCount = 0;
			const mockCreateOrUpdateFile = mock(async () => ({
				commit: {
					sha: `sha${++commitCount}`,
					html_url: `https://github.com/commit/sha${commitCount}`,
				},
				content: { sha: "blobsha" },
			}));

			const client = createMockClient({
				getFileContent: mockGetFileContent,
				createOrUpdateFile: mockCreateOrUpdateFile,
			});

			const updates: IntentUpdate[] = [
				{
					nodePath: "AGENTS.md",
					action: "update",
					reason: "Update root documentation",
					currentContent: "# Old Content\n",
					suggestedContent: "# Updated Root\n\nNew content.\n",
				},
				{
					nodePath: "packages/new/AGENTS.md",
					action: "create",
					reason: "New package documentation",
					suggestedContent: "# New Package\n",
				},
			];

			const result = await applyUpdatesToBranch(client, updates, {
				branch: "intent-layer/42",
			});

			expect(result.appliedCount).toBe(2);
			expect(result.totalCount).toBe(2);
			expect(result.errors).toHaveLength(0);
		});

		test("continues applying updates even if one fails", async () => {
			const mockGetFileContent = mock(async (path: string) => {
				if (path === "packages/failing/AGENTS.md") {
					// This file doesn't exist but we're trying to update it (will fail)
					const error = new Error("Not Found") as Error & { status: number };
					error.status = 404;
					throw error;
				}
				// Other files don't exist for create
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			});

			const mockCreateOrUpdateFile = mock(async () => ({
				commit: {
					sha: "successsha",
					html_url: "https://github.com/commit/successsha",
				},
				content: { sha: "blobsha" },
			}));

			const client = createMockClient({
				getFileContent: mockGetFileContent,
				createOrUpdateFile: mockCreateOrUpdateFile,
			});

			const updates: IntentUpdate[] = [
				{
					nodePath: "packages/failing/AGENTS.md",
					action: "update", // Will fail - file doesn't exist
					reason: "This should fail",
					currentContent: "# Old\n",
					suggestedContent: "# New\n",
				},
				{
					nodePath: "packages/success/AGENTS.md",
					action: "create", // Will succeed
					reason: "This should succeed",
					suggestedContent: "# Success\n",
				},
			];

			const result = await applyUpdatesToBranch(client, updates, {
				branch: "intent-layer/42",
				stopOnError: false, // Continue on errors
			});

			expect(result.appliedCount).toBe(1);
			expect(result.totalCount).toBe(2);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.update.nodePath).toBe(
				"packages/failing/AGENTS.md",
			);
			expect(result.commits[0]?.filePath).toBe("packages/success/AGENTS.md");
		});
	});

	describe("Opening intent layer PR", () => {
		test("creates PR targeting original PR branch", async () => {
			let capturedHead = "";
			let capturedBase = "";
			const mockCreatePullRequest = mock(
				async (title: string, body: string, head: string, base: string) => {
					capturedHead = head;
					capturedBase = base;
					return {
						number: 99,
						title,
						html_url: "https://github.com/owner/repo/pull/99",
					};
				},
			);

			const client = createMockClient({
				createPullRequest: mockCreatePullRequest,
			});

			const result = await openIntentLayerPullRequest(client, {
				originalPrNumber: 42,
				originalPrHeadBranch: "feature/my-changes",
			});

			expect(result.number).toBe(99);
			expect(result.headBranch).toBe("intent-layer/42");
			expect(result.baseBranch).toBe("feature/my-changes");
			expect(capturedHead).toBe("intent-layer/42");
			expect(capturedBase).toBe("feature/my-changes");
		});

		test("generates appropriate PR title", () => {
			const title = generateIntentLayerPRTitle(42);
			expect(title).toBe("[Intent Layer] Updates for PR #42");
		});

		test("generates PR body with reference to original PR", () => {
			const body = generateIntentLayerPRBody(42);

			expect(body).toContain("#42");
			expect(body).toContain("Intent Layer Updates");
			expect(body).toContain("AGENTS.md");
			expect(body).toContain("CLAUDE.md");
			expect(body).toContain("automatically generated");
		});

		test("allows custom title and body", async () => {
			let capturedTitle = "";
			let capturedBody = "";
			const mockCreatePullRequest = mock(
				async (title: string, body: string, _head: string, _base: string) => {
					capturedTitle = title;
					capturedBody = body;
					return {
						number: 100,
						title,
						html_url: "https://github.com/owner/repo/pull/100",
					};
				},
			);

			const client = createMockClient({
				createPullRequest: mockCreatePullRequest,
			});

			await openIntentLayerPullRequest(client, {
				originalPrNumber: 42,
				originalPrHeadBranch: "feature/changes",
				title: "Custom Title",
				body: "Custom body content",
			});

			expect(capturedTitle).toBe("Custom Title");
			expect(capturedBody).toBe("Custom body content");
		});
	});

	describe("Link comment on original PR", () => {
		test("generates link comment with correct content", () => {
			const comment = generateIntentLayerLinkComment(
				99,
				"https://github.com/owner/repo/pull/99",
				3,
			);

			expect(comment).toContain(INTENT_LAYER_LINK_MARKER);
			expect(comment).toContain("#99");
			expect(comment).toContain("https://github.com/owner/repo/pull/99");
			expect(comment).toContain("3 intent layer updates");
		});

		test("uses singular form for single update", () => {
			const comment = generateIntentLayerLinkComment(
				99,
				"https://github.com/owner/repo/pull/99",
				1,
			);

			expect(comment).toContain("1 intent layer update");
			expect(comment).not.toContain("updates");
		});

		test("hasIntentLayerLinkMarker detects marker correctly", () => {
			const commentWithMarker = generateIntentLayerLinkComment(
				99,
				"https://github.com/owner/repo/pull/99",
				2,
			);
			const commentWithoutMarker = "Just a regular comment";

			expect(hasIntentLayerLinkMarker(commentWithMarker)).toBe(true);
			expect(hasIntentLayerLinkMarker(commentWithoutMarker)).toBe(false);
		});

		test("posts new link comment when none exists", async () => {
			const mockGetIssueComments = mock(async () => []);
			let createdCommentBody = "";
			const mockCreateComment = mock(
				async (_prNumber: number, body: string) => {
					createdCommentBody = body;
					return {
						id: 12345,
						html_url:
							"https://github.com/owner/repo/pull/42#issuecomment-12345",
						body,
					};
				},
			);

			const client = createMockClient({
				getIssueComments: mockGetIssueComments,
				createComment: mockCreateComment,
			});

			const result = await postIntentLayerLinkComment(
				client,
				42, // original PR number
				99, // intent layer PR number
				"https://github.com/owner/repo/pull/99",
				3, // update count
			);

			expect(result.commentId).toBe(12345);
			expect(mockCreateComment).toHaveBeenCalled();
			expect(hasIntentLayerLinkMarker(createdCommentBody)).toBe(true);
			expect(createdCommentBody).toContain("#99");
		});

		test("updates existing link comment instead of creating new one", async () => {
			const existingComment = {
				id: 11111,
				body: generateIntentLayerLinkComment(
					88,
					"https://github.com/owner/repo/pull/88",
					2,
				),
				html_url: "https://github.com/owner/repo/pull/42#issuecomment-11111",
			};

			const mockGetIssueComments = mock(async () => [existingComment]);
			let updatedCommentBody = "";
			const mockUpdateComment = mock(
				async (_commentId: number, body: string) => {
					updatedCommentBody = body;
					return {
						id: 11111,
						html_url:
							"https://github.com/owner/repo/pull/42#issuecomment-11111",
						body,
					};
				},
			);
			const mockCreateComment = mock(async () => ({
				id: 99999,
				html_url: "https://github.com/owner/repo/pull/42#issuecomment-99999",
			}));

			const client = createMockClient({
				getIssueComments: mockGetIssueComments,
				updateComment: mockUpdateComment,
				createComment: mockCreateComment,
			});

			const result = await postIntentLayerLinkComment(
				client,
				42,
				99, // new intent layer PR number
				"https://github.com/owner/repo/pull/99",
				5, // new update count
			);

			// Should update existing comment, not create new one
			expect(result.commentId).toBe(11111);
			expect(mockUpdateComment).toHaveBeenCalledWith(11111, expect.any(String));
			expect(mockCreateComment).not.toHaveBeenCalled();
			expect(updatedCommentBody).toContain("#99");
			expect(updatedCommentBody).toContain("5 intent layer updates");
		});
	});

	describe("Full new_pr flow integration", () => {
		test("complete flow: branch → apply updates → open PR → link comment", async () => {
			// Track operations in order
			const operations: string[] = [];

			const mockCreateBranch = mock(async (branchName: string, sha: string) => {
				operations.push(`create-branch:${branchName}`);
				return {
					ref: `refs/heads/${branchName}`,
					object: { sha, type: "commit" },
				};
			});

			const mockGetFileContent = mock(async () => {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			});

			const mockCreateOrUpdateFile = mock(async (path: string) => {
				operations.push(`apply-update:${path}`);
				return {
					commit: {
						sha: "commitsha",
						html_url: "https://github.com/commit/commitsha",
					},
					content: { sha: "blobsha" },
				};
			});

			const mockCreatePullRequest = mock(
				async (title: string, _body: string, head: string, _base: string) => {
					operations.push(`create-pr:${head}`);
					return {
						number: 99,
						title,
						html_url: "https://github.com/owner/repo/pull/99",
					};
				},
			);

			const mockGetIssueComments = mock(async () => {
				operations.push("get-comments");
				return [];
			});

			const mockCreateComment = mock(async () => {
				operations.push("create-link-comment");
				return {
					id: 12345,
					html_url: "https://github.com/owner/repo/pull/42#issuecomment-12345",
				};
			});

			const client = createMockClient({
				createBranch: mockCreateBranch,
				getFileContent: mockGetFileContent,
				createOrUpdateFile: mockCreateOrUpdateFile,
				createPullRequest: mockCreatePullRequest,
				getIssueComments: mockGetIssueComments,
				createComment: mockCreateComment,
			});

			// Step 1: Create branch
			const branchResult = await createIntentLayerBranch(
				client,
				42,
				"base-sha",
			);
			expect(branchResult.branchName).toBe("intent-layer/42");

			// Step 2: Apply updates to branch
			const updates: IntentUpdate[] = [
				{
					nodePath: "AGENTS.md",
					action: "create",
					reason: "Initialize intent layer",
					suggestedContent: "# Root\n",
				},
				{
					nodePath: "packages/api/AGENTS.md",
					action: "create",
					reason: "API documentation",
					suggestedContent: "# API\n",
				},
			];

			const applyResult = await applyUpdatesToBranch(client, updates, {
				branch: branchResult.branchName,
			});
			expect(applyResult.appliedCount).toBe(2);

			// Step 3: Open intent layer PR
			const prResult = await openIntentLayerPullRequest(client, {
				originalPrNumber: 42,
				originalPrHeadBranch: "feature/changes",
			});
			expect(prResult.number).toBe(99);

			// Step 4: Post link comment on original PR
			const linkResult = await postIntentLayerLinkComment(
				client,
				42,
				prResult.number,
				prResult.url,
				updates.length,
			);
			expect(linkResult.commentId).toBe(12345);

			// Verify operation order
			expect(operations).toEqual([
				"create-branch:intent-layer/42",
				"apply-update:AGENTS.md",
				"apply-update:packages/api/AGENTS.md",
				"create-pr:intent-layer/42",
				"get-comments",
				"create-link-comment",
			]);
		});

		test("handles scenario with no updates gracefully", async () => {
			const client = createMockClient();

			const updates: IntentUpdate[] = [];

			const applyResult = await applyUpdatesToBranch(client, updates, {
				branch: "intent-layer/42",
			});

			expect(applyResult.appliedCount).toBe(0);
			expect(applyResult.totalCount).toBe(0);
			expect(applyResult.errors).toHaveLength(0);
			expect(applyResult.commits).toHaveLength(0);
		});

		test("symlink options are passed through to apply updates", async () => {
			const mockGetFileContent = mock(async () => {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			});

			const filesCreated: Array<{
				path: string;
				content: string;
				isSymlink: boolean;
			}> = [];
			const mockCreateFilesWithSymlinks = mock(
				async (
					files: Array<{ path: string; content: string; isSymlink: boolean }>,
				) => {
					for (const f of files) {
						filesCreated.push(f);
					}
					return {
						sha: "symlinksha",
						url: "https://github.com/commit/symlinksha",
					};
				},
			);

			const client = createMockClient({
				getFileContent: mockGetFileContent,
				createFilesWithSymlinks: mockCreateFilesWithSymlinks,
			});

			const updates: IntentUpdate[] = [
				{
					nodePath: "packages/api/AGENTS.md",
					otherNodePath: "packages/api/CLAUDE.md",
					action: "create",
					reason: "New API package with both files",
					suggestedContent: "# API\n",
				},
			];

			const result = await applyUpdatesToBranch(client, updates, {
				branch: "intent-layer/42",
				symlink: true,
				symlinkSource: "agents",
			});

			expect(result.appliedCount).toBe(1);
			expect(mockCreateFilesWithSymlinks).toHaveBeenCalled();
			expect(filesCreated.length).toBe(2);

			// AGENTS.md should be source
			const agentsFile = filesCreated.find((f) => f.path.endsWith("AGENTS.md"));
			expect(agentsFile?.isSymlink).toBe(false);

			// CLAUDE.md should be symlink
			const claudeFile = filesCreated.find((f) => f.path.endsWith("CLAUDE.md"));
			expect(claudeFile?.isSymlink).toBe(true);
		});
	});
});
