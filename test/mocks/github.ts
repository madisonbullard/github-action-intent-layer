/**
 * Centralized GitHub API mocks for testing.
 *
 * This module provides mock factories and helpers for testing GitHub API interactions.
 * Use these mocks in unit and integration tests to avoid real API calls.
 *
 * TODO: Implement the following:
 *
 * 1. MockGitHubClient factory
 *    - createMockGitHubClient(options): GitHubClient
 *    - Configurable responses for all GitHubClient methods
 *    - Support for error simulation (rate limits, 404s, etc.)
 *
 * 2. Common mock responses
 *    - mockPullRequestResponse(overrides)
 *    - mockIssueCommentResponse(overrides)
 *    - mockFileContentResponse(overrides)
 *    - mockCommitResponse(overrides)
 *
 * 3. Error simulation helpers
 *    - createRateLimitError(retryAfter?)
 *    - createNotFoundError()
 *    - createForbiddenError()
 *    - createServerError(status: 500 | 502 | 503 | 504)
 *
 * 4. Context mocking
 *    - mockGitHubContext(overrides)
 *    - Support for pull_request, issue_comment events
 *
 * Example usage (future):
 *
 * ```typescript
 * import { createMockGitHubClient, mockPullRequestResponse } from '../mocks/github';
 *
 * const client = createMockGitHubClient({
 *   getPullRequest: mockPullRequestResponse({
 *     number: 42,
 *     title: 'Test PR',
 *     state: 'open',
 *   }),
 * });
 * ```
 *
 * Migration path:
 * - Existing inline mocks in test files can be gradually migrated here
 * - See test/unit/client.test.ts createMockedGitHubClient() for reference implementation
 * - See test/integration/checkbox-toggle-commit.test.ts createMockClient() for simpler pattern
 */

import type { GitHubClient } from "../../src/github/client";

/**
 * Placeholder type for mock configuration.
 * TODO: Define comprehensive interface for all GitHubClient methods.
 */
export interface MockGitHubClientConfig {
	// Pull request methods
	getPullRequest?: unknown;
	getPullRequestDiff?: unknown;
	getPullRequestFiles?: unknown;
	getPullRequestCommits?: unknown;

	// Issue/comment methods
	getIssueComments?: unknown;
	createComment?: unknown;
	updateComment?: unknown;
	getComment?: unknown;

	// File operations
	getFileContent?: unknown;
	createOrUpdateFile?: unknown;
	deleteFile?: unknown;

	// Repository operations
	getDefaultBranch?: unknown;
	createBranch?: unknown;
	createPullRequest?: unknown;

	// Git operations
	createBlob?: unknown;
	createTree?: unknown;
	createCommit?: unknown;
	updateRef?: unknown;
	getRef?: unknown;
	createFilesWithSymlinks?: unknown;
}

/**
 * Placeholder factory for creating mock GitHubClient instances.
 * TODO: Implement full mock factory.
 */
export function createMockGitHubClient(
	_config: Partial<MockGitHubClientConfig> = {},
): GitHubClient {
	throw new Error(
		"Not implemented yet. See TODO comments for implementation plan.",
	);
}

/**
 * Placeholder for common error factories.
 * TODO: Implement error factories for testing retry logic.
 */
export const errors = {
	notFound: () => {
		const error = new Error("Not Found") as Error & { status: number };
		error.status = 404;
		return error;
	},

	rateLimited: (retryAfter = 60) => {
		const error = new Error("Rate Limited") as Error & {
			status: number;
			response: { headers: Record<string, string> };
		};
		error.status = 429;
		error.response = { headers: { "retry-after": String(retryAfter) } };
		return error;
	},

	forbidden: () => {
		const error = new Error("Forbidden") as Error & { status: number };
		error.status = 403;
		return error;
	},

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
};
