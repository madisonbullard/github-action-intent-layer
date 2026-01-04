/**
 * Setup helpers for real GitHub API integration tests.
 *
 * This module provides utilities for running integration tests against the actual
 * GitHub API. These tests should ONLY be run manually or via CI with explicit opt-in.
 *
 * IMPORTANT: These tests create real resources (branches, PRs) in the repository.
 * Always run cleanup after tests, even on failure.
 *
 * Required Environment Variables:
 * - GITHUB_TOKEN: A token with repo permissions for creating branches/PRs
 *
 * Branch Naming Convention:
 * - test-fixture/<run-id>-<timestamp>
 * - Example: test-fixture/12345678-1704067200
 * - This ensures uniqueness even with concurrent CI runs
 *
 * ## Recommended: Use withTestResources for automatic cleanup
 *
 * The `withTestResources` utility wraps test execution in try/finally to
 * guarantee cleanup even when tests fail or throw errors:
 *
 * ```typescript
 * import { describe, test } from 'bun:test';
 * import { withTestResources, shouldSkipRealTests } from './setup';
 *
 * describe('Real GitHub Integration', () => {
 *   test.skipIf(shouldSkipRealTests())('checkbox toggle creates commit', async () => {
 *     await withTestResources(async (ctx) => {
 *       // ctx.branchName, ctx.prNumber, ctx.prUrl, ctx.config, ctx.octokit available
 *       const { data: pr } = await ctx.octokit.rest.pulls.get({
 *         owner: ctx.config.owner,
 *         repo: ctx.config.repo,
 *         pull_number: ctx.prNumber,
 *       });
 *       expect(pr.state).toBe('open');
 *       // Cleanup happens automatically in finally block!
 *     });
 *   });
 * });
 * ```
 *
 * ## Alternative: Manual resource management with afterAll
 *
 * For more control, you can manage resources manually. Be sure to use
 * cleanupTestResources in afterAll to handle cleanup:
 *
 * ```typescript
 * import { describe, test, afterAll } from 'bun:test';
 * import { createTestBranch, cleanupTestBranch, createTestPullRequest, closeTestPullRequest } from './setup';
 *
 * describe('Real GitHub Integration', () => {
 *   let branchName: string;
 *   let prNumber: number;
 *
 *   afterAll(async () => {
 *     // Always cleanup, even on test failure
 *     if (prNumber) await closeTestPullRequest(prNumber);
 *     if (branchName) await cleanupTestBranch(branchName);
 *   });
 *
 *   test('checkbox toggle creates commit', async () => {
 *     const runId = process.env.GITHUB_RUN_ID ?? 'local';
 *     branchName = await createTestBranch(runId);
 *
 *     const { number } = await createTestPullRequest({
 *       head: branchName,
 *       base: 'main',
 *       title: 'Test: Checkbox Toggle',
 *       body: '- [ ] Approve changes',
 *     });
 *     prNumber = number;
 *
 *     // ... run action and verify results
 *   });
 * });
 * ```
 */

import * as github from "@actions/github";

/**
 * Configuration for real GitHub tests.
 */
export interface RealGitHubTestConfig {
	/** GitHub token with repo permissions */
	token: string;
	/** Repository owner */
	owner: string;
	/** Repository name */
	repo: string;
	/** Base branch to create test branches from (default: 'main') */
	baseBranch?: string;
}

/**
 * Get test configuration from environment.
 * Throws if required environment variables are missing.
 */
export function getTestConfig(): RealGitHubTestConfig {
	const token = process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error(
			"GITHUB_TOKEN environment variable is required for real GitHub tests",
		);
	}

	// Parse from GITHUB_REPOSITORY (format: owner/repo) if available
	const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

	return {
		token,
		owner: owner || "sst", // fallback for local development
		repo: repo || "github-action-intent-layer", // fallback for local development
		baseBranch: process.env.TEST_BASE_BRANCH ?? "main",
	};
}

/**
 * Generate a unique test branch name.
 *
 * @param runId - Unique identifier (e.g., GITHUB_RUN_ID or 'local')
 * @returns Branch name in format: test-fixture/<runId>-<timestamp>
 */
export function generateTestBranchName(runId: string): string {
	const timestamp = Date.now();
	return `test-fixture/${runId}-${timestamp}`;
}

/**
 * Check if we're running in CI environment.
 */
export function isCI(): boolean {
	return process.env.CI === "true";
}

/**
 * Skip test if not explicitly opted in.
 * Real GitHub tests should only run when explicitly requested.
 */
export function shouldSkipRealTests(): boolean {
	// In CI, check for explicit opt-in via workflow_dispatch input
	if (isCI()) {
		return process.env.RUN_GITHUB_TESTS !== "true";
	}

	// Locally, check for explicit opt-in
	return process.env.RUN_REAL_GITHUB_TESTS !== "true";
}

// =============================================================================
// GitHub API Client Helpers
// =============================================================================

type OctokitClient = ReturnType<typeof github.getOctokit>;

/**
 * Get or create a cached Octokit client.
 * Uses the configuration from getTestConfig().
 */
let cachedOctokit: OctokitClient | null = null;

function getOctokit(): OctokitClient {
	if (!cachedOctokit) {
		const config = getTestConfig();
		cachedOctokit = github.getOctokit(config.token);
	}
	return cachedOctokit;
}

/**
 * Reset the cached Octokit client.
 * Useful for tests that need to change the token.
 */
export function resetOctokitCache(): void {
	cachedOctokit = null;
}

// =============================================================================
// Branch Management
// =============================================================================

/**
 * Create a test branch from the base branch.
 *
 * Uses the GitHub Git References API:
 * 1. Get the SHA of the base branch
 * 2. Create a new ref pointing to that SHA
 *
 * @param runId - Unique identifier for this test run (e.g., GITHUB_RUN_ID or 'local')
 * @returns The created branch name (format: test-fixture/{runId}-{timestamp})
 */
export async function createTestBranch(runId: string): Promise<string> {
	const config = getTestConfig();
	const octokit = getOctokit();
	const branchName = generateTestBranchName(runId);

	// Get the SHA of the base branch
	const { data: baseRef } = await octokit.rest.git.getRef({
		owner: config.owner,
		repo: config.repo,
		ref: `heads/${config.baseBranch}`,
	});

	// Create the new branch pointing to the same SHA
	await octokit.rest.git.createRef({
		owner: config.owner,
		repo: config.repo,
		ref: `refs/heads/${branchName}`,
		sha: baseRef.object.sha,
	});

	return branchName;
}

/**
 * Delete a test branch.
 *
 * Uses DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}
 *
 * @param branchName - Branch to delete (e.g., 'test-fixture/12345-1704067200')
 * @throws Error if the branch doesn't exist or deletion fails
 */
export async function cleanupTestBranch(branchName: string): Promise<void> {
	const config = getTestConfig();
	const octokit = getOctokit();

	await octokit.rest.git.deleteRef({
		owner: config.owner,
		repo: config.repo,
		ref: `heads/${branchName}`,
	});
}

/**
 * Clean up all test branches (those matching test-fixture/* pattern).
 * Useful for periodic cleanup in CI or after test failures.
 *
 * This function:
 * 1. Lists all branches matching the test-fixture/ prefix
 * 2. Deletes each matching branch
 * 3. Continues even if individual deletions fail (logs warnings)
 *
 * @returns Number of branches deleted
 */
export async function cleanupAllTestBranches(): Promise<number> {
	const config = getTestConfig();
	const octokit = getOctokit();
	const prefix = "test-fixture/";

	// List all branches (paginated)
	const branches: string[] = [];
	for await (const response of octokit.paginate.iterator(
		octokit.rest.repos.listBranches,
		{
			owner: config.owner,
			repo: config.repo,
			per_page: 100,
		},
	)) {
		for (const branch of response.data) {
			if (branch.name.startsWith(prefix)) {
				branches.push(branch.name);
			}
		}
	}

	// Delete each test branch
	let deletedCount = 0;
	for (const branchName of branches) {
		try {
			await cleanupTestBranch(branchName);
			deletedCount++;
		} catch (error) {
			// Log but continue - we want to clean up as many as possible
			console.warn(`Failed to delete branch ${branchName}:`, error);
		}
	}

	return deletedCount;
}

/**
 * Options for creating a test pull request.
 */
export interface CreateTestPROptions {
	/** Source branch with changes */
	head: string;
	/** Target branch (usually 'main') */
	base: string;
	/** PR title */
	title: string;
	/** PR body/description */
	body: string;
}

/**
 * Create a test pull request.
 *
 * Uses POST /repos/{owner}/{repo}/pulls
 *
 * @param options - PR creation options
 * @returns Created PR number and URL
 */
export async function createTestPullRequest(
	options: CreateTestPROptions,
): Promise<{ number: number; url: string }> {
	const config = getTestConfig();
	const octokit = getOctokit();

	const { data: pr } = await octokit.rest.pulls.create({
		owner: config.owner,
		repo: config.repo,
		head: options.head,
		base: options.base,
		title: options.title,
		body: options.body,
	});

	return {
		number: pr.number,
		url: pr.html_url,
	};
}

/**
 * Close a test pull request.
 *
 * Uses PATCH /repos/{owner}/{repo}/pulls/{pull_number}
 *
 * @param prNumber - PR number to close
 */
export async function closeTestPullRequest(prNumber: number): Promise<void> {
	const config = getTestConfig();
	const octokit = getOctokit();

	await octokit.rest.pulls.update({
		owner: config.owner,
		repo: config.repo,
		pull_number: prNumber,
		state: "closed",
	});
}

/**
 * Wait for a comment matching a pattern to appear on a PR.
 * Useful for verifying action output.
 *
 * Polls the comments endpoint with exponential backoff until:
 * - A comment matching the pattern is found
 * - The timeout is exceeded
 *
 * @param prNumber - PR number to check
 * @param pattern - Regex pattern to match in comment body
 * @param timeoutMs - Maximum time to wait (default: 30000)
 * @returns The matching comment's id and body
 * @throws Error if timeout is exceeded without finding a matching comment
 */
export async function waitForComment(
	prNumber: number,
	pattern: RegExp,
	timeoutMs = 30000,
): Promise<{ id: number; body: string }> {
	const config = getTestConfig();
	const octokit = getOctokit();

	const startTime = Date.now();
	let pollInterval = 1000; // Start with 1 second
	const maxPollInterval = 5000; // Max 5 seconds between polls

	while (Date.now() - startTime < timeoutMs) {
		// Fetch all comments on the PR/issue
		const { data: comments } = await octokit.rest.issues.listComments({
			owner: config.owner,
			repo: config.repo,
			issue_number: prNumber,
			per_page: 100,
		});

		// Check if any comment matches the pattern
		for (const comment of comments) {
			if (comment.body && pattern.test(comment.body)) {
				return {
					id: comment.id,
					body: comment.body,
				};
			}
		}

		// Wait before polling again (exponential backoff)
		await sleep(pollInterval);
		pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
	}

	throw new Error(
		`Timeout waiting for comment matching ${pattern} on PR #${prNumber} after ${timeoutMs}ms`,
	);
}

/**
 * Sleep for the specified duration.
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Test Resource Management (try/finally wrapper)
// =============================================================================

/**
 * Resources created during test execution that need cleanup.
 */
export interface TestResources {
	/** Test branch name (if created) */
	branchName?: string;
	/** PR number (if created) */
	prNumber?: number;
}

/**
 * Context provided to test callback with created resources.
 */
export interface TestContext {
	/** The created test branch name */
	branchName: string;
	/** The created PR number */
	prNumber: number;
	/** The PR URL */
	prUrl: string;
	/** Test configuration */
	config: RealGitHubTestConfig;
	/** Octokit client for additional API calls */
	octokit: OctokitClient;
}

/**
 * Options for withTestResources.
 */
export interface WithTestResourcesOptions {
	/** PR title (default: auto-generated with timestamp) */
	prTitle?: string;
	/** PR body (default: standard test description) */
	prBody?: string;
	/** Base branch for the PR (default: from config) */
	baseBranch?: string;
}

/**
 * Wrap test execution in try/finally to ensure cleanup on failure.
 *
 * This utility function:
 * 1. Creates a test branch
 * 2. Creates a test PR
 * 3. Executes the test callback with the created resources
 * 4. ALWAYS cleans up (closes PR, deletes branch) in a finally block
 *
 * This pattern ensures that test resources are cleaned up even when:
 * - The test throws an error
 * - An assertion fails
 * - The test times out (cleanup will run when timeout handler completes)
 *
 * @param testFn - Async test function that receives TestContext
 * @param options - Optional configuration for resource creation
 * @returns Promise that resolves when test completes and cleanup finishes
 *
 * @example
 * ```typescript
 * test('checkbox toggle creates commit', async () => {
 *   await withTestResources(async (ctx) => {
 *     // ctx.branchName, ctx.prNumber, ctx.octokit available
 *     const { data: pr } = await ctx.octokit.rest.pulls.get({
 *       owner: ctx.config.owner,
 *       repo: ctx.config.repo,
 *       pull_number: ctx.prNumber,
 *     });
 *     expect(pr.state).toBe('open');
 *   });
 * });
 * ```
 */
export async function withTestResources(
	testFn: (ctx: TestContext) => Promise<void>,
	options: WithTestResourcesOptions = {},
): Promise<void> {
	const resources: TestResources = {};
	const config = getTestConfig();
	const octokit = getOctokit();

	try {
		// Step 1: Create test branch
		const runId = process.env.GITHUB_RUN_ID ?? "local";
		resources.branchName = await createTestBranch(runId);

		// Step 2: Create test PR
		const prResult = await createTestPullRequest({
			head: resources.branchName,
			base: options.baseBranch ?? config.baseBranch ?? "main",
			title: options.prTitle ?? `[TEST] Auto-cleanup test - ${Date.now()}`,
			body:
				options.prBody ??
				"Automated test PR with guaranteed cleanup.\n\nThis PR will be automatically closed and its branch deleted after the test completes.",
		});
		resources.prNumber = prResult.number;

		// Step 3: Execute test with context
		const ctx: TestContext = {
			branchName: resources.branchName,
			prNumber: resources.prNumber,
			prUrl: prResult.url,
			config,
			octokit,
		};

		await testFn(ctx);
	} finally {
		// Step 4: ALWAYS clean up, regardless of test outcome
		await cleanupTestResources(resources);
	}
}

/**
 * Clean up test resources safely.
 *
 * This function:
 * 1. Closes the PR (if created)
 * 2. Deletes the branch (if created)
 * 3. Logs warnings but doesn't throw on cleanup failures
 *
 * @param resources - Resources to clean up
 */
export async function cleanupTestResources(
	resources: TestResources,
): Promise<void> {
	// Close PR first (must be done before branch deletion for some workflows)
	if (resources.prNumber !== undefined) {
		try {
			await closeTestPullRequest(resources.prNumber);
		} catch (error) {
			// Log but don't throw - we still want to try branch cleanup
			console.warn(`Failed to close PR #${resources.prNumber}:`, error);
		}
	}

	// Delete branch
	if (resources.branchName !== undefined) {
		try {
			await cleanupTestBranch(resources.branchName);
		} catch (error) {
			// Log but don't throw - cleanup is best-effort
			console.warn(`Failed to delete branch ${resources.branchName}:`, error);
		}
	}
}

/**
 * Create test resources without executing a test.
 *
 * Use this when you need more control over the test lifecycle,
 * but remember to call cleanupTestResources in a finally block!
 *
 * @param options - Optional configuration for resource creation
 * @returns TestContext with created resources
 *
 * @example
 * ```typescript
 * let resources: TestResources = {};
 * try {
 *   const ctx = await createTestResourcesManually();
 *   resources = { branchName: ctx.branchName, prNumber: ctx.prNumber };
 *   // ... run test ...
 * } finally {
 *   await cleanupTestResources(resources);
 * }
 * ```
 */
export async function createTestResourcesManually(
	options: WithTestResourcesOptions = {},
): Promise<TestContext> {
	const config = getTestConfig();
	const octokit = getOctokit();

	// Create test branch
	const runId = process.env.GITHUB_RUN_ID ?? "local";
	const branchName = await createTestBranch(runId);

	// Create test PR
	const prResult = await createTestPullRequest({
		head: branchName,
		base: options.baseBranch ?? config.baseBranch ?? "main",
		title: options.prTitle ?? `[TEST] Manual cleanup test - ${Date.now()}`,
		body:
			options.prBody ??
			"Automated test PR.\n\nRemember to clean up this PR and branch after the test!",
	});

	return {
		branchName,
		prNumber: prResult.number,
		prUrl: prResult.url,
		config,
		octokit,
	};
}
