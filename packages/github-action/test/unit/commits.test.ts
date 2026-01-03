import { describe, expect, mock, test } from "bun:test";
import type { GitHubClient } from "../../src/github/client";
import {
	createIntentAddCommit,
	createIntentLayerBranch,
	createIntentRevertCommit,
	createIntentUpdateCommit,
	generateAddCommitMessage,
	generateIntentLayerBranchName,
	generateRevertCommitMessage,
	generateUpdateCommitMessage,
	getCommitPrefix,
	getFileSha,
	isIntentCommit,
	parseIntentCommitMessage,
	type RevertCommitOptions,
} from "../../src/github/commits";
import type { IntentUpdate } from "../../src/opencode/output-schema";

describe("generateAddCommitMessage", () => {
	test("generates commit message with path and reason", () => {
		const message = generateAddCommitMessage(
			"packages/api/AGENTS.md",
			"New API package documentation",
		);

		expect(message).toBe(
			"[INTENT:ADD] packages/api/AGENTS.md - New API package documentation",
		);
	});

	test("truncates long reasons", () => {
		const longReason = "A".repeat(150);
		const message = generateAddCommitMessage("AGENTS.md", longReason);

		expect(message.length).toBeLessThan(200);
		expect(message).toContain("...");
		expect(message).toMatch(/^\[INTENT:ADD\] AGENTS\.md - A+\.\.\.$/);
	});

	test("handles root path", () => {
		const message = generateAddCommitMessage("AGENTS.md", "Initialize root");

		expect(message).toBe("[INTENT:ADD] AGENTS.md - Initialize root");
	});
});

describe("generateUpdateCommitMessage", () => {
	test("generates commit message with path and reason", () => {
		const message = generateUpdateCommitMessage(
			"packages/api/AGENTS.md",
			"Updated for new endpoints",
		);

		expect(message).toBe(
			"[INTENT:UPDATE] packages/api/AGENTS.md - Updated for new endpoints",
		);
	});

	test("truncates long reasons", () => {
		const longReason = "B".repeat(150);
		const message = generateUpdateCommitMessage("AGENTS.md", longReason);

		expect(message.length).toBeLessThan(200);
		expect(message).toContain("...");
	});
});

describe("generateRevertCommitMessage", () => {
	test("generates commit message with default reason", () => {
		const message = generateRevertCommitMessage("packages/api/AGENTS.md");

		expect(message).toBe(
			"[INTENT:REVERT] packages/api/AGENTS.md - Reverted via checkbox",
		);
	});

	test("generates commit message with custom reason", () => {
		const message = generateRevertCommitMessage(
			"packages/api/AGENTS.md",
			"User requested revert",
		);

		expect(message).toBe(
			"[INTENT:REVERT] packages/api/AGENTS.md - User requested revert",
		);
	});

	test("truncates long reasons", () => {
		const longReason = "C".repeat(150);
		const message = generateRevertCommitMessage("AGENTS.md", longReason);

		expect(message.length).toBeLessThan(200);
		expect(message).toContain("...");
	});
});

describe("getCommitPrefix", () => {
	test("returns ADD for create action", () => {
		expect(getCommitPrefix("create")).toBe("[INTENT:ADD]");
	});

	test("returns UPDATE for update action", () => {
		expect(getCommitPrefix("update")).toBe("[INTENT:UPDATE]");
	});

	test("returns REVERT for delete action", () => {
		expect(getCommitPrefix("delete")).toBe("[INTENT:REVERT]");
	});
});

describe("parseIntentCommitMessage", () => {
	test("parses ADD commit message", () => {
		const result = parseIntentCommitMessage(
			"[INTENT:ADD] packages/api/AGENTS.md - New documentation",
		);

		expect(result).not.toBeNull();
		expect(result?.type).toBe("ADD");
		expect(result?.nodePath).toBe("packages/api/AGENTS.md");
		expect(result?.reason).toBe("New documentation");
	});

	test("parses UPDATE commit message", () => {
		const result = parseIntentCommitMessage(
			"[INTENT:UPDATE] AGENTS.md - Updated for changes",
		);

		expect(result).not.toBeNull();
		expect(result?.type).toBe("UPDATE");
		expect(result?.nodePath).toBe("AGENTS.md");
		expect(result?.reason).toBe("Updated for changes");
	});

	test("parses REVERT commit message", () => {
		const result = parseIntentCommitMessage(
			"[INTENT:REVERT] packages/core/AGENTS.md - Reverted via checkbox",
		);

		expect(result).not.toBeNull();
		expect(result?.type).toBe("REVERT");
		expect(result?.nodePath).toBe("packages/core/AGENTS.md");
		expect(result?.reason).toBe("Reverted via checkbox");
	});

	test("returns null for non-intent commit", () => {
		const result = parseIntentCommitMessage("feat: add new feature");

		expect(result).toBeNull();
	});

	test("returns null for malformed intent commit", () => {
		const result = parseIntentCommitMessage("[INTENT:ADD] packages/api");

		expect(result).toBeNull();
	});

	test("handles path with spaces in reason", () => {
		const result = parseIntentCommitMessage(
			"[INTENT:ADD] AGENTS.md - This is a longer reason with spaces",
		);

		expect(result?.reason).toBe("This is a longer reason with spaces");
	});
});

describe("isIntentCommit", () => {
	test("returns true for ADD commit", () => {
		expect(isIntentCommit("[INTENT:ADD] AGENTS.md - Create intent file")).toBe(
			true,
		);
	});

	test("returns true for UPDATE commit", () => {
		expect(
			isIntentCommit("[INTENT:UPDATE] AGENTS.md - Update intent file"),
		).toBe(true);
	});

	test("returns true for REVERT commit", () => {
		expect(
			isIntentCommit("[INTENT:REVERT] AGENTS.md - Revert intent file"),
		).toBe(true);
	});

	test("returns false for regular commit", () => {
		expect(isIntentCommit("feat: add new feature")).toBe(false);
	});

	test("returns false for similar but incorrect format", () => {
		expect(isIntentCommit("[INTENT:INVALID] AGENTS.md")).toBe(false);
	});
});

/**
 * Create a mock GitHub client for testing commit operations.
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
	};
	return { ...defaults, ...overrides } as unknown as GitHubClient;
}

describe("getFileSha", () => {
	test("returns sha for existing file", async () => {
		const mockGetFileContent = mock(async () => ({
			sha: "existingsha123",
			type: "file",
			content: "SGVsbG8=",
		}));

		const client = createMockClient({
			getFileContent: mockGetFileContent,
		});

		const sha = await getFileSha(client, "AGENTS.md", "main");

		expect(sha).toBe("existingsha123");
		expect(mockGetFileContent).toHaveBeenCalledWith("AGENTS.md", "main");
	});

	test("returns undefined for non-existent file", async () => {
		const mockGetFileContent = mock(async () => {
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const client = createMockClient({
			getFileContent: mockGetFileContent,
		});

		const sha = await getFileSha(client, "nonexistent.md", "main");

		expect(sha).toBeUndefined();
	});

	test("returns undefined for directory", async () => {
		const mockGetFileContent = mock(async () => [
			{ name: "file1.md", type: "file" },
			{ name: "file2.md", type: "file" },
		]);

		const client = createMockClient({
			getFileContent: mockGetFileContent,
		});

		const sha = await getFileSha(client, "packages", "main");

		expect(sha).toBeUndefined();
	});

	test("throws for other errors", async () => {
		const mockGetFileContent = mock(async () => {
			const error = new Error("Server Error") as Error & { status: number };
			error.status = 500;
			throw error;
		});

		const client = createMockClient({
			getFileContent: mockGetFileContent,
		});

		await expect(getFileSha(client, "AGENTS.md", "main")).rejects.toThrow(
			"Server Error",
		);
	});
});

describe("createIntentAddCommit", () => {
	test("creates new file and returns commit result", async () => {
		const mockGetFileContent = mock(async () => {
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const mockCreateOrUpdateFile = mock(async () => ({
			commit: {
				sha: "newsha123",
				html_url: "https://github.com/owner/repo/commit/newsha123",
			},
			content: {
				sha: "blobsha",
			},
		}));

		const client = createMockClient({
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		});

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "create",
			reason: "New API documentation",
			suggestedContent: "# API\n\nAPI documentation here.\n",
		};

		const result = await createIntentAddCommit(client, update, {
			branch: "feature/new-api",
		});

		expect(result.sha).toBe("newsha123");
		expect(result.filePath).toBe("packages/api/AGENTS.md");
		expect(result.message).toContain("[INTENT:ADD]");
		expect(result.message).toContain("packages/api/AGENTS.md");
		expect(result.message).toContain("New API documentation");

		// Verify createOrUpdateFile was called correctly
		expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
			"packages/api/AGENTS.md",
			"# API\n\nAPI documentation here.\n",
			expect.stringContaining("[INTENT:ADD]"),
			"feature/new-api",
			undefined,
		);
	});

	test("throws if action is not create", async () => {
		const client = createMockClient();

		const update: IntentUpdate = {
			nodePath: "AGENTS.md",
			action: "update",
			reason: "Update",
			currentContent: "old",
			suggestedContent: "new",
		};

		await expect(
			createIntentAddCommit(client, update, { branch: "main" }),
		).rejects.toThrow('requires action="create"');
	});

	test("throws if suggestedContent is missing", async () => {
		const client = createMockClient();

		const update = {
			nodePath: "AGENTS.md",
			action: "create",
			reason: "Create",
		} as IntentUpdate;

		await expect(
			createIntentAddCommit(client, update, { branch: "main" }),
		).rejects.toThrow("requires suggestedContent");
	});

	test("throws if file already exists", async () => {
		const mockGetFileContent = mock(async () => ({
			sha: "existingsha",
			type: "file",
		}));

		const client = createMockClient({
			getFileContent: mockGetFileContent,
		});

		const update: IntentUpdate = {
			nodePath: "AGENTS.md",
			action: "create",
			reason: "Create",
			suggestedContent: "# Content\n",
		};

		await expect(
			createIntentAddCommit(client, update, { branch: "main" }),
		).rejects.toThrow("file already exists");
	});

	test("creates both nodePath and otherNodePath when specified", async () => {
		let callCount = 0;
		const mockGetFileContent = mock(async () => {
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const createdFiles: string[] = [];
		const mockCreateOrUpdateFile = mock(
			async (path: string, _content: string, _message: string) => {
				createdFiles.push(path);
				return {
					commit: {
						sha: `sha${++callCount}`,
						html_url: `https://github.com/commit/sha${callCount}`,
					},
					content: {
						sha: "blobsha",
					},
				};
			},
		);

		const client = createMockClient({
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		});

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "create",
			reason: "New API package",
			suggestedContent: "# API\n",
		};

		await createIntentAddCommit(client, update, { branch: "main" });

		expect(createdFiles).toContain("packages/api/AGENTS.md");
		expect(createdFiles).toContain("packages/api/CLAUDE.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
	});

	test("does not create otherNodePath if it already exists", async () => {
		let getFileCallCount = 0;
		const mockGetFileContent = mock(async (path: string) => {
			getFileCallCount++;
			if (path === "packages/api/AGENTS.md") {
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			}
			// CLAUDE.md exists
			return {
				sha: "existingsha",
				type: "file",
			};
		});

		const createdFiles: string[] = [];
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			createdFiles.push(path);
			return {
				commit: {
					sha: "newsha",
					html_url: "https://github.com/commit/newsha",
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = createMockClient({
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		});

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "create",
			reason: "New API package",
			suggestedContent: "# API\n",
		};

		await createIntentAddCommit(client, update, { branch: "main" });

		// Only AGENTS.md should be created
		expect(createdFiles).toContain("packages/api/AGENTS.md");
		expect(createdFiles).not.toContain("packages/api/CLAUDE.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(1);
	});
});

describe("createIntentUpdateCommit", () => {
	test("updates existing file and returns commit result", async () => {
		const mockGetFileContent = mock(async () => ({
			sha: "existingsha123",
			type: "file",
			content: "SGVsbG8=",
		}));

		const mockCreateOrUpdateFile = mock(async () => ({
			commit: {
				sha: "newsha456",
				html_url: "https://github.com/owner/repo/commit/newsha456",
			},
			content: {
				sha: "blobsha",
			},
		}));

		const client = createMockClient({
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		});

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "Updated API documentation",
			currentContent: "# API\n\nOld content.\n",
			suggestedContent: "# API\n\nNew content.\n",
		};

		const result = await createIntentUpdateCommit(client, update, {
			branch: "feature/api-update",
		});

		expect(result.sha).toBe("newsha456");
		expect(result.filePath).toBe("packages/api/AGENTS.md");
		expect(result.message).toContain("[INTENT:UPDATE]");
		expect(result.message).toContain("packages/api/AGENTS.md");
		expect(result.message).toContain("Updated API documentation");

		// Verify createOrUpdateFile was called with the existing SHA
		expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
			"packages/api/AGENTS.md",
			"# API\n\nNew content.\n",
			expect.stringContaining("[INTENT:UPDATE]"),
			"feature/api-update",
			"existingsha123",
		);
	});

	test("throws if action is not update", async () => {
		const client = createMockClient();

		const update: IntentUpdate = {
			nodePath: "AGENTS.md",
			action: "create",
			reason: "Create",
			suggestedContent: "new",
		};

		await expect(
			createIntentUpdateCommit(client, update, { branch: "main" }),
		).rejects.toThrow('requires action="update"');
	});

	test("throws if suggestedContent is missing", async () => {
		const client = createMockClient();

		const update = {
			nodePath: "AGENTS.md",
			action: "update",
			reason: "Update",
			currentContent: "old",
		} as IntentUpdate;

		await expect(
			createIntentUpdateCommit(client, update, { branch: "main" }),
		).rejects.toThrow("requires suggestedContent");
	});

	test("throws if currentContent is missing", async () => {
		const client = createMockClient();

		const update = {
			nodePath: "AGENTS.md",
			action: "update",
			reason: "Update",
			suggestedContent: "new",
		} as IntentUpdate;

		await expect(
			createIntentUpdateCommit(client, update, { branch: "main" }),
		).rejects.toThrow("requires currentContent");
	});

	test("throws if file does not exist", async () => {
		const mockGetFileContent = mock(async () => {
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const client = createMockClient({
			getFileContent: mockGetFileContent,
		});

		const update: IntentUpdate = {
			nodePath: "AGENTS.md",
			action: "update",
			reason: "Update",
			currentContent: "old",
			suggestedContent: "new",
		};

		await expect(
			createIntentUpdateCommit(client, update, { branch: "main" }),
		).rejects.toThrow("file does not exist");
	});

	test("updates both nodePath and otherNodePath when specified", async () => {
		let callCount = 0;
		const mockGetFileContent = mock(async () => ({
			sha: `existingsha${++callCount}`,
			type: "file",
			content: "SGVsbG8=",
		}));

		const updatedFiles: string[] = [];
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			updatedFiles.push(path);
			return {
				commit: {
					sha: `newsha${updatedFiles.length}`,
					html_url: `https://github.com/commit/newsha${updatedFiles.length}`,
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = createMockClient({
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		});

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "update",
			reason: "Updated API package",
			currentContent: "# API\n\nOld.\n",
			suggestedContent: "# API\n\nNew.\n",
		};

		await createIntentUpdateCommit(client, update, { branch: "main" });

		expect(updatedFiles).toContain("packages/api/AGENTS.md");
		expect(updatedFiles).toContain("packages/api/CLAUDE.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
	});

	test("does not update otherNodePath if it does not exist", async () => {
		let getFileCallCount = 0;
		const mockGetFileContent = mock(async (path: string) => {
			getFileCallCount++;
			if (path === "packages/api/AGENTS.md") {
				return {
					sha: "existingsha",
					type: "file",
					content: "SGVsbG8=",
				};
			}
			// CLAUDE.md does not exist
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const updatedFiles: string[] = [];
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			updatedFiles.push(path);
			return {
				commit: {
					sha: "newsha",
					html_url: "https://github.com/commit/newsha",
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = createMockClient({
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		});

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "update",
			reason: "Updated API package",
			currentContent: "# API\n\nOld.\n",
			suggestedContent: "# API\n\nNew.\n",
		};

		await createIntentUpdateCommit(client, update, { branch: "main" });

		// Only AGENTS.md should be updated
		expect(updatedFiles).toContain("packages/api/AGENTS.md");
		expect(updatedFiles).not.toContain("packages/api/CLAUDE.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(1);
	});
});

describe("commit message round-trip", () => {
	test("generated messages can be parsed", () => {
		const addMessage = generateAddCommitMessage(
			"packages/api/AGENTS.md",
			"New documentation",
		);
		const parsedAdd = parseIntentCommitMessage(addMessage);
		expect(parsedAdd?.type).toBe("ADD");
		expect(parsedAdd?.nodePath).toBe("packages/api/AGENTS.md");
		expect(parsedAdd?.reason).toBe("New documentation");

		const updateMessage = generateUpdateCommitMessage(
			"packages/core/AGENTS.md",
			"Updated for refactor",
		);
		const parsedUpdate = parseIntentCommitMessage(updateMessage);
		expect(parsedUpdate?.type).toBe("UPDATE");
		expect(parsedUpdate?.nodePath).toBe("packages/core/AGENTS.md");

		const revertMessage = generateRevertCommitMessage(
			"AGENTS.md",
			"User requested",
		);
		const parsedRevert = parseIntentCommitMessage(revertMessage);
		expect(parsedRevert?.type).toBe("REVERT");
		expect(parsedRevert?.nodePath).toBe("AGENTS.md");
	});
});

describe("createIntentRevertCommit", () => {
	test("restores file to previous content when file existed before", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "appliedcommitsha",
			parents: [{ sha: "parentsha123" }],
		}));

		// Track which files and refs are being requested
		const mockGetFileContent = mock(async (path: string, ref?: string) => {
			if (ref === "parentsha123") {
				// Return the previous content from the parent commit
				return {
					sha: "oldcontentsha",
					type: "file",
					content: Buffer.from("# Previous Content\n").toString("base64"),
				};
			}
			// Current content on branch
			return {
				sha: "currentcontentsha",
				type: "file",
				content: Buffer.from("# Current Content\n").toString("base64"),
			};
		});

		const mockCreateOrUpdateFile = mock(async () => ({
			commit: {
				sha: "revertcommitsha",
				html_url: "https://github.com/owner/repo/commit/revertcommitsha",
			},
			content: {
				sha: "blobsha",
			},
		}));

		const client = {
			getCommit: mockGetCommit,
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
			deleteFile: mock(async () => ({})),
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "feature-branch",
			appliedCommit: "appliedcommitsha",
			nodePath: "packages/api/AGENTS.md",
			reason: "User unchecked the box",
		};

		const result = await createIntentRevertCommit(client, options);

		expect(result.sha).toBe("revertcommitsha");
		expect(result.filePath).toBe("packages/api/AGENTS.md");
		expect(result.message).toContain("[INTENT:REVERT]");
		expect(result.message).toContain("User unchecked the box");

		// Verify file was restored with previous content
		expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
			"packages/api/AGENTS.md",
			"# Previous Content\n",
			expect.stringContaining("[INTENT:REVERT]"),
			"feature-branch",
			"currentcontentsha",
		);
	});

	test("deletes file when it did not exist before the intent commit", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "appliedcommitsha",
			parents: [{ sha: "parentsha123" }],
		}));

		const mockGetFileContent = mock(async (_path: string, ref?: string) => {
			if (ref === "parentsha123") {
				// File didn't exist at parent commit
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			}
			// Current content on branch (file exists now)
			return {
				sha: "currentcontentsha",
				type: "file",
				content: Buffer.from("# New Content\n").toString("base64"),
			};
		});

		const mockDeleteFile = mock(async () => ({
			commit: {
				sha: "deletecommitsha",
				html_url: "https://github.com/owner/repo/commit/deletecommitsha",
			},
		}));

		const client = {
			getCommit: mockGetCommit,
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mock(async () => ({})),
			deleteFile: mockDeleteFile,
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "feature-branch",
			appliedCommit: "appliedcommitsha",
			nodePath: "packages/api/AGENTS.md",
		};

		const result = await createIntentRevertCommit(client, options);

		expect(result.sha).toBe("deletecommitsha");
		expect(result.filePath).toBe("packages/api/AGENTS.md");

		// Verify file was deleted
		expect(mockDeleteFile).toHaveBeenCalledWith(
			"packages/api/AGENTS.md",
			expect.stringContaining("[INTENT:REVERT]"),
			"feature-branch",
			"currentcontentsha",
		);
	});

	test("throws if commit has no parent", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "initialcommit",
			parents: [],
		}));

		const client = {
			getCommit: mockGetCommit,
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "main",
			appliedCommit: "initialcommit",
			nodePath: "AGENTS.md",
		};

		await expect(createIntentRevertCommit(client, options)).rejects.toThrow(
			"has no parent",
		);
	});

	test("throws if file no longer exists on branch", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "appliedcommitsha",
			parents: [{ sha: "parentsha123" }],
		}));

		const mockGetFileContent = mock(async () => {
			// File doesn't exist anywhere
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const client = {
			getCommit: mockGetCommit,
			getFileContent: mockGetFileContent,
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "feature-branch",
			appliedCommit: "appliedcommitsha",
			nodePath: "deleted/AGENTS.md",
		};

		await expect(createIntentRevertCommit(client, options)).rejects.toThrow(
			"file no longer exists",
		);
	});

	test("reverts both nodePath and otherNodePath when specified", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "appliedcommitsha",
			parents: [{ sha: "parentsha123" }],
		}));

		const mockGetFileContent = mock(async (path: string, ref?: string) => {
			if (ref === "parentsha123") {
				// Previous content for both files
				if (path === "packages/api/AGENTS.md") {
					return {
						sha: "oldagentssha",
						type: "file",
						content: Buffer.from("# Previous AGENTS\n").toString("base64"),
					};
				}
				if (path === "packages/api/CLAUDE.md") {
					return {
						sha: "oldclaudesha",
						type: "file",
						content: Buffer.from("# Previous CLAUDE\n").toString("base64"),
					};
				}
			}
			// Current content on branch
			if (path === "packages/api/AGENTS.md") {
				return {
					sha: "currentagentssha",
					type: "file",
					content: Buffer.from("# Current AGENTS\n").toString("base64"),
				};
			}
			if (path === "packages/api/CLAUDE.md") {
				return {
					sha: "currentclaudesha",
					type: "file",
					content: Buffer.from("# Current CLAUDE\n").toString("base64"),
				};
			}
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const updatedFiles: string[] = [];
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			updatedFiles.push(path);
			return {
				commit: {
					sha: `revertsha_${updatedFiles.length}`,
					html_url: `https://github.com/commit/revertsha_${updatedFiles.length}`,
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = {
			getCommit: mockGetCommit,
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
			deleteFile: mock(async () => ({})),
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "feature-branch",
			appliedCommit: "appliedcommitsha",
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
		};

		await createIntentRevertCommit(client, options);

		// Both files should be reverted
		expect(updatedFiles).toContain("packages/api/AGENTS.md");
		expect(updatedFiles).toContain("packages/api/CLAUDE.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
	});

	test("deletes otherNodePath if it did not exist before", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "appliedcommitsha",
			parents: [{ sha: "parentsha123" }],
		}));

		const mockGetFileContent = mock(async (path: string, ref?: string) => {
			if (ref === "parentsha123") {
				// AGENTS.md existed before
				if (path === "packages/api/AGENTS.md") {
					return {
						sha: "oldagentssha",
						type: "file",
						content: Buffer.from("# Previous AGENTS\n").toString("base64"),
					};
				}
				// CLAUDE.md did NOT exist before
				const error = new Error("Not Found") as Error & { status: number };
				error.status = 404;
				throw error;
			}
			// Current content on branch - both exist now
			if (path === "packages/api/AGENTS.md") {
				return {
					sha: "currentagentssha",
					type: "file",
					content: Buffer.from("# Current AGENTS\n").toString("base64"),
				};
			}
			if (path === "packages/api/CLAUDE.md") {
				return {
					sha: "currentclaudesha",
					type: "file",
					content: Buffer.from("# Current CLAUDE\n").toString("base64"),
				};
			}
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			throw error;
		});

		const updatedFiles: string[] = [];
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			updatedFiles.push(path);
			return {
				commit: {
					sha: "revertsha",
					html_url: "https://github.com/commit/revertsha",
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const deletedFiles: string[] = [];
		const mockDeleteFile = mock(async (path: string) => {
			deletedFiles.push(path);
			return {
				commit: {
					sha: "deletesha",
					html_url: "https://github.com/commit/deletesha",
				},
			};
		});

		const client = {
			getCommit: mockGetCommit,
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
			deleteFile: mockDeleteFile,
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "feature-branch",
			appliedCommit: "appliedcommitsha",
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
		};

		await createIntentRevertCommit(client, options);

		// AGENTS.md should be restored
		expect(updatedFiles).toContain("packages/api/AGENTS.md");
		// CLAUDE.md should be deleted (didn't exist before)
		expect(deletedFiles).toContain("packages/api/CLAUDE.md");
	});

	test("uses default reason when not provided", async () => {
		const mockGetCommit = mock(async () => ({
			sha: "appliedcommitsha",
			parents: [{ sha: "parentsha123" }],
		}));

		const mockGetFileContent = mock(async (_path: string, ref?: string) => {
			if (ref === "parentsha123") {
				return {
					sha: "oldsha",
					type: "file",
					content: Buffer.from("# Previous\n").toString("base64"),
				};
			}
			return {
				sha: "currentsha",
				type: "file",
				content: Buffer.from("# Current\n").toString("base64"),
			};
		});

		let capturedMessage = "";
		const mockCreateOrUpdateFile = mock(
			async (_path: string, _content: string, message: string) => {
				capturedMessage = message;
				return {
					commit: {
						sha: "revertsha",
						html_url: "https://github.com/commit/revertsha",
					},
					content: {
						sha: "blobsha",
					},
				};
			},
		);

		const client = {
			getCommit: mockGetCommit,
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
			deleteFile: mock(async () => ({})),
		} as unknown as GitHubClient;

		const options: RevertCommitOptions = {
			branch: "main",
			appliedCommit: "appliedcommitsha",
			nodePath: "AGENTS.md",
			// No reason provided - should use default
		};

		await createIntentRevertCommit(client, options);

		expect(capturedMessage).toContain("Reverted via checkbox");
	});
});

describe("createIntentAddCommit with symlink", () => {
	test("creates source file and symlink when symlink option is enabled", async () => {
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
					sha: "symlinkcommitsha",
					url: "https://github.com/commit/symlinkcommitsha",
				};
			},
		);

		const client = {
			getFileContent: mockGetFileContent,
			createFilesWithSymlinks: mockCreateFilesWithSymlinks,
			createOrUpdateFile: mock(async () => ({})),
		} as unknown as GitHubClient;

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "create",
			reason: "New API package",
			suggestedContent: "# API\n\nContent here.\n",
		};

		const result = await createIntentAddCommit(client, update, {
			branch: "main",
			symlink: true,
			symlinkSource: "agents",
		});

		expect(result.sha).toBe("symlinkcommitsha");
		expect(mockCreateFilesWithSymlinks).toHaveBeenCalled();

		// Should have created 2 files
		expect(filesCreated.length).toBe(2);

		// AGENTS.md should be the source (not a symlink)
		const agentsFile = filesCreated.find((f) => f.path.endsWith("AGENTS.md"));
		expect(agentsFile).toBeDefined();
		expect(agentsFile?.isSymlink).toBe(false);
		expect(agentsFile?.content).toBe("# API\n\nContent here.\n");

		// CLAUDE.md should be a symlink pointing to AGENTS.md
		const claudeFile = filesCreated.find((f) => f.path.endsWith("CLAUDE.md"));
		expect(claudeFile).toBeDefined();
		expect(claudeFile?.isSymlink).toBe(true);
		expect(claudeFile?.content).toBe("AGENTS.md");
	});

	test("creates symlink with claude as source when symlinkSource is claude", async () => {
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
					sha: "symlinkcommitsha",
					url: "https://github.com/commit/symlinkcommitsha",
				};
			},
		);

		const client = {
			getFileContent: mockGetFileContent,
			createFilesWithSymlinks: mockCreateFilesWithSymlinks,
			createOrUpdateFile: mock(async () => ({})),
		} as unknown as GitHubClient;

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "create",
			reason: "New API package",
			suggestedContent: "# API\n\nContent here.\n",
		};

		await createIntentAddCommit(client, update, {
			branch: "main",
			symlink: true,
			symlinkSource: "claude",
		});

		// CLAUDE.md should be the source (not a symlink)
		const claudeFile = filesCreated.find((f) => f.path.endsWith("CLAUDE.md"));
		expect(claudeFile).toBeDefined();
		expect(claudeFile?.isSymlink).toBe(false);
		expect(claudeFile?.content).toBe("# API\n\nContent here.\n");

		// AGENTS.md should be a symlink pointing to CLAUDE.md
		const agentsFile = filesCreated.find((f) => f.path.endsWith("AGENTS.md"));
		expect(agentsFile).toBeDefined();
		expect(agentsFile?.isSymlink).toBe(true);
		expect(agentsFile?.content).toBe("CLAUDE.md");
	});

	test("falls back to regular file creation when symlink is false", async () => {
		let callCount = 0;
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
					sha: `sha${++callCount}`,
					html_url: `https://github.com/commit/sha${callCount}`,
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = {
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
			createFilesWithSymlinks: mock(async () => ({})),
		} as unknown as GitHubClient;

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "create",
			reason: "New API package",
			suggestedContent: "# API\n",
		};

		await createIntentAddCommit(client, update, {
			branch: "main",
			symlink: false, // Explicitly disabled
		});

		// Should use regular file creation, not symlinks
		expect(createdFiles).toContain("packages/api/AGENTS.md");
		expect(createdFiles).toContain("packages/api/CLAUDE.md");
	});
});

describe("createIntentUpdateCommit with symlink", () => {
	test("only updates source file when symlink mode is enabled", async () => {
		const mockGetFileContent = mock(async () => ({
			sha: "existingsha123",
			type: "file",
			content: "SGVsbG8=",
		}));

		let updatedPath = "";
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			updatedPath = path;
			return {
				commit: {
					sha: "newsha456",
					html_url: "https://github.com/owner/repo/commit/newsha456",
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = {
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		} as unknown as GitHubClient;

		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "update",
			reason: "Updated API documentation",
			currentContent: "# API\n\nOld content.\n",
			suggestedContent: "# API\n\nNew content.\n",
		};

		const result = await createIntentUpdateCommit(client, update, {
			branch: "feature/api-update",
			symlink: true,
			symlinkSource: "agents",
		});

		expect(result.sha).toBe("newsha456");
		// Should only update AGENTS.md (the source), not CLAUDE.md (the symlink)
		expect(updatedPath).toBe("packages/api/AGENTS.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(1);
	});

	test("updates source file (otherNodePath) when nodePath is the symlink", async () => {
		const mockGetFileContent = mock(async () => ({
			sha: "existingsha123",
			type: "file",
			content: "SGVsbG8=",
		}));

		let updatedPath = "";
		const mockCreateOrUpdateFile = mock(async (path: string) => {
			updatedPath = path;
			return {
				commit: {
					sha: "newsha456",
					html_url: "https://github.com/owner/repo/commit/newsha456",
				},
				content: {
					sha: "blobsha",
				},
			};
		});

		const client = {
			getFileContent: mockGetFileContent,
			createOrUpdateFile: mockCreateOrUpdateFile,
		} as unknown as GitHubClient;

		// nodePath is CLAUDE.md, but symlinkSource is "agents"
		// So CLAUDE.md is the symlink, AGENTS.md is the source
		const update: IntentUpdate = {
			nodePath: "packages/api/CLAUDE.md",
			otherNodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "Updated API documentation",
			currentContent: "# API\n\nOld content.\n",
			suggestedContent: "# API\n\nNew content.\n",
		};

		const result = await createIntentUpdateCommit(client, update, {
			branch: "feature/api-update",
			symlink: true,
			symlinkSource: "agents",
		});

		expect(result.sha).toBe("newsha456");
		// Should update AGENTS.md (the source), even though nodePath is CLAUDE.md
		expect(updatedPath).toBe("packages/api/AGENTS.md");
		expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(1);
	});
});

describe("generateIntentLayerBranchName", () => {
	test("generates branch name with PR number", () => {
		const branchName = generateIntentLayerBranchName(42);
		expect(branchName).toBe("intent-layer/42");
	});

	test("handles large PR numbers", () => {
		const branchName = generateIntentLayerBranchName(99999);
		expect(branchName).toBe("intent-layer/99999");
	});

	test("handles PR number 1", () => {
		const branchName = generateIntentLayerBranchName(1);
		expect(branchName).toBe("intent-layer/1");
	});
});

describe("createIntentLayerBranch", () => {
	test("creates branch with correct name and returns result", async () => {
		const mockCreateBranch = mock(async (branchName: string, sha: string) => ({
			ref: `refs/heads/${branchName}`,
			object: { sha, type: "commit" },
		}));

		const client = {
			createBranch: mockCreateBranch,
		} as unknown as GitHubClient;

		const result = await createIntentLayerBranch(client, 42, "base-sha-123abc");

		expect(result.branchName).toBe("intent-layer/42");
		expect(result.sha).toBe("base-sha-123abc");
		expect(result.ref).toBe("refs/heads/intent-layer/42");
		expect(mockCreateBranch).toHaveBeenCalledWith(
			"intent-layer/42",
			"base-sha-123abc",
		);
	});

	test("propagates error when branch creation fails", async () => {
		const mockCreateBranch = mock(async () => {
			throw new Error("Reference already exists");
		});

		const client = {
			createBranch: mockCreateBranch,
		} as unknown as GitHubClient;

		await expect(
			createIntentLayerBranch(client, 42, "base-sha-123"),
		).rejects.toThrow("Reference already exists");
	});

	test("uses the provided base SHA for the new branch", async () => {
		let capturedSha = "";
		const mockCreateBranch = mock(async (_branchName: string, sha: string) => {
			capturedSha = sha;
			return {
				ref: "refs/heads/intent-layer/100",
				object: { sha, type: "commit" },
			};
		});

		const client = {
			createBranch: mockCreateBranch,
		} as unknown as GitHubClient;

		await createIntentLayerBranch(client, 100, "specific-sha-456def");

		expect(capturedSha).toBe("specific-sha-456def");
	});
});
