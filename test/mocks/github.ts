/**
 * Centralized GitHub API mocks for testing.
 *
 * This module provides mock factories and helpers for testing GitHub API interactions.
 * Use these mocks in unit and integration tests to avoid real API calls.
 *
 * Two mock approaches are provided:
 * 1. createMockGitHubClient - Simple partial mock for integration tests (recommended)
 * 2. createFullMockGitHubClient - Complete mock with Octokit structure for unit tests
 */

import { mock } from "bun:test";
import type { GitHubClient } from "../../src/github/client";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for simple mock client (integration test style).
 * Each method can be configured with a mock function or return value.
 */
export interface MockGitHubClientConfig {
	// Pull request methods
	getPullRequest?: MockFnOrValue<PullRequestResponse>;
	getPullRequestDiff?: MockFnOrValue<string>;
	getPullRequestFiles?: MockFnOrValue<PullRequestFile[]>;
	getPullRequestCommits?: MockFnOrValue<CommitResponse[]>;

	// Issue/comment methods
	getIssueComments?: MockFnOrValue<CommentResponse[]>;
	createComment?: MockFnOrValue<CommentResponse>;
	updateComment?: MockFnOrValue<CommentResponse>;
	getComment?: MockFnOrValue<CommentResponse>;
	getIssue?: MockFnOrValue<IssueResponse>;

	// File operations
	getFileContent?: MockFnOrValue<FileContentResponse>;
	createOrUpdateFile?: MockFnOrValue<CreateOrUpdateFileResponse>;
	deleteFile?: MockFnOrValue<DeleteFileResponse>;

	// Repository operations
	getDefaultBranch?: MockFnOrValue<string>;
	createBranch?: MockFnOrValue<RefResponse>;
	createPullRequest?: MockFnOrValue<PullRequestResponse>;
	getCommit?: MockFnOrValue<CommitDetailResponse>;

	// Git operations
	createBlob?: MockFnOrValue<BlobResponse>;
	createTree?: MockFnOrValue<TreeResponse>;
	createCommit?: MockFnOrValue<CommitCreateResponse>;
	updateRef?: MockFnOrValue<RefResponse>;
	getRef?: MockFnOrValue<RefResponse>;
	createFilesWithSymlinks?: MockFnOrValue<{ sha: string; url: string }>;

	// Context overrides
	repo?: { owner: string; repo: string };
	eventName?: string;
	sha?: string;
	actor?: string;
	pullRequestNumber?: number;
	issueNumber?: number;
}

type MockFnOrValue<T> =
	| T
	| (() => T)
	| (() => Promise<T>)
	| ReturnType<typeof mock>;

// ============================================================================
// Response Types (simplified versions of GitHub API responses)
// ============================================================================

export interface PullRequestResponse {
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	draft?: boolean;
	merged?: boolean;
	labels?: Array<{ name: string; color?: string; description?: string | null }>;
	user?: { login: string; id: number; avatar_url?: string; type?: string };
	base: { ref: string; sha: string };
	head: { ref: string; sha: string };
	html_url?: string;
	created_at?: string;
	updated_at?: string;
	commits?: number;
	changed_files?: number;
	additions?: number;
	deletions?: number;
}

export interface PullRequestFile {
	sha: string;
	filename: string;
	status:
		| "added"
		| "removed"
		| "modified"
		| "renamed"
		| "copied"
		| "changed"
		| "unchanged";
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	previous_filename?: string;
}

export interface CommentResponse {
	id: number;
	body?: string;
	user?: { login: string; id: number };
	created_at?: string;
	updated_at?: string;
	html_url?: string;
}

export interface CommitResponse {
	sha: string;
	commit: {
		message: string;
		author?: { name: string; email: string; date: string };
		committer?: { name: string; email: string; date: string };
		comment_count?: number;
	};
	html_url?: string;
	author?: { login: string; id: number; avatar_url?: string; type?: string };
	committer?: { login: string; id: number; avatar_url?: string; type?: string };
	parents?: Array<{ sha: string }>;
}

export interface IssueResponse {
	number: number;
	title: string;
	body?: string | null;
	state: "open" | "closed";
	labels?: Array<{ name: string; color?: string }>;
	user?: { login: string; id: number };
	created_at?: string;
	updated_at?: string;
}

export interface FileContentResponse {
	type: "file" | "dir" | "symlink" | "submodule";
	name: string;
	path: string;
	sha: string;
	content?: string;
	encoding?: "base64";
	size?: number;
	html_url?: string;
}

export interface CreateOrUpdateFileResponse {
	content: { sha: string; path: string } | null;
	commit: { sha: string; message?: string; html_url?: string };
}

export interface DeleteFileResponse {
	content: null;
	commit: { sha: string; message?: string };
}

export interface RefResponse {
	ref: string;
	node_id?: string;
	url?: string;
	object: { sha: string; type: string };
}

export interface BlobResponse {
	sha: string;
	url?: string;
}

export interface TreeResponse {
	sha: string;
	url?: string;
	tree?: Array<{
		path: string;
		mode: string;
		type: string;
		sha: string;
		size?: number;
	}>;
}

export interface CommitCreateResponse {
	sha: string;
	html_url: string;
	message?: string;
	tree?: { sha: string };
	parents?: Array<{ sha: string }>;
}

export interface CommitDetailResponse {
	sha: string;
	commit: {
		message: string;
		author?: { name: string; email: string; date: string };
		committer?: { name: string; email: string; date: string };
		tree?: { sha: string };
	};
	html_url?: string;
	files?: PullRequestFile[];
}

// ============================================================================
// Mock Factory Functions
// ============================================================================

/**
 * Create a mock GitHubClient with configurable responses.
 * This is the recommended approach for integration tests.
 *
 * @param config - Configuration for mock responses
 * @returns A mock GitHubClient instance
 *
 * @example
 * ```typescript
 * const client = createMockGitHubClient({
 *   getPullRequest: { number: 42, title: 'Test PR', body: null, state: 'open', base: { ref: 'main', sha: 'abc' }, head: { ref: 'feature', sha: 'def' } },
 *   getFileContent: errors.notFound(), // Simulate 404
 * });
 * ```
 */
export function createMockGitHubClient(
	config: Partial<MockGitHubClientConfig> = {},
): GitHubClient {
	const repo = config.repo ?? { owner: "test-owner", repo: "test-repo" };

	const wrapMock = <T>(
		value: MockFnOrValue<T> | undefined,
		defaultValue: T,
	): ReturnType<typeof mock> => {
		if (value === undefined) {
			return mock(() => Promise.resolve(defaultValue));
		}
		if (typeof value === "function") {
			// Check if it's already a mock function
			if ("mock" in value) {
				return value as ReturnType<typeof mock>;
			}
			return mock(value as () => T | Promise<T>);
		}
		// It's an error object - check if it has a status property
		if (value && typeof value === "object" && "status" in value) {
			return mock(() => Promise.reject(value));
		}
		return mock(() => Promise.resolve(value));
	};

	const client = {
		// Context properties
		repo,
		eventName: config.eventName ?? "pull_request",
		sha: config.sha ?? "test-sha-123",
		actor: config.actor ?? "test-actor",
		pullRequestNumber: config.pullRequestNumber,
		issueNumber: config.issueNumber,
		context: {
			repo,
			eventName: config.eventName ?? "pull_request",
			sha: config.sha ?? "test-sha-123",
			actor: config.actor ?? "test-actor",
			payload: {
				pull_request: config.pullRequestNumber
					? { number: config.pullRequestNumber }
					: undefined,
			},
			issue: { number: config.issueNumber ?? config.pullRequestNumber ?? 1 },
		},

		// Event type checks
		isPullRequestEvent: mock(() => config.eventName === "pull_request"),
		isIssueCommentEvent: mock(() => config.eventName === "issue_comment"),

		// Pull request methods
		getPullRequest: wrapMock(config.getPullRequest, {
			number: 1,
			title: "Test PR",
			body: null,
			state: "open",
			base: { ref: "main", sha: "base-sha" },
			head: { ref: "feature", sha: "head-sha" },
		}),
		getPullRequestDiff: wrapMock(
			config.getPullRequestDiff,
			"diff --git a/file.ts b/file.ts",
		),
		getPullRequestFiles: wrapMock(config.getPullRequestFiles, []),
		getPullRequestCommits: wrapMock(config.getPullRequestCommits, []),

		// Comment methods
		getIssueComments: wrapMock(config.getIssueComments, []),
		createComment: wrapMock(config.createComment, {
			id: 1,
			body: "",
		}),
		updateComment: wrapMock(config.updateComment, {
			id: 1,
			body: "",
		}),
		getComment: wrapMock(config.getComment, { id: 1, body: "" }),
		getIssue: wrapMock(config.getIssue, {
			number: 1,
			title: "Test Issue",
			state: "open",
		}),
		getPullRequestReviewComments: mock(() => Promise.resolve([])),

		// File operations
		getFileContent: wrapMock(config.getFileContent, {
			type: "file",
			name: "file.md",
			path: "file.md",
			sha: "file-sha",
			content: Buffer.from("# Content").toString("base64"),
			encoding: "base64",
		}),
		createOrUpdateFile: wrapMock(config.createOrUpdateFile, {
			content: { sha: "new-sha", path: "file.md" },
			commit: { sha: "commit-sha", html_url: "https://github.com/commit" },
		}),
		deleteFile: wrapMock(config.deleteFile, {
			content: null,
			commit: { sha: "delete-commit-sha" },
		}),

		// Repository operations
		getDefaultBranch: wrapMock(config.getDefaultBranch, "main"),
		createBranch: wrapMock(config.createBranch, {
			ref: "refs/heads/new-branch",
			object: { sha: "branch-sha", type: "commit" },
		}),
		createPullRequest: wrapMock(config.createPullRequest, {
			number: 2,
			title: "New PR",
			body: null,
			state: "open",
			base: { ref: "main", sha: "base-sha" },
			head: { ref: "feature", sha: "head-sha" },
			html_url: "https://github.com/test/repo/pull/2",
		}),
		getCommit: wrapMock(config.getCommit, {
			sha: "commit-sha",
			commit: { message: "Test commit" },
		}),

		// Git operations
		createBlob: wrapMock(config.createBlob, { sha: "blob-sha" }),
		createTree: wrapMock(config.createTree, { sha: "tree-sha" }),
		createCommit: wrapMock(config.createCommit, {
			sha: "new-commit-sha",
			html_url: "https://github.com/commit/new",
		}),
		updateRef: wrapMock(config.updateRef, {
			ref: "refs/heads/branch",
			object: { sha: "updated-sha", type: "commit" },
		}),
		getRef: wrapMock(config.getRef, {
			ref: "refs/heads/branch",
			object: { sha: "ref-sha", type: "commit" },
		}),
		createFilesWithSymlinks: wrapMock(config.createFilesWithSymlinks, {
			sha: "symlink-commit-sha",
			url: "https://github.com/commit/symlink",
		}),
	} as unknown as GitHubClient;

	return client;
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Error factories for testing error handling and retry logic.
 */
export const errors = {
	/**
	 * Create a 404 Not Found error
	 */
	notFound: (message = "Not Found") => {
		const error = new Error(message) as Error & { status: number };
		error.status = 404;
		return error;
	},

	/**
	 * Create a 429 Rate Limited error with optional retry-after header
	 */
	rateLimited: (retryAfterSeconds = 60, message = "Rate Limited") => {
		const error = new Error(message) as Error & {
			status: number;
			response: { headers: Record<string, string> };
		};
		error.status = 429;
		error.response = {
			headers: { "retry-after": String(retryAfterSeconds) },
		};
		return error;
	},

	/**
	 * Create a 403 Forbidden error (can also indicate secondary rate limit)
	 */
	forbidden: (message = "Forbidden") => {
		const error = new Error(message) as Error & { status: number };
		error.status = 403;
		return error;
	},

	/**
	 * Create a 401 Unauthorized error
	 */
	unauthorized: (message = "Unauthorized") => {
		const error = new Error(message) as Error & { status: number };
		error.status = 401;
		return error;
	},

	/**
	 * Create a 422 Unprocessable Entity error
	 */
	unprocessable: (message = "Unprocessable Entity") => {
		const error = new Error(message) as Error & { status: number };
		error.status = 422;
		return error;
	},

	/**
	 * Create a server error (500, 502, 503, or 504)
	 */
	serverError: (status: 500 | 502 | 503 | 504 = 503) => {
		const messages: Record<number, string> = {
			500: "Internal Server Error",
			502: "Bad Gateway",
			503: "Service Unavailable",
			504: "Gateway Timeout",
		};
		const error = new Error(messages[status]) as Error & { status: number };
		error.status = status;
		return error;
	},

	/**
	 * Create a conflict error (409) - useful for testing branch/ref conflicts
	 */
	conflict: (message = "Conflict") => {
		const error = new Error(message) as Error & { status: number };
		error.status = 409;
		return error;
	},
};

// ============================================================================
// Mock Response Factories
// ============================================================================

/**
 * Pre-built mock response factories for common test scenarios.
 */
export const mockGitHubResponses = {
	/**
	 * Create a mock pull request response
	 */
	pullRequest: (
		overrides: Partial<PullRequestResponse> = {},
	): PullRequestResponse => ({
		number: 42,
		title: "Test Pull Request",
		body: "Test description",
		state: "open",
		draft: false,
		merged: false,
		labels: [],
		user: { login: "testuser", id: 1 },
		base: { ref: "main", sha: "base-sha-123" },
		head: { ref: "feature-branch", sha: "head-sha-456" },
		html_url: "https://github.com/test-owner/test-repo/pull/42",
		created_at: "2024-01-15T10:00:00Z",
		updated_at: "2024-01-15T10:00:00Z",
		commits: 1,
		changed_files: 1,
		additions: 10,
		deletions: 5,
		...overrides,
	}),

	/**
	 * Create a mock comment response
	 */
	comment: (overrides: Partial<CommentResponse> = {}): CommentResponse => ({
		id: 123,
		body: "Test comment",
		user: { login: "testuser", id: 1 },
		created_at: "2024-01-15T10:00:00Z",
		updated_at: "2024-01-15T10:00:00Z",
		html_url:
			"https://github.com/test-owner/test-repo/issues/1#issuecomment-123",
		...overrides,
	}),

	/**
	 * Create a mock file content response (existing file)
	 */
	fileContent: (
		path: string,
		content: string,
		overrides: Partial<FileContentResponse> = {},
	): FileContentResponse => ({
		type: "file",
		name: path.split("/").pop() ?? path,
		path,
		sha: `sha-${path.replace(/[^a-z0-9]/gi, "")}`,
		content: Buffer.from(content).toString("base64"),
		encoding: "base64",
		size: content.length,
		...overrides,
	}),

	/**
	 * Create a mock file list for getPullRequestFiles
	 */
	fileList: (
		files: Array<{ filename: string; status?: PullRequestFile["status"] }>,
	): PullRequestFile[] =>
		files.map((f, i) => ({
			sha: `sha-${i}`,
			filename: f.filename,
			status: f.status ?? "modified",
			additions: 10,
			deletions: 5,
			changes: 15,
		})),

	/**
	 * Create a mock commit response
	 */
	commit: (overrides: Partial<CommitResponse> = {}): CommitResponse => ({
		sha: "commit-sha-123",
		commit: {
			message: "feat: test commit",
			author: {
				name: "Test User",
				email: "test@example.com",
				date: "2024-01-15T10:00:00Z",
			},
			committer: {
				name: "Test User",
				email: "test@example.com",
				date: "2024-01-15T10:00:00Z",
			},
		},
		html_url: "https://github.com/test-owner/test-repo/commit/commit-sha-123",
		author: { login: "testuser", id: 1 },
		committer: { login: "testuser", id: 1 },
		parents: [{ sha: "parent-sha" }],
		...overrides,
	}),

	/**
	 * Create a mock create/update file response
	 */
	createOrUpdateFile: (
		path: string,
		commitSha: string,
		overrides: Partial<CreateOrUpdateFileResponse> = {},
	): CreateOrUpdateFileResponse => ({
		content: { sha: `content-sha-${path}`, path },
		commit: {
			sha: commitSha,
			html_url: `https://github.com/test-owner/test-repo/commit/${commitSha}`,
		},
		...overrides,
	}),

	/**
	 * Create an intent layer comment body with proper marker structure.
	 * Useful for testing checkbox handling.
	 */
	intentLayerComment: (options: {
		nodePath: string;
		otherNodePath?: string;
		headSha: string;
		appliedCommit?: string;
		checked?: boolean;
		suggestedContent?: string;
		currentContent?: string;
		reason?: string;
		action?: "create" | "update";
	}): string => {
		const MARKER_PREFIX = "<!-- INTENT_LAYER";
		const MARKER_SUFFIX = "-->";

		const parts = [`node=${encodeURIComponent(options.nodePath)}`];
		if (options.otherNodePath) {
			parts.push(`otherNode=${encodeURIComponent(options.otherNodePath)}`);
		}
		parts.push(`appliedCommit=${options.appliedCommit ?? ""}`);
		parts.push(`headSha=${options.headSha}`);

		const marker = `${MARKER_PREFIX} ${parts.join(" ")} ${MARKER_SUFFIX}`;
		const checkbox =
			(options.checked ?? false)
				? "- [x] Apply this change"
				: "- [ ] Apply this change";

		const suggestedContent =
			options.suggestedContent ?? "# Default Content\n\nSuggested content.";
		const reason = options.reason ?? "Changes detected in covered files";
		const action = options.action ?? "create";

		let content = `${marker}

## Intent Layer ${action === "update" ? "Update" : "Add"} Suggestion

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
	},
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a sequence of responses for testing retry logic.
 * Returns different responses on subsequent calls.
 *
 * @example
 * ```typescript
 * const client = createMockGitHubClient({
 *   getFileContent: createResponseSequence([
 *     errors.serverError(503),
 *     errors.serverError(503),
 *     mockResponses.fileContent('AGENTS.md', '# Content'),
 *   ]),
 * });
 * ```
 */
export function createResponseSequence<T>(
	responses: Array<T | Error>,
): ReturnType<typeof mock> {
	let callIndex = 0;
	return mock(() => {
		const response = responses[Math.min(callIndex, responses.length - 1)];
		callIndex++;
		if (response instanceof Error) {
			return Promise.reject(response);
		}
		return Promise.resolve(response);
	});
}

/**
 * Create a mock that tracks calls and allows assertions.
 * Wraps the mock function to capture call arguments.
 *
 * @example
 * ```typescript
 * const { mockFn, calls } = createTrackingMock((id, body) => ({ id, body }));
 * await mockFn(123, 'test');
 * expect(calls[0]).toEqual([123, 'test']);
 * ```
 */
export function createTrackingMock<T extends unknown[], R>(
	implementation: (...args: T) => R | Promise<R>,
): { mockFn: ReturnType<typeof mock>; calls: T[] } {
	const calls: T[] = [];
	const mockFn = mock((...args: unknown[]) => {
		calls.push(args as T);
		return implementation(...(args as T));
	});
	return { mockFn, calls };
}
