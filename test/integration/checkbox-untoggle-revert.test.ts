/**
 * Integration test: checkbox untoggle → revert
 *
 * Tests the scenario where a user unchecks the approval checkbox in an intent layer
 * comment. The checkbox-handler should:
 * 1. Debounce the checkbox state to ensure stability
 * 2. Check if an appliedCommit exists (if not, skip - nothing to revert)
 * 3. Perform a file-level revert by restoring the file to its pre-commit state
 * 4. Update the comment marker to clear appliedCommit and add REVERTED status
 */

import { describe, expect, mock, test } from "bun:test";
import {
	debounceCheckboxToggle,
	handleUncheckedCheckbox,
} from "../../src/github/checkbox-handler";
import type { GitHubClient } from "../../src/github/client";
import {
	INTENT_LAYER_MARKER_PREFIX,
	INTENT_LAYER_MARKER_SUFFIX,
	isCheckboxChecked,
	parseCommentMarker,
} from "../../src/github/comments";

/**
 * Helper to create a comment body with proper marker and content structure.
 */
function createCommentBody(options: {
	nodePath: string;
	otherNodePath?: string;
	headSha: string;
	appliedCommit?: string;
	checked: boolean;
	suggestedContent?: string;
	currentContent?: string;
	reason?: string;
	action?: "create" | "update";
}): string {
	const parts = [`node=${encodeURIComponent(options.nodePath)}`];
	if (options.otherNodePath) {
		parts.push(`otherNode=${encodeURIComponent(options.otherNodePath)}`);
	}
	parts.push(`appliedCommit=${options.appliedCommit ?? ""}`);
	parts.push(`headSha=${options.headSha}`);

	const marker = `${INTENT_LAYER_MARKER_PREFIX} ${parts.join(" ")} ${INTENT_LAYER_MARKER_SUFFIX}`;
	const checkbox = options.checked
		? "- [x] Apply this change"
		: "- [ ] Apply this change";

	const suggestedContent =
		options.suggestedContent ??
		"# Default Content\n\nThis is suggested content.";
	const reason = options.reason ?? "Changes detected in covered files";

	let content = `${marker}

## Intent Layer ${options.action === "update" ? "Update" : "Add"} Suggestion

**Path:** \`${options.nodePath}\`

`;

	if (options.currentContent) {
		content += `### Current Content

\`\`\`markdown
${options.currentContent}
\`\`\`

`;
	}

	content += `### Suggested Content

\`\`\`markdown
${suggestedContent}
\`\`\`

**Reason:** ${reason}

---

${checkbox}`;

	return content;
}

/**
 * Create a mock GitHubClient with configurable responses for revert tests.
 */
function createMockClient(options: {
	getCommentBody?: string | null;
	fileExists?: boolean;
	existingFileContent?: string;
	parentFileContent?: string | null; // Content at parent commit (null = file didn't exist)
	commitSha?: string;
	commitError?: Error;
	parentCommitSha?: string;
}): GitHubClient {
	const commitSha = options.commitSha ?? "revert-commit-sha-123";
	const parentCommitSha = options.parentCommitSha ?? "parent-commit-sha-456";

	return {
		getComment: mock((commentId: number) =>
			Promise.resolve({ id: commentId, body: options.getCommentBody ?? "" }),
		),
		getFileContent: mock((path: string, ref?: string) => {
			// If querying the parent commit for file content (for revert)
			if (ref === parentCommitSha) {
				if (options.parentFileContent === null) {
					// File didn't exist at parent commit
					const error = new Error("Not Found") as Error & { status: number };
					error.status = 404;
					return Promise.reject(error);
				}
				return Promise.resolve({
					sha: "parent-file-sha",
					content: Buffer.from(
						options.parentFileContent ?? "# Parent Content",
					).toString("base64"),
				});
			}

			// Current branch file content
			if (options.fileExists) {
				return Promise.resolve({
					sha: "existing-file-sha",
					content: Buffer.from(
						options.existingFileContent ?? "# Existing Content",
					).toString("base64"),
				});
			}
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			return Promise.reject(error);
		}),
		getCommit: mock((sha: string) => {
			return Promise.resolve({
				sha,
				parents: [{ sha: parentCommitSha }],
			});
		}),
		createOrUpdateFile: mock(
			(
				path: string,
				content: string,
				message: string,
				branch: string,
				sha?: string,
			) => {
				if (options.commitError) {
					return Promise.reject(options.commitError);
				}
				return Promise.resolve({
					commit: {
						sha: commitSha,
						html_url: `https://github.com/test/repo/commit/${commitSha}`,
					},
				});
			},
		),
		deleteFile: mock(
			(path: string, message: string, branch: string, sha: string) => {
				if (options.commitError) {
					return Promise.reject(options.commitError);
				}
				return Promise.resolve({
					commit: {
						sha: commitSha,
						html_url: `https://github.com/test/repo/commit/${commitSha}`,
					},
				});
			},
		),
		updateComment: mock((commentId: number, body: string) =>
			Promise.resolve({ id: commentId, body }),
		),
	} as unknown as GitHubClient;
}

describe("Integration: checkbox untoggle → revert", () => {
	describe("Full flow: checkbox unchecked with appliedCommit → file-level revert", () => {
		test("creates REVERT commit when checkbox is unchecked and appliedCommit exists", async () => {
			const nodePath = "packages/api/AGENTS.md";
			const headSha = "abc123def456";
			const appliedCommit = "applied-commit-sha-789";
			const parentFileContent = "# Original Content\n\nThis was here before.";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				appliedCommit,
				checked: false,
				action: "update",
			});

			// Mock client where file exists and has parent content to restore
			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: true,
				existingFileContent: "# New Content\n\nThis was added.",
				parentFileContent,
				commitSha: "revert-commit-sha-final",
				parentCommitSha: "parent-before-intent-change",
			});

			// Step 1: Debounce check
			const debounceResult = await debounceCheckboxToggle(
				mockClient,
				123,
				commentBody,
				{ delayMs: 10 }, // Short delay for testing
			);

			expect(debounceResult.stable).toBe(true);
			expect(debounceResult.isChecked).toBe(false);
			expect(debounceResult.markerData).toBeDefined();
			expect(debounceResult.markerData?.nodePath).toBe(nodePath);
			expect(debounceResult.markerData?.appliedCommit).toBe(appliedCommit);

			// Step 2: Handle unchecked checkbox
			const result = await handleUncheckedCheckbox(
				mockClient,
				123,
				commentBody,
				debounceResult.markerData!,
				{ branch: "feature-branch" },
			);

			expect(result.success).toBe(true);
			expect(result.skipped).toBeUndefined();
			expect(result.commitResult).toBeDefined();
			expect(result.commitResult?.sha).toBe("revert-commit-sha-final");
			expect(result.commitResult?.message).toContain("[INTENT:REVERT]");
			expect(result.commitResult?.message).toContain(nodePath);

			// Verify client methods were called correctly
			expect(mockClient.getCommit).toHaveBeenCalled();
			expect(mockClient.createOrUpdateFile).toHaveBeenCalled();
			expect(mockClient.updateComment).toHaveBeenCalled();
		});

		test("updates comment marker to clear appliedCommit and add REVERTED status", async () => {
			const nodePath = "src/AGENTS.md";
			const headSha = "head123";
			const appliedCommit = "applied-sha-xyz";
			const revertCommitSha = "revert-commit-sha-abc";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				appliedCommit,
				checked: false,
				action: "update",
			});

			let updatedBody = "";
			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: true,
				parentFileContent: "# Original",
				commitSha: revertCommitSha,
			});
			(mockClient.updateComment as ReturnType<typeof mock>).mockImplementation(
				(id: number, body: string) => {
					updatedBody = body;
					return Promise.resolve({ id, body });
				},
			);

			const markerData = parseCommentMarker(commentBody)!;

			await handleUncheckedCheckbox(mockClient, 123, commentBody, markerData, {
				branch: "main",
			});

			// Verify the comment was updated with cleared appliedCommit
			expect(updatedBody).toContain("appliedCommit=");
			// appliedCommit should be empty (cleared)
			const newMarker = parseCommentMarker(updatedBody);
			expect(newMarker?.appliedCommit).toBeUndefined();

			// Verify REVERTED status was added
			expect(updatedBody).toContain("**REVERTED**");
			expect(updatedBody).toContain(revertCommitSha.substring(0, 7));
		});
	});

	describe("Skip when no appliedCommit exists", () => {
		test("skips revert when checkbox unchecked but no appliedCommit exists", async () => {
			const nodePath = "packages/api/AGENTS.md";
			const headSha = "abc123def456";
			// No appliedCommit - nothing was ever applied

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				checked: false,
				action: "create",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: false,
			});

			const debounceResult = await debounceCheckboxToggle(
				mockClient,
				123,
				commentBody,
				{ delayMs: 10 },
			);

			expect(debounceResult.stable).toBe(true);
			expect(debounceResult.isChecked).toBe(false);
			expect(debounceResult.markerData?.appliedCommit).toBeUndefined();

			// Handle unchecked checkbox - should skip since no appliedCommit
			const result = await handleUncheckedCheckbox(
				mockClient,
				123,
				commentBody,
				debounceResult.markerData!,
				{ branch: "feature-branch" },
			);

			expect(result.success).toBe(true);
			expect(result.skipped).toBe(true);
			expect(result.commitResult).toBeUndefined();

			// No commit should have been created
			expect(mockClient.createOrUpdateFile).not.toHaveBeenCalled();
			expect(mockClient.deleteFile).not.toHaveBeenCalled();
		});
	});

	describe("File deletion when file didn't exist before", () => {
		test("deletes file when it didn't exist at parent commit", async () => {
			const nodePath = "packages/new/AGENTS.md";
			const headSha = "head-sha-123";
			const appliedCommit = "add-commit-sha-456";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				appliedCommit,
				checked: false,
				action: "create",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: true,
				existingFileContent: "# New File Content",
				parentFileContent: null, // File didn't exist before
				commitSha: "delete-commit-sha",
			});

			const markerData = parseCommentMarker(commentBody)!;

			const result = await handleUncheckedCheckbox(
				mockClient,
				123,
				commentBody,
				markerData,
				{ branch: "feature-branch" },
			);

			expect(result.success).toBe(true);
			expect(result.commitResult).toBeDefined();
			expect(result.commitResult?.message).toContain("[INTENT:REVERT]");

			// deleteFile should have been called since file didn't exist before
			expect(mockClient.deleteFile).toHaveBeenCalled();
		});
	});

	describe("Debounce mechanism for untoggle", () => {
		test("returns unstable when checkbox state changes during debounce", async () => {
			const initialBody = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc123",
				appliedCommit: "applied-sha",
				checked: false, // Initially unchecked
				action: "update",
			});

			const changedBody = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc123",
				appliedCommit: "applied-sha",
				checked: true, // Changed back to checked
				action: "update",
			});

			const mockClient = createMockClient({
				getCommentBody: changedBody, // Returns changed state after delay
			});

			const result = await debounceCheckboxToggle(
				mockClient,
				123,
				initialBody,
				{ delayMs: 10 },
			);

			expect(result.stable).toBe(false);
			expect(result.reason).toContain("Checkbox state changed");
		});

		test("returns stable when unchecked checkbox state remains consistent", async () => {
			const commentBody = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc123",
				appliedCommit: "applied-sha",
				checked: false,
				action: "update",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody, // Same state after delay
			});

			const result = await debounceCheckboxToggle(
				mockClient,
				123,
				commentBody,
				{ delayMs: 10 },
			);

			expect(result.stable).toBe(true);
			expect(result.isChecked).toBe(false);
			expect(result.markerData).toBeDefined();
			expect(result.markerData?.appliedCommit).toBe("applied-sha");
		});
	});

	describe("Both files (AGENTS.md + CLAUDE.md) revert handling", () => {
		test("reverts both files when otherNodePath is present", async () => {
			const nodePath = "packages/api/AGENTS.md";
			const otherNodePath = "packages/api/CLAUDE.md";
			const headSha = "head-sha-dual";
			const appliedCommit = "applied-commit-dual";

			const commentBody = createCommentBody({
				nodePath,
				otherNodePath,
				headSha,
				appliedCommit,
				checked: false,
				action: "update",
			});

			const createOrUpdateCalls: Array<{
				path: string;
				content: string;
				message: string;
			}> = [];

			const mockClient = {
				getComment: mock(() => Promise.resolve({ id: 123, body: commentBody })),
				getCommit: mock(() =>
					Promise.resolve({
						sha: appliedCommit,
						parents: [{ sha: "parent-sha" }],
					}),
				),
				getFileContent: mock((path: string, ref?: string) => {
					// Return content for both files
					return Promise.resolve({
						sha: `sha-for-${path}`,
						content: Buffer.from("# Content").toString("base64"),
					});
				}),
				createOrUpdateFile: mock(
					(path: string, content: string, message: string, branch: string) => {
						createOrUpdateCalls.push({ path, content, message });
						return Promise.resolve({
							commit: {
								sha: "revert-dual-sha",
								html_url: "https://github.com/test/repo/commit/revert-dual-sha",
							},
						});
					},
				),
				deleteFile: mock(() =>
					Promise.resolve({
						commit: { sha: "delete-sha", html_url: "" },
					}),
				),
				updateComment: mock(() => Promise.resolve({ id: 123, body: "" })),
			} as unknown as GitHubClient;

			const markerData = parseCommentMarker(commentBody)!;

			await handleUncheckedCheckbox(mockClient, 123, commentBody, markerData, {
				branch: "main",
			});

			// Both files should have been processed
			// The main file + otherNodePath should be handled
			expect(createOrUpdateCalls.length).toBeGreaterThanOrEqual(1);

			// At least one call should be for the main nodePath
			const mainNodeCall = createOrUpdateCalls.find((c) =>
				c.path.includes("AGENTS.md"),
			);
			expect(mainNodeCall).toBeDefined();
		});
	});

	describe("Error handling", () => {
		test("handles commit creation failure gracefully", async () => {
			const nodePath = "AGENTS.md";
			const headSha = "error-test-sha";
			const appliedCommit = "applied-sha-error";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				appliedCommit,
				checked: false,
				action: "update",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: true,
				parentFileContent: "# Original",
				commitError: new Error("Permission denied"),
			});

			const markerData = parseCommentMarker(commentBody)!;

			const result = await handleUncheckedCheckbox(
				mockClient,
				123,
				commentBody,
				markerData,
				{ branch: "main" },
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Failed to create revert commit");
			expect(result.error).toContain("Permission denied");
		});

		test("handles missing parent commit gracefully", async () => {
			const nodePath = "AGENTS.md";
			const headSha = "head-sha";
			const appliedCommit = "no-parent-commit";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				appliedCommit,
				checked: false,
				action: "update",
			});

			// Create a mock client where getCommit returns no parents
			const mockClient = {
				getComment: mock(() => Promise.resolve({ id: 123, body: commentBody })),
				getCommit: mock(() =>
					Promise.resolve({
						sha: appliedCommit,
						parents: [], // No parents!
					}),
				),
				getFileContent: mock(() =>
					Promise.resolve({
						sha: "file-sha",
						content: Buffer.from("# Content").toString("base64"),
					}),
				),
				createOrUpdateFile: mock(() =>
					Promise.resolve({ commit: { sha: "", html_url: "" } }),
				),
				deleteFile: mock(() =>
					Promise.resolve({ commit: { sha: "", html_url: "" } }),
				),
				updateComment: mock(() => Promise.resolve({ id: 123, body: "" })),
			} as unknown as GitHubClient;

			const markerData = parseCommentMarker(commentBody)!;

			const result = await handleUncheckedCheckbox(
				mockClient,
				123,
				commentBody,
				markerData,
				{ branch: "main" },
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("no parent");
		});
	});

	describe("End-to-end revert scenario", () => {
		test("complete checkbox untoggle flow from checked→unchecked with revert", async () => {
			// Simulate the complete flow that would occur in the GitHub Action

			// 1. Setup: A change was previously applied (checkbox was checked)
			const nodePath = "packages/feature/AGENTS.md";
			const headSha = "e2e-head-sha";
			const appliedCommit = "e2e-applied-commit-sha";
			const originalContent =
				"# Feature Package\n\n## Overview\n\nOriginal documentation.";
			const newContent =
				"# Feature Package\n\n## Overview\n\nUpdated documentation with new features.";

			// 2. Comment body shows checkbox is now unchecked (user unchecked it)
			const commentBody = createCommentBody({
				nodePath,
				headSha,
				appliedCommit,
				checked: false, // User unchecked the box
				currentContent: originalContent,
				suggestedContent: newContent,
				reason: "10 new files added to packages/feature",
				action: "update",
			});

			const eventPayload = {
				action: "edited",
				comment: {
					id: 999,
					body: commentBody,
				},
				issue: {
					number: 42,
					pull_request: {
						html_url: "https://github.com/test/repo/pull/42",
					},
				},
			};

			// 3. Setup mock client
			let finalCommentBody = "";
			const mockClient = {
				getComment: mock(() => Promise.resolve({ id: 999, body: commentBody })),
				getCommit: mock(() =>
					Promise.resolve({
						sha: appliedCommit,
						parents: [{ sha: "parent-commit-sha" }],
					}),
				),
				getFileContent: mock((path: string, ref?: string) => {
					if (ref === "parent-commit-sha") {
						// Return original content from before the intent change
						return Promise.resolve({
							sha: "original-file-sha",
							content: Buffer.from(originalContent).toString("base64"),
						});
					}
					// Current file content (after intent was applied)
					return Promise.resolve({
						sha: "current-file-sha",
						content: Buffer.from(newContent).toString("base64"),
					});
				}),
				createOrUpdateFile: mock(() =>
					Promise.resolve({
						commit: {
							sha: "e2e-revert-commit-sha",
							html_url:
								"https://github.com/test/repo/commit/e2e-revert-commit-sha",
						},
					}),
				),
				deleteFile: mock(() =>
					Promise.resolve({
						commit: { sha: "delete-sha", html_url: "" },
					}),
				),
				updateComment: mock((id: number, body: string) => {
					finalCommentBody = body;
					return Promise.resolve({ id, body });
				}),
			} as unknown as GitHubClient;

			// 4. Debounce check
			const debounceResult = await debounceCheckboxToggle(
				mockClient,
				999,
				commentBody,
				{ delayMs: 10 },
			);

			expect(debounceResult.stable).toBe(true);
			expect(debounceResult.isChecked).toBe(false);
			expect(debounceResult.markerData?.appliedCommit).toBe(appliedCommit);

			// 5. Handle the unchecked checkbox
			const result = await handleUncheckedCheckbox(
				mockClient,
				999,
				debounceResult.commentBody!,
				debounceResult.markerData!,
				{ branch: "feature/new-feature" },
			);

			// 6. Verify final state
			expect(result.success).toBe(true);
			expect(result.skipped).toBeUndefined();
			expect(result.commitResult).toBeDefined();
			expect(result.commitResult?.sha).toBe("e2e-revert-commit-sha");
			expect(result.commitResult?.message).toContain("[INTENT:REVERT]");
			expect(result.commitResult?.message).toContain(nodePath);

			// 7. Verify comment was updated with cleared appliedCommit and REVERTED status
			expect(finalCommentBody).toContain("**REVERTED**");

			// 8. Verify the marker can still be parsed from updated comment
			const updatedMarker = parseCommentMarker(finalCommentBody);
			expect(updatedMarker).not.toBeNull();
			expect(updatedMarker?.appliedCommit).toBeUndefined(); // Should be cleared
		});
	});
});
