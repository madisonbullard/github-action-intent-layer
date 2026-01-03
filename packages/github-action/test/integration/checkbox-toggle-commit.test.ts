/**
 * Integration test: checkbox toggle → commit
 *
 * Tests the scenario where a user checks the approval checkbox in an intent layer
 * comment. The checkbox-handler should:
 * 1. Debounce the checkbox state to ensure stability
 * 2. Verify the PR headSha matches the comment marker's headSha
 * 3. Determine if this is an ADD or UPDATE operation
 * 4. Create the appropriate commit
 * 5. Update the comment marker with the appliedCommit SHA
 */

import { describe, expect, mock, test } from "bun:test";
import {
	debounceCheckboxToggle,
	handleCheckedCheckbox,
	reconstructIntentUpdateFromComment,
	validateCheckboxEvent,
} from "../../src/github/checkbox-handler";
import type { GitHubClient } from "../../src/github/client";
import {
	generateComment,
	INTENT_LAYER_MARKER_PREFIX,
	INTENT_LAYER_MARKER_SUFFIX,
	isCheckboxChecked,
	parseCommentMarker,
} from "../../src/github/comments";
import type { IntentUpdate } from "../../src/opencode/output-schema";

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
 * Create a mock GitHubClient with configurable responses.
 */
function createMockClient(options: {
	getCommentBody?: string | null;
	fileExists?: boolean;
	existingFileContent?: string;
	commitSha?: string;
	commitError?: Error;
}): GitHubClient {
	const commitSha = options.commitSha ?? "new-commit-sha-123";

	return {
		getComment: mock((commentId: number) =>
			Promise.resolve({ id: commentId, body: options.getCommentBody ?? "" }),
		),
		getFileContent: mock((path: string, ref?: string) => {
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
		createOrUpdateFile: mock(
			(path: string, content: string, message: string, branch: string) => {
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

describe("Integration: checkbox toggle → commit", () => {
	describe("Full flow: checkbox checked → ADD commit (new file)", () => {
		test("creates ADD commit when checkbox is checked for a new file", async () => {
			const nodePath = "packages/api/AGENTS.md";
			const headSha = "abc123def456";
			const suggestedContent =
				"# API Package\n\nThis package handles API routes.";
			const reason = "New package detected with 5 files added";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				checked: true,
				suggestedContent,
				reason,
				action: "create",
			});

			// Mock client where file does NOT exist (404)
			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: false,
				commitSha: "commit-sha-new-file",
			});

			// Step 1: Debounce check
			const debounceResult = await debounceCheckboxToggle(
				mockClient,
				123,
				commentBody,
				{ delayMs: 10 }, // Short delay for testing
			);

			expect(debounceResult.stable).toBe(true);
			expect(debounceResult.isChecked).toBe(true);
			expect(debounceResult.markerData).toBeDefined();
			expect(debounceResult.markerData?.nodePath).toBe(nodePath);
			expect(debounceResult.markerData?.headSha).toBe(headSha);

			// Step 2: Handle checked checkbox
			const result = await handleCheckedCheckbox(
				mockClient,
				123,
				commentBody,
				debounceResult.markerData!,
				headSha, // Current head matches marker
				{ branch: "feature-branch" },
			);

			expect(result.success).toBe(true);
			expect(result.commitResult).toBeDefined();
			expect(result.commitResult?.sha).toBe("commit-sha-new-file");
			expect(result.commitResult?.message).toContain("[INTENT:ADD]");
			expect(result.commitResult?.message).toContain(nodePath);

			// Verify client methods were called correctly
			expect(mockClient.getFileContent).toHaveBeenCalled();
			expect(mockClient.createOrUpdateFile).toHaveBeenCalled();
			expect(mockClient.updateComment).toHaveBeenCalled();
		});

		test("updates comment marker with appliedCommit after successful ADD", async () => {
			const nodePath = "src/AGENTS.md";
			const headSha = "head123";
			const commitSha = "new-commit-sha-xyz";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				checked: true,
				action: "create",
			});

			let updatedBody = "";
			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: false,
				commitSha,
			});
			(mockClient.updateComment as ReturnType<typeof mock>).mockImplementation(
				(id: number, body: string) => {
					updatedBody = body;
					return Promise.resolve({ id, body });
				},
			);

			const markerData = parseCommentMarker(commentBody)!;

			await handleCheckedCheckbox(
				mockClient,
				123,
				commentBody,
				markerData,
				headSha,
				{
					branch: "main",
				},
			);

			// Verify the comment was updated with the appliedCommit
			expect(updatedBody).toContain(`appliedCommit=${commitSha}`);
			expect(updatedBody).toContain("COMMITTED");
		});
	});

	describe("Full flow: checkbox checked → UPDATE commit (existing file)", () => {
		test("creates UPDATE commit when checkbox is checked for existing file", async () => {
			const nodePath = "packages/core/AGENTS.md";
			const headSha = "xyz789";
			const currentContent = "# Core Package\n\nOld documentation.";
			const suggestedContent =
				"# Core Package\n\nUpdated documentation with new utils.";
			const reason = "5 files modified with 200 lines changed";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				checked: true,
				currentContent,
				suggestedContent,
				reason,
				action: "update",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: true,
				existingFileContent: currentContent,
				commitSha: "commit-sha-update",
			});

			const debounceResult = await debounceCheckboxToggle(
				mockClient,
				456,
				commentBody,
				{ delayMs: 10 },
			);

			expect(debounceResult.stable).toBe(true);
			expect(debounceResult.isChecked).toBe(true);

			const result = await handleCheckedCheckbox(
				mockClient,
				456,
				commentBody,
				debounceResult.markerData!,
				headSha,
				{ branch: "feature/update-docs" },
			);

			expect(result.success).toBe(true);
			expect(result.commitResult).toBeDefined();
			expect(result.commitResult?.sha).toBe("commit-sha-update");
			expect(result.commitResult?.message).toContain("[INTENT:UPDATE]");
			expect(result.commitResult?.message).toContain(nodePath);
		});
	});

	describe("HeadSha mismatch handling", () => {
		test("marks comment as RESOLVED when PR head has changed", async () => {
			const nodePath = "packages/api/AGENTS.md";
			const oldHeadSha = "old-head-sha";
			const currentHeadSha = "new-head-sha";

			const commentBody = createCommentBody({
				nodePath,
				headSha: oldHeadSha,
				checked: true,
				action: "create",
			});

			let updatedBody = "";
			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: false,
			});
			(mockClient.updateComment as ReturnType<typeof mock>).mockImplementation(
				(id: number, body: string) => {
					updatedBody = body;
					return Promise.resolve({ id, body });
				},
			);

			const markerData = parseCommentMarker(commentBody)!;

			const result = await handleCheckedCheckbox(
				mockClient,
				789,
				commentBody,
				markerData,
				currentHeadSha, // Different from marker headSha
				{ branch: "feature-branch" },
			);

			expect(result.success).toBe(false);
			expect(result.markedAsResolved).toBe(true);
			expect(result.error).toContain("PR head has changed");
			expect(result.error).toContain(oldHeadSha);
			expect(result.error).toContain(currentHeadSha);
			expect(updatedBody).toContain("**RESOLVED**");
		});
	});

	describe("Event validation", () => {
		test("validates PR comment event payload correctly", () => {
			const validPayload = {
				comment: {
					id: 123,
					body: "<!-- INTENT_LAYER node=AGENTS.md -->",
				},
				issue: {
					number: 456,
					pull_request: {},
				},
			};

			const result = validateCheckboxEvent(validPayload);

			expect(result).not.toBeNull();
			expect(result?.commentId).toBe(123);
			expect(result?.issueNumber).toBe(456);
			expect(result?.isPullRequest).toBe(true);
		});

		test("rejects event without comment", () => {
			const invalidPayload = {
				issue: { number: 456 },
			};

			const result = validateCheckboxEvent(invalidPayload);
			expect(result).toBeNull();
		});

		test("rejects event without issue", () => {
			const invalidPayload = {
				comment: { id: 123, body: "body" },
			};

			const result = validateCheckboxEvent(invalidPayload);
			expect(result).toBeNull();
		});
	});

	describe("Debounce mechanism", () => {
		test("returns unstable when checkbox state changes during debounce", async () => {
			const initialBody = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc123",
				checked: false, // Initially unchecked
				action: "create",
			});

			const changedBody = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc123",
				checked: true, // Changed to checked
				action: "create",
			});

			const mockClient = createMockClient({
				getCommentBody: changedBody, // Returns changed state after delay
			});

			const result = await debounceCheckboxToggle(
				mockClient,
				123,
				initialBody,
				{
					delayMs: 10,
				},
			);

			expect(result.stable).toBe(false);
			expect(result.reason).toContain("Checkbox state changed");
		});

		test("returns stable when checkbox state remains consistent", async () => {
			const commentBody = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc123",
				checked: true,
				action: "create",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody, // Same state after delay
			});

			const result = await debounceCheckboxToggle(
				mockClient,
				123,
				commentBody,
				{
					delayMs: 10,
				},
			);

			expect(result.stable).toBe(true);
			expect(result.isChecked).toBe(true);
			expect(result.markerData).toBeDefined();
		});
	});

	describe("Content reconstruction from comment", () => {
		test("reconstructs IntentUpdate from create comment", () => {
			const nodePath = "packages/new/AGENTS.md";
			const suggestedContent = "# New Package\n\nThis is new.";
			const reason = "New package detected";

			const commentBody = createCommentBody({
				nodePath,
				headSha: "abc123",
				checked: true,
				suggestedContent,
				reason,
				action: "create",
			});

			const markerData = parseCommentMarker(commentBody)!;
			const update = reconstructIntentUpdateFromComment(
				commentBody,
				markerData,
				"create",
			);

			expect(update.nodePath).toBe(nodePath);
			expect(update.action).toBe("create");
			expect(update.suggestedContent).toContain("# New Package");
			// Reason extraction includes markdown formatting characters in some cases
			expect(update.reason).toContain(reason);
			expect(update.currentContent).toBeUndefined();
		});

		test("reconstructs IntentUpdate from update comment with current content", () => {
			const nodePath = "src/AGENTS.md";
			const currentContent = "# Old Content";
			const suggestedContent = "# New Content";
			const reason = "Documentation needs update";

			const commentBody = createCommentBody({
				nodePath,
				headSha: "def456",
				checked: true,
				currentContent,
				suggestedContent,
				reason,
				action: "update",
			});

			const markerData = parseCommentMarker(commentBody)!;
			const update = reconstructIntentUpdateFromComment(
				commentBody,
				markerData,
				"update",
			);

			expect(update.nodePath).toBe(nodePath);
			expect(update.action).toBe("update");
			expect(update.suggestedContent).toContain("# New Content");
			expect(update.currentContent).toContain("# Old Content");
			// Reason extraction includes markdown formatting characters in some cases
			expect(update.reason).toContain(reason);
		});
	});

	describe("Symlink handling", () => {
		test("passes symlink options to commit creation", async () => {
			const nodePath = "packages/api/AGENTS.md";
			const otherNodePath = "packages/api/CLAUDE.md";
			const headSha = "symlink-test-sha";

			const commentBody = createCommentBody({
				nodePath,
				otherNodePath,
				headSha,
				checked: true,
				action: "create",
			});

			const createOrUpdateCalls: Array<{
				path: string;
				content: string;
				message: string;
				branch: string;
			}> = [];

			const mockClient = {
				getComment: mock(() => Promise.resolve({ id: 123, body: commentBody })),
				getFileContent: mock(() => {
					const error = new Error("Not Found") as Error & { status: number };
					error.status = 404;
					return Promise.reject(error);
				}),
				createOrUpdateFile: mock(
					(path: string, content: string, message: string, branch: string) => {
						createOrUpdateCalls.push({ path, content, message, branch });
						return Promise.resolve({
							commit: {
								sha: "symlink-commit-sha",
								html_url:
									"https://github.com/test/repo/commit/symlink-commit-sha",
							},
						});
					},
				),
				updateComment: mock(() => Promise.resolve({ id: 123, body: "" })),
			} as unknown as GitHubClient;

			const markerData = parseCommentMarker(commentBody)!;

			await handleCheckedCheckbox(
				mockClient,
				123,
				commentBody,
				markerData,
				headSha,
				{
					branch: "main",
					symlink: false, // Non-symlink mode
					symlinkSource: "agents",
				},
			);

			// In non-symlink mode with otherNodePath, files should be created
			expect(createOrUpdateCalls.length).toBeGreaterThanOrEqual(1);
			expect(createOrUpdateCalls[0]?.branch).toBe("main");
		});
	});

	describe("Error handling", () => {
		test("handles commit creation failure gracefully", async () => {
			const nodePath = "AGENTS.md";
			const headSha = "error-test-sha";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				checked: true,
				action: "create",
			});

			const mockClient = createMockClient({
				getCommentBody: commentBody,
				fileExists: false,
				commitError: new Error("Permission denied"),
			});

			const markerData = parseCommentMarker(commentBody)!;

			const result = await handleCheckedCheckbox(
				mockClient,
				123,
				commentBody,
				markerData,
				headSha,
				{ branch: "main" },
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("Failed to create commit");
			expect(result.error).toContain("Permission denied");
		});

		test("handles missing marker gracefully during debounce", async () => {
			const bodyWithoutMarker = "Regular comment without marker - [x] Checkbox";

			const mockClient = createMockClient({
				getCommentBody: bodyWithoutMarker,
			});

			const result = await debounceCheckboxToggle(
				mockClient,
				123,
				bodyWithoutMarker,
				{ delayMs: 10 },
			);

			expect(result.stable).toBe(false);
			expect(result.reason).toContain(
				"does not contain a valid intent layer marker",
			);
		});
	});

	describe("Comment formatting verification", () => {
		test("generateComment creates valid comment structure", () => {
			const update: IntentUpdate = {
				nodePath: "packages/api/AGENTS.md",
				action: "create",
				reason: "New API package detected",
				suggestedContent: "# API Package\n\nHandles REST endpoints.",
			};

			const headSha = "format-test-sha";
			const comment = generateComment(update, headSha);

			// Verify marker is present
			expect(comment).toContain(INTENT_LAYER_MARKER_PREFIX);
			expect(comment).toContain(INTENT_LAYER_MARKER_SUFFIX);
			expect(comment).toContain(`headSha=${headSha}`);
			expect(comment).toContain(`node=${encodeURIComponent(update.nodePath)}`);

			// Verify checkbox is present and unchecked by default
			expect(comment).toContain("- [ ] Apply this change");

			// Verify diff content is present (the actual format uses diff view)
			expect(comment).toContain("View diff");
			expect(comment).toContain("API Package");

			// Verify marker can be parsed
			const markerData = parseCommentMarker(comment);
			expect(markerData).not.toBeNull();
			expect(markerData?.nodePath).toBe(update.nodePath);
			expect(markerData?.headSha).toBe(headSha);
		});

		test("isCheckboxChecked correctly detects checkbox state", () => {
			const uncheckedComment = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc",
				checked: false,
				action: "create",
			});

			const checkedComment = createCommentBody({
				nodePath: "AGENTS.md",
				headSha: "abc",
				checked: true,
				action: "create",
			});

			expect(isCheckboxChecked(uncheckedComment)).toBe(false);
			expect(isCheckboxChecked(checkedComment)).toBe(true);
		});
	});

	describe("End-to-end scenario", () => {
		test("complete checkbox toggle flow from event to commit", async () => {
			// Simulate the complete flow that would occur in the GitHub Action

			// 1. Event payload from GitHub
			const nodePath = "packages/feature/AGENTS.md";
			const headSha = "e2e-test-sha-abc123";
			const suggestedContent =
				"# Feature Package\n\n## Overview\n\nThis package provides new features.";

			const commentBody = createCommentBody({
				nodePath,
				headSha,
				checked: true,
				suggestedContent,
				reason: "10 new files added to packages/feature",
				action: "create",
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

			// 2. Validate the event
			const eventContext = validateCheckboxEvent(eventPayload);
			expect(eventContext).not.toBeNull();
			expect(eventContext?.commentId).toBe(999);
			expect(eventContext?.issueNumber).toBe(42);
			expect(eventContext?.isPullRequest).toBe(true);

			// 3. Setup mock client
			let finalCommentBody = "";
			const mockClient = {
				getComment: mock(() => Promise.resolve({ id: 999, body: commentBody })),
				getFileContent: mock(() => {
					const error = new Error("Not Found") as Error & { status: number };
					error.status = 404;
					return Promise.reject(error);
				}),
				createOrUpdateFile: mock(() =>
					Promise.resolve({
						commit: {
							sha: "e2e-commit-sha-final",
							html_url:
								"https://github.com/test/repo/commit/e2e-commit-sha-final",
						},
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
				eventContext!.commentId,
				eventContext!.commentBody,
				{ delayMs: 10 },
			);

			expect(debounceResult.stable).toBe(true);
			expect(debounceResult.isChecked).toBe(true);

			// 5. Handle the checked checkbox
			const result = await handleCheckedCheckbox(
				mockClient,
				eventContext!.commentId,
				debounceResult.commentBody!,
				debounceResult.markerData!,
				headSha,
				{ branch: "feature/new-feature" },
			);

			// 6. Verify final state
			expect(result.success).toBe(true);
			expect(result.commitResult).toBeDefined();
			expect(result.commitResult?.sha).toBe("e2e-commit-sha-final");
			expect(result.commitResult?.message).toContain("[INTENT:ADD]");
			expect(result.commitResult?.message).toContain(nodePath);

			// 7. Verify comment was updated with appliedCommit
			expect(finalCommentBody).toContain("appliedCommit=e2e-commit-sha-final");
			expect(finalCommentBody).toContain("COMMITTED");

			// 8. Verify the marker can still be parsed from updated comment
			const updatedMarker = parseCommentMarker(finalCommentBody);
			expect(updatedMarker).not.toBeNull();
			expect(updatedMarker?.appliedCommit).toBe("e2e-commit-sha-final");
		});
	});
});
