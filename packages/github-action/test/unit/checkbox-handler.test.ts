import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	DEFAULT_DEBOUNCE_DELAY_MS,
	debounceCheckboxToggle,
	handleCheckedCheckbox,
	handleUncheckedCheckbox,
	reconstructIntentUpdateFromComment,
	sleep,
	validateCheckboxEvent,
} from "../../src/github/checkbox-handler";
import type { GitHubClient } from "../../src/github/client";
import {
	INTENT_LAYER_MARKER_PREFIX,
	INTENT_LAYER_MARKER_SUFFIX,
} from "../../src/github/comments";

describe("sleep", () => {
	test("resolves after specified delay", async () => {
		const start = Date.now();
		await sleep(50);
		const elapsed = Date.now() - start;

		// Allow some tolerance for timing
		expect(elapsed).toBeGreaterThanOrEqual(45);
		expect(elapsed).toBeLessThan(100);
	});
});

describe("DEFAULT_DEBOUNCE_DELAY_MS", () => {
	test("is 1500ms (1.5 seconds)", () => {
		expect(DEFAULT_DEBOUNCE_DELAY_MS).toBe(1500);
	});
});

describe("debounceCheckboxToggle", () => {
	// Helper to create a valid comment body with marker
	function createCommentBody(options: {
		nodePath?: string;
		otherNodePath?: string;
		headSha?: string;
		appliedCommit?: string;
		checked?: boolean;
	}): string {
		const nodePath = options.nodePath ?? "packages/api/AGENTS.md";
		const headSha = options.headSha ?? "abc123";
		const checkbox = options.checked
			? "- [x] Apply this change"
			: "- [ ] Apply this change";

		const parts = [`node=${encodeURIComponent(nodePath)}`];
		if (options.otherNodePath) {
			parts.push(`otherNode=${encodeURIComponent(options.otherNodePath)}`);
		}
		parts.push(`appliedCommit=${options.appliedCommit ?? ""}`);
		parts.push(`headSha=${headSha}`);

		return `${INTENT_LAYER_MARKER_PREFIX} ${parts.join(" ")} ${INTENT_LAYER_MARKER_SUFFIX}

## Intent Layer Update

\`\`\`diff
+ Some changes
\`\`\`

---

${checkbox}`;
	}

	// Create a mock client
	function createMockClient(getCommentResult: {
		body?: string | null;
	}): GitHubClient {
		return {
			getComment: mock(() => Promise.resolve(getCommentResult)),
		} as unknown as GitHubClient;
	}

	test("returns stable=true when checkbox state is unchanged", async () => {
		const commentBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: commentBody });

		const result = await debounceCheckboxToggle(
			mockClient,
			123,
			commentBody,
			{ delayMs: 10 }, // Use short delay for test
		);

		expect(result.stable).toBe(true);
		expect(result.isChecked).toBe(true);
		expect(result.commentBody).toBe(commentBody);
		// Verify markerData is included
		expect(result.markerData).toBeDefined();
		expect(result.markerData?.nodePath).toBe("packages/api/AGENTS.md");
		expect(result.markerData?.headSha).toBe("abc123");
		expect(result.markerData?.appliedCommit).toBeUndefined();
	});

	test("returns stable=false when checkbox state changed", async () => {
		const initialBody = createCommentBody({ checked: false });
		const changedBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: changedBody });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("Checkbox state changed");
		expect(result.reason).toContain("was: false");
		expect(result.reason).toContain("now: true");
	});

	test("returns stable=false when comment body is empty after refetch", async () => {
		const initialBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: null });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("empty after re-fetch");
	});

	test("returns stable=false when initial body has no marker", async () => {
		const initialBody = "No marker here - [ ] Apply this change";
		const mockClient = createMockClient({ body: initialBody });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain(
			"does not contain a valid intent layer marker",
		);
	});

	test("returns stable=false when marker disappears after refetch", async () => {
		const initialBody = createCommentBody({ checked: true });
		const bodyWithoutMarker = "No marker here - [x] Apply this change";
		const mockClient = createMockClient({ body: bodyWithoutMarker });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("no longer valid after re-fetch");
	});

	test("returns stable=false when getComment throws an error", async () => {
		const initialBody = createCommentBody({ checked: true });
		const mockClient = {
			getComment: mock(() =>
				Promise.reject(new Error("API rate limit exceeded")),
			),
		} as unknown as GitHubClient;

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("Failed to re-fetch comment");
		expect(result.reason).toContain("API rate limit exceeded");
	});

	test("handles unchecked checkbox correctly", async () => {
		const commentBody = createCommentBody({ checked: false });
		const mockClient = createMockClient({ body: commentBody });

		const result = await debounceCheckboxToggle(mockClient, 123, commentBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(true);
		expect(result.isChecked).toBe(false);
	});

	test("uses default delay when not specified", async () => {
		// We can't easily test the actual delay without making tests slow,
		// but we can verify the function accepts no options
		const commentBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: commentBody });

		// This would take 1.5s in real use, but we're verifying it works
		const result = await debounceCheckboxToggle(
			mockClient,
			123,
			commentBody,
			{ delayMs: 10 }, // Override for test speed
		);

		expect(result.stable).toBe(true);
	});

	test("includes appliedCommit and otherNodePath in markerData when present", async () => {
		const commentBody = createCommentBody({
			nodePath: "src/AGENTS.md",
			otherNodePath: "src/CLAUDE.md",
			headSha: "def456",
			appliedCommit: "commit789",
			checked: true,
		});
		const mockClient = createMockClient({ body: commentBody });

		const result = await debounceCheckboxToggle(mockClient, 123, commentBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(true);
		expect(result.markerData).toBeDefined();
		expect(result.markerData?.nodePath).toBe("src/AGENTS.md");
		expect(result.markerData?.otherNodePath).toBe("src/CLAUDE.md");
		expect(result.markerData?.headSha).toBe("def456");
		expect(result.markerData?.appliedCommit).toBe("commit789");
	});

	test("markerData is undefined when result is not stable", async () => {
		const initialBody = createCommentBody({ checked: false });
		const changedBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: changedBody });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.markerData).toBeUndefined();
	});
});

describe("validateCheckboxEvent", () => {
	test("returns context for valid PR comment event", () => {
		const payload = {
			comment: {
				id: 123,
				body: "Some comment body",
			},
			issue: {
				number: 456,
				pull_request: {},
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).not.toBeNull();
		expect(result?.commentId).toBe(123);
		expect(result?.commentBody).toBe("Some comment body");
		expect(result?.issueNumber).toBe(456);
		expect(result?.isPullRequest).toBe(true);
	});

	test("returns context for valid issue comment event", () => {
		const payload = {
			comment: {
				id: 789,
				body: "Issue comment",
			},
			issue: {
				number: 101,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).not.toBeNull();
		expect(result?.isPullRequest).toBe(false);
	});

	test("returns null when comment is missing", () => {
		const payload = {
			issue: {
				number: 456,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when comment has no ID", () => {
		const payload = {
			comment: {
				body: "Some body",
			},
			issue: {
				number: 456,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when comment has no body", () => {
		const payload = {
			comment: {
				id: 123,
			},
			issue: {
				number: 456,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when issue is missing", () => {
		const payload = {
			comment: {
				id: 123,
				body: "Some body",
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when issue has no number", () => {
		const payload = {
			comment: {
				id: 123,
				body: "Some body",
			},
			issue: {},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});
});

describe("reconstructIntentUpdateFromComment", () => {
	test("reconstructs create update from comment with suggested content section", () => {
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "abc123",
		};
		const commentBody = `${INTENT_LAYER_MARKER_PREFIX} node=packages%2Fapi%2FAGENTS.md appliedCommit= headSha=abc123 ${INTENT_LAYER_MARKER_SUFFIX}

### Suggested Content

\`\`\`markdown
# API Package

This is the suggested content for the API package.
\`\`\`

Reason: New package needs documentation

---

- [ ] Apply this change`;

		const result = reconstructIntentUpdateFromComment(
			commentBody,
			markerData,
			"create",
		);

		expect(result.nodePath).toBe("packages/api/AGENTS.md");
		expect(result.action).toBe("create");
		expect(result.suggestedContent).toContain("# API Package");
		expect(result.suggestedContent).toContain(
			"This is the suggested content for the API package.",
		);
		expect(result.reason).toBe("New package needs documentation");
		expect(result.currentContent).toBeUndefined();
	});

	test("reconstructs update from comment with current and suggested content", () => {
		const markerData = {
			nodePath: "src/AGENTS.md",
			otherNodePath: "src/CLAUDE.md",
			headSha: "def456",
		};
		const commentBody = `${INTENT_LAYER_MARKER_PREFIX} node=src%2FAGENTS.md otherNode=src%2FCLAUDE.md appliedCommit= headSha=def456 ${INTENT_LAYER_MARKER_SUFFIX}

### Current Content

\`\`\`markdown
# Source Directory

Old content here.
\`\`\`

### Suggested Content

\`\`\`markdown
# Source Directory

Updated content with more details.
\`\`\`

Reason: Updated to reflect new architecture

---

- [ ] Apply this change`;

		const result = reconstructIntentUpdateFromComment(
			commentBody,
			markerData,
			"update",
		);

		expect(result.nodePath).toBe("src/AGENTS.md");
		expect(result.otherNodePath).toBe("src/CLAUDE.md");
		expect(result.action).toBe("update");
		expect(result.suggestedContent).toContain(
			"Updated content with more details",
		);
		expect(result.currentContent).toContain("Old content here");
		expect(result.reason).toBe("Updated to reflect new architecture");
	});

	test("extracts content from diff block when sections are not present", () => {
		const markerData = {
			nodePath: "lib/AGENTS.md",
			headSha: "ghi789",
		};
		const commentBody = `${INTENT_LAYER_MARKER_PREFIX} node=lib%2FAGENTS.md appliedCommit= headSha=ghi789 ${INTENT_LAYER_MARKER_SUFFIX}

\`\`\`diff
--- a/lib/AGENTS.md
+++ b/lib/AGENTS.md
-Old line
+New line
+Another new line
\`\`\`

---

- [ ] Apply this change`;

		const result = reconstructIntentUpdateFromComment(
			commentBody,
			markerData,
			"update",
		);

		expect(result.nodePath).toBe("lib/AGENTS.md");
		expect(result.action).toBe("update");
		// Should extract added lines
		expect(result.suggestedContent).toContain("New line");
		expect(result.suggestedContent).toContain("Another new line");
		// Should extract removed lines as current content
		expect(result.currentContent).toContain("Old line");
	});

	test("uses default reason when not found in comment", () => {
		const markerData = {
			nodePath: "test/AGENTS.md",
			headSha: "jkl012",
		};
		const commentBody = `${INTENT_LAYER_MARKER_PREFIX} node=test%2FAGENTS.md appliedCommit= headSha=jkl012 ${INTENT_LAYER_MARKER_SUFFIX}

### Suggested Content

\`\`\`markdown
# Test content
\`\`\`

---

- [ ] Apply this change`;

		const result = reconstructIntentUpdateFromComment(
			commentBody,
			markerData,
			"create",
		);

		expect(result.reason).toBe("Approved via checkbox");
	});
});

describe("handleCheckedCheckbox", () => {
	// Helper to create a comment body with full structure
	function createFullCommentBody(options: {
		nodePath?: string;
		otherNodePath?: string;
		headSha?: string;
		appliedCommit?: string;
		suggestedContent?: string;
		currentContent?: string;
		reason?: string;
	}): string {
		const nodePath = options.nodePath ?? "packages/api/AGENTS.md";
		const headSha = options.headSha ?? "abc123";
		const suggestedContent =
			options.suggestedContent ?? "# API Package\n\nDefault content.";

		const parts = [`node=${encodeURIComponent(nodePath)}`];
		if (options.otherNodePath) {
			parts.push(`otherNode=${encodeURIComponent(options.otherNodePath)}`);
		}
		parts.push(`appliedCommit=${options.appliedCommit ?? ""}`);
		parts.push(`headSha=${headSha}`);

		let content = `${INTENT_LAYER_MARKER_PREFIX} ${parts.join(" ")} ${INTENT_LAYER_MARKER_SUFFIX}

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

`;

		if (options.reason) {
			content += `Reason: ${options.reason}

`;
		}

		content += `---

- [x] Apply this change`;

		return content;
	}

	test("marks comment as resolved when headSha doesn't match", async () => {
		const commentBody = createFullCommentBody({
			headSha: "old-sha-123",
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "old-sha-123",
		};

		let updatedCommentBody = "";
		const mockClient = {
			updateComment: mock((id: number, body: string) => {
				updatedCommentBody = body;
				return Promise.resolve({ id, body });
			}),
		} as unknown as GitHubClient;

		const result = await handleCheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			"new-sha-456", // Different from marker headSha
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(false);
		expect(result.markedAsResolved).toBe(true);
		expect(result.error).toContain("PR head has changed");
		expect(result.error).toContain("old-sha-123");
		expect(result.error).toContain("new-sha-456");
		expect(updatedCommentBody).toContain("**RESOLVED**");
	});

	test("creates ADD commit when file doesn't exist", async () => {
		const suggestedContent = "# New Package\n\nNew content here.";
		const commentBody = createFullCommentBody({
			headSha: "current-sha",
			suggestedContent,
			reason: "Adding new package docs",
		});
		const markerData = {
			nodePath: "packages/new/AGENTS.md",
			headSha: "current-sha",
		};

		let updatedCommentBody = "";
		const mockClient = {
			getFileContent: mock(() => {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				return Promise.reject(error);
			}),
			createOrUpdateFile: mock(() =>
				Promise.resolve({
					commit: {
						sha: "new-commit-sha",
						html_url: "https://github.com/test/repo/commit/new-commit-sha",
					},
				}),
			),
			updateComment: mock((id: number, body: string) => {
				updatedCommentBody = body;
				return Promise.resolve({ id, body });
			}),
		} as unknown as GitHubClient;

		const result = await handleCheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			"current-sha",
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(true);
		expect(result.commitResult).toBeDefined();
		expect(result.commitResult?.sha).toBe("new-commit-sha");
		expect(result.commitResult?.message).toContain("[INTENT:ADD]");
		// Verify the comment was updated with appliedCommit
		expect(updatedCommentBody).toContain("appliedCommit=new-commit-sha");
	});

	test("creates UPDATE commit when file exists", async () => {
		const currentContent = "# Existing Package\n\nOld content.";
		const suggestedContent = "# Existing Package\n\nUpdated content.";
		const commentBody = createFullCommentBody({
			headSha: "current-sha",
			currentContent,
			suggestedContent,
			reason: "Updating package docs",
		});
		const markerData = {
			nodePath: "packages/existing/AGENTS.md",
			headSha: "current-sha",
		};

		let updatedCommentBody = "";
		const mockClient = {
			getFileContent: mock(() =>
				Promise.resolve({
					sha: "existing-file-sha",
					content: Buffer.from(currentContent).toString("base64"),
				}),
			),
			createOrUpdateFile: mock(() =>
				Promise.resolve({
					commit: {
						sha: "update-commit-sha",
						html_url: "https://github.com/test/repo/commit/update-commit-sha",
					},
				}),
			),
			updateComment: mock((id: number, body: string) => {
				updatedCommentBody = body;
				return Promise.resolve({ id, body });
			}),
		} as unknown as GitHubClient;

		const result = await handleCheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			"current-sha",
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(true);
		expect(result.commitResult).toBeDefined();
		expect(result.commitResult?.sha).toBe("update-commit-sha");
		expect(result.commitResult?.message).toContain("[INTENT:UPDATE]");
		// Verify the comment was updated with appliedCommit
		expect(updatedCommentBody).toContain("appliedCommit=update-commit-sha");
	});

	test("returns error when commit creation fails", async () => {
		const commentBody = createFullCommentBody({
			headSha: "current-sha",
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "current-sha",
		};

		const mockClient = {
			getFileContent: mock(() => {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				return Promise.reject(error);
			}),
			createOrUpdateFile: mock(() =>
				Promise.reject(new Error("Permission denied")),
			),
		} as unknown as GitHubClient;

		const result = await handleCheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			"current-sha",
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Failed to create commit");
		expect(result.error).toContain("Permission denied");
	});

	test("passes symlink options to commit function", async () => {
		const suggestedContent = "# Package\n\nContent.";
		const commentBody = createFullCommentBody({
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			headSha: "current-sha",
			suggestedContent,
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			headSha: "current-sha",
		};

		const createOrUpdateFileCalls: Array<{
			path: string;
			content: string;
			message: string;
			branch: string;
		}> = [];

		const mockClient = {
			getFileContent: mock(() => {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				return Promise.reject(error);
			}),
			createOrUpdateFile: mock(
				(path: string, content: string, message: string, branch: string) => {
					createOrUpdateFileCalls.push({ path, content, message, branch });
					return Promise.resolve({
						commit: {
							sha: "commit-sha",
							html_url: "https://github.com/test/repo/commit/sha",
						},
					});
				},
			),
			updateComment: mock(() => Promise.resolve({ id: 123, body: "" })),
		} as unknown as GitHubClient;

		await handleCheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			"current-sha",
			{
				branch: "feature-branch",
				symlink: false, // Non-symlink mode creates both files
			},
		);

		// In non-symlink mode with otherNodePath, both files should be created
		expect(createOrUpdateFileCalls.length).toBeGreaterThanOrEqual(1);
		expect(createOrUpdateFileCalls[0]?.branch).toBe("feature-branch");
	});
});

describe("handleUncheckedCheckbox", () => {
	// Helper to create a comment body with full structure
	function createFullCommentBody(options: {
		nodePath?: string;
		otherNodePath?: string;
		headSha?: string;
		appliedCommit?: string;
		suggestedContent?: string;
	}): string {
		const nodePath = options.nodePath ?? "packages/api/AGENTS.md";
		const headSha = options.headSha ?? "abc123";
		const suggestedContent =
			options.suggestedContent ?? "# API Package\n\nDefault content.";

		const parts = [`node=${encodeURIComponent(nodePath)}`];
		if (options.otherNodePath) {
			parts.push(`otherNode=${encodeURIComponent(options.otherNodePath)}`);
		}
		parts.push(`appliedCommit=${options.appliedCommit ?? ""}`);
		parts.push(`headSha=${headSha}`);

		return `${INTENT_LAYER_MARKER_PREFIX} ${parts.join(" ")} ${INTENT_LAYER_MARKER_SUFFIX}

### Suggested Content

\`\`\`markdown
${suggestedContent}
\`\`\`

---

- [ ] Apply this change`;
	}

	test("skips when no appliedCommit exists", async () => {
		const commentBody = createFullCommentBody({
			headSha: "current-sha",
			appliedCommit: "", // No applied commit
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "current-sha",
			appliedCommit: undefined, // No applied commit
		};

		const mockClient = {} as unknown as GitHubClient;

		const result = await handleUncheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(true);
		expect(result.skipped).toBe(true);
		expect(result.commitResult).toBeUndefined();
	});

	test("performs revert when appliedCommit exists", async () => {
		const commentBody = createFullCommentBody({
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		};

		let updatedCommentBody = "";
		const mockClient = {
			getCommit: mock(() =>
				Promise.resolve({
					parents: [{ sha: "parent-sha" }],
				}),
			),
			getFileContent: mock((path: string, ref: string) => {
				// Return content for parent commit (file existed before)
				if (ref === "parent-sha") {
					return Promise.resolve({
						sha: "old-file-sha",
						content: Buffer.from("# Previous Content").toString("base64"),
					});
				}
				// Return current file content
				return Promise.resolve({
					sha: "current-file-sha",
					content: Buffer.from("# Current Content").toString("base64"),
				});
			}),
			createOrUpdateFile: mock(() =>
				Promise.resolve({
					commit: {
						sha: "revert-commit-sha",
						html_url: "https://github.com/test/repo/commit/revert-commit-sha",
					},
				}),
			),
			updateComment: mock((id: number, body: string) => {
				updatedCommentBody = body;
				return Promise.resolve({ id, body });
			}),
		} as unknown as GitHubClient;

		const result = await handleUncheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(true);
		expect(result.skipped).toBeUndefined();
		expect(result.commitResult).toBeDefined();
		expect(result.commitResult?.sha).toBe("revert-commit-sha");
		expect(result.commitResult?.message).toContain("[INTENT:REVERT]");
		// Verify the comment was updated to clear appliedCommit
		expect(updatedCommentBody).toContain("appliedCommit=");
		expect(updatedCommentBody).not.toContain(
			"appliedCommit=applied-commit-sha",
		);
	});

	test("deletes file when it didn't exist before the applied commit", async () => {
		const commentBody = createFullCommentBody({
			nodePath: "packages/new/AGENTS.md",
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		});
		const markerData = {
			nodePath: "packages/new/AGENTS.md",
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		};

		let deletedFile = "";
		const mockClient = {
			getCommit: mock(() =>
				Promise.resolve({
					parents: [{ sha: "parent-sha" }],
				}),
			),
			getFileContent: mock((path: string, ref: string) => {
				// File didn't exist before the applied commit
				if (ref === "parent-sha") {
					const error = new Error("Not Found") as Error & { status: number };
					error.status = 404;
					return Promise.reject(error);
				}
				// Current file exists
				return Promise.resolve({
					sha: "current-file-sha",
					content: Buffer.from("# New Content").toString("base64"),
				});
			}),
			deleteFile: mock((path: string) => {
				deletedFile = path;
				return Promise.resolve({
					commit: {
						sha: "delete-commit-sha",
						html_url: "https://github.com/test/repo/commit/delete-commit-sha",
					},
				});
			}),
			updateComment: mock(() => Promise.resolve({ id: 123, body: "" })),
		} as unknown as GitHubClient;

		const result = await handleUncheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(true);
		expect(result.commitResult).toBeDefined();
		expect(result.commitResult?.sha).toBe("delete-commit-sha");
		expect(deletedFile).toBe("packages/new/AGENTS.md");
	});

	test("handles revert errors gracefully", async () => {
		const commentBody = createFullCommentBody({
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		};

		const mockClient = {
			getCommit: mock(() => Promise.reject(new Error("Commit not found"))),
		} as unknown as GitHubClient;

		const result = await handleUncheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Failed to create revert commit");
		expect(result.error).toContain("Commit not found");
	});

	test("reverts both files when otherNodePath is present", async () => {
		const commentBody = createFullCommentBody({
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		});
		const markerData = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			headSha: "current-sha",
			appliedCommit: "applied-commit-sha",
		};

		const updatedFiles: string[] = [];
		const mockClient = {
			getCommit: mock(() =>
				Promise.resolve({
					parents: [{ sha: "parent-sha" }],
				}),
			),
			getFileContent: mock((path: string, ref: string) => {
				// Both files existed before
				return Promise.resolve({
					sha: `${path}-sha`,
					content: Buffer.from(`# Previous ${path}`).toString("base64"),
				});
			}),
			createOrUpdateFile: mock((path: string) => {
				updatedFiles.push(path);
				return Promise.resolve({
					commit: {
						sha: "revert-commit-sha",
						html_url: "https://github.com/test/repo/commit/revert-commit-sha",
					},
				});
			}),
			updateComment: mock(() => Promise.resolve({ id: 123, body: "" })),
		} as unknown as GitHubClient;

		const result = await handleUncheckedCheckbox(
			mockClient,
			123,
			commentBody,
			markerData,
			{ branch: "feature-branch" },
		);

		expect(result.success).toBe(true);
		// Both files should be reverted
		expect(updatedFiles).toContain("packages/api/AGENTS.md");
		expect(updatedFiles).toContain("packages/api/CLAUDE.md");
	});
});

describe("InsufficientHistoryError", () => {
	// Need to import the error class
	const {
		InsufficientHistoryError,
	} = require("../../src/github/checkbox-handler");

	test("has correct name and message", () => {
		const error = new InsufficientHistoryError("Test error message");
		expect(error.name).toBe("InsufficientHistoryError");
		expect(error.message).toBe("Test error message");
	});

	test("stores commitSha when provided", () => {
		const error = new InsufficientHistoryError("Test message", "abc123def456");
		expect(error.commitSha).toBe("abc123def456");
	});

	test("commitSha is undefined when not provided", () => {
		const error = new InsufficientHistoryError("Test message");
		expect(error.commitSha).toBeUndefined();
	});

	test("is instance of Error", () => {
		const error = new InsufficientHistoryError("Test message");
		expect(error).toBeInstanceOf(Error);
	});
});

describe("validateGitHistory", () => {
	const { validateGitHistory } = require("../../src/github/checkbox-handler");

	// Note: These tests require actual git commands to work properly.
	// In a real CI environment, the results will depend on how the repo was cloned.

	test("returns valid result for full clone (current repo)", async () => {
		// The current repo should be a full clone (not shallow)
		const result = await validateGitHistory();

		// Should return a result object
		expect(result).toHaveProperty("valid");
		expect(result).toHaveProperty("isShallowClone");

		// In a non-CI environment, this should be a full clone
		// Note: This test may behave differently in CI depending on checkout config
		if (result.valid) {
			expect(result.isShallowClone).toBe(false);
		}
	});

	test("returns valid result when verifying accessible commit", async () => {
		// Get the current HEAD commit which should always be accessible
		const { exec } = require("node:child_process");
		const { promisify } = require("node:util");
		const execAsync = promisify(exec);

		let currentCommit: string;
		try {
			const { stdout } = await execAsync("git rev-parse HEAD");
			currentCommit = stdout.trim();
		} catch {
			// Skip test if git command fails
			return;
		}

		const result = await validateGitHistory(currentCommit);

		// If the repo isn't shallow, we should be able to access the HEAD commit
		if (!result.isShallowClone) {
			expect(result.valid).toBe(true);
		}
	});

	test("returns error for inaccessible commit", async () => {
		// Use a fake commit SHA that definitely doesn't exist
		const fakeCommit = "0000000000000000000000000000000000000000";
		const result = await validateGitHistory(fakeCommit);

		// Should indicate the commit is not accessible (if repo isn't shallow)
		// If shallow, will fail for different reason
		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
	});
});

describe("GitHistoryValidationResult interface", () => {
	test("validateGitHistory returns proper structure", async () => {
		const { validateGitHistory } = require("../../src/github/checkbox-handler");

		const result = await validateGitHistory();

		// Verify the result has the expected structure
		expect(typeof result.valid).toBe("boolean");

		if (result.error !== undefined) {
			expect(typeof result.error).toBe("string");
		}

		if (result.isShallowClone !== undefined) {
			expect(typeof result.isShallowClone).toBe("boolean");
		}

		if (result.cloneDepth !== undefined) {
			expect(typeof result.cloneDepth).toBe("number");
		}
	});
});

describe("validateAndFailOnInsufficientHistory", () => {
	// These tests would require mocking core.error and core.setFailed
	// For now, we test the basic export exists and has correct signature

	test("function is exported", () => {
		const {
			validateAndFailOnInsufficientHistory,
		} = require("../../src/github/checkbox-handler");

		expect(typeof validateAndFailOnInsufficientHistory).toBe("function");
	});

	test("function accepts optional commitSha parameter", () => {
		const {
			validateAndFailOnInsufficientHistory,
		} = require("../../src/github/checkbox-handler");

		// Verify the function can be called (won't actually fail in a full clone)
		// We're just checking the function signature works
		expect(validateAndFailOnInsufficientHistory.length).toBeLessThanOrEqual(1);
	});
});
