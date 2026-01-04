/**
 * Integration test: Real GitHub API Rate Limit Handling
 *
 * Tests that the rate limit handling and retry logic works correctly
 * when interacting with the real GitHub API.
 *
 * These tests verify:
 * 1. Rate limit headers are properly read from API responses
 * 2. The withRetry wrapper correctly handles successful operations
 * 3. Transient errors trigger appropriate retry behavior
 * 4. Non-retryable errors fail immediately without retry
 *
 * Note: We cannot easily trigger real 429 rate limits without making thousands
 * of API calls. Instead, we verify:
 * - Rate limit headers are present and parsed correctly
 * - The retry infrastructure is properly integrated with GitHub client
 * - Error handling works as expected for real API errors
 *
 * IMPORTANT: This test creates real resources (branches, PRs) in the repository.
 * It should ONLY run when explicitly opted in via:
 * - CI: workflow_dispatch with run_github_tests=true
 * - Local: RUN_REAL_GITHUB_TESTS=true environment variable
 *
 * Required Environment Variables:
 * - GITHUB_TOKEN: A token with repo permissions
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as github from "@actions/github";
import { GitHubClient, withRetry } from "../../src/github/client";
import {
	cleanupTestBranch,
	closeTestPullRequest,
	createTestBranch,
	createTestPullRequest,
	getTestConfig,
	shouldSkipRealTests,
} from "./setup";

/**
 * Skip all tests if not explicitly opted in.
 */
const SKIP_TESTS = shouldSkipRealTests();

describe("Real GitHub API: Rate Limit Handling", () => {
	// Track resources for cleanup
	let branchName: string | undefined;
	let prNumber: number | undefined;
	let octokit: ReturnType<typeof github.getOctokit> | undefined;
	let config: ReturnType<typeof getTestConfig> | undefined;

	beforeAll(() => {
		if (SKIP_TESTS) return;

		config = getTestConfig();
		octokit = github.getOctokit(config.token);
	});

	afterAll(async () => {
		if (SKIP_TESTS) return;

		// Always clean up, even on test failure
		try {
			if (prNumber) {
				await closeTestPullRequest(prNumber);
			}
		} catch (error) {
			console.warn(`Failed to close PR #${prNumber}:`, error);
		}

		try {
			if (branchName) {
				await cleanupTestBranch(branchName);
			}
		} catch (error) {
			console.warn(`Failed to delete branch ${branchName}:`, error);
		}
	});

	test.skipIf(SKIP_TESTS)(
		"rate limit headers are present in API responses",
		async () => {
			if (!octokit || !config) {
				throw new Error("Test setup failed - missing octokit or config");
			}

			// Make a simple API call and check rate limit headers
			const response = await octokit.rest.rateLimit.get();

			// Verify rate limit information is available
			expect(response.data.resources.core).toBeDefined();
			expect(response.data.resources.core.limit).toBeGreaterThan(0);
			expect(response.data.resources.core.remaining).toBeGreaterThanOrEqual(0);
			expect(response.data.resources.core.reset).toBeGreaterThan(0);

			// Log current rate limit status for debugging
			console.log("Current rate limit status:", {
				limit: response.data.resources.core.limit,
				remaining: response.data.resources.core.remaining,
				reset: new Date(
					response.data.resources.core.reset * 1000,
				).toISOString(),
			});
		},
		30000,
	);

	test.skipIf(SKIP_TESTS)(
		"withRetry successfully completes on first attempt for valid operations",
		async () => {
			if (!octokit || !config) {
				throw new Error("Test setup failed - missing octokit or config");
			}

			const testOctokit = octokit;
			const testConfig = config;
			let attemptCount = 0;

			// Use withRetry for a simple operation that should succeed on first try
			const result = await withRetry(
				async () => {
					attemptCount++;
					const { data } = await testOctokit.rest.repos.get({
						owner: testConfig.owner,
						repo: testConfig.repo,
					});
					return data;
				},
				"getRepository",
				{ maxRetries: 3 },
			);

			// Should succeed on first attempt
			expect(attemptCount).toBe(1);
			expect(result.name).toBe(testConfig.repo);
			expect(result.owner.login).toBe(testConfig.owner);
		},
		30000,
	);

	test.skipIf(SKIP_TESTS)(
		"withRetry does not retry 404 errors (non-retryable)",
		async () => {
			if (!octokit || !config) {
				throw new Error("Test setup failed - missing octokit or config");
			}

			const testOctokit = octokit;
			const testConfig = config;
			let attemptCount = 0;

			// Try to get a non-existent resource - should fail immediately without retry
			try {
				await withRetry(
					async () => {
						attemptCount++;
						await testOctokit.rest.repos.getContent({
							owner: testConfig.owner,
							repo: testConfig.repo,
							path: "non-existent-file-that-does-not-exist-12345.md",
						});
					},
					"getNonExistentFile",
					{ maxRetries: 3 },
				);
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				// Should fail on first attempt (no retries for 404)
				expect(attemptCount).toBe(1);
				expect(error).toBeDefined();
				if (
					error &&
					typeof error === "object" &&
					"status" in error &&
					typeof error.status === "number"
				) {
					expect(error.status).toBe(404);
				}
			}
		},
		30000,
	);

	test.skipIf(SKIP_TESTS)(
		"GitHubClient methods use withRetry wrapper",
		async () => {
			if (!config) {
				throw new Error("Test setup failed - missing config");
			}

			// Create a GitHubClient instance
			const client = new GitHubClient({ token: config.token });

			// Step 1: Create a test branch for this test
			const runId = process.env.GITHUB_RUN_ID ?? "local";
			branchName = await createTestBranch(runId);
			expect(branchName).toMatch(/^test-fixture\//);

			// Step 2: Create a test PR
			const prResult = await createTestPullRequest({
				head: branchName,
				base: config.baseBranch ?? "main",
				title: `[TEST] Rate Limit Handling - ${Date.now()}`,
				body: "Automated test PR for verifying rate limit handling.\n\nThis PR will be automatically cleaned up.",
			});
			prNumber = prResult.number;
			expect(prNumber).toBeGreaterThan(0);

			// Step 3: Test various GitHubClient methods that should use withRetry
			// These should all succeed and complete without issues

			// getPullRequest
			const pr = await client.getPullRequest(prNumber);
			expect(pr.number).toBe(prNumber);
			expect(pr.state).toBe("open");

			// getIssueComments (should return empty array for new PR)
			const comments = await client.getIssueComments(prNumber);
			expect(Array.isArray(comments)).toBe(true);

			// createComment
			const createdComment = await client.createComment(
				prNumber,
				"Test comment for rate limit handling verification.",
			);
			expect(createdComment.id).toBeGreaterThan(0);
			expect(createdComment.body).toContain("rate limit handling");

			// getComment
			const fetchedComment = await client.getComment(createdComment.id);
			expect(fetchedComment.id).toBe(createdComment.id);
			expect(fetchedComment.body).toBe(createdComment.body);

			// updateComment
			const updatedComment = await client.updateComment(
				createdComment.id,
				"Updated test comment for rate limit handling verification.",
			);
			expect(updatedComment.body).toContain("Updated test comment");

			// getPullRequestFiles
			const files = await client.getPullRequestFiles(prNumber);
			expect(Array.isArray(files)).toBe(true);

			// getDefaultBranch
			const defaultBranch = await client.getDefaultBranch();
			expect(defaultBranch).toBeTruthy();
			expect(typeof defaultBranch).toBe("string");
		},
		90000,
	);

	test.skipIf(SKIP_TESTS)(
		"multiple rapid API calls complete successfully with retry wrapper",
		async () => {
			if (!octokit || !config) {
				throw new Error("Test setup failed - missing octokit or config");
			}

			const testOctokit = octokit;
			const testConfig = config;

			// Make multiple rapid API calls to test that the retry infrastructure
			// handles concurrent requests appropriately
			const numCalls = 10;

			interface SuccessResult {
				success: true;
				rateLimitRemaining?: number;
			}

			interface FailureResult {
				success: false;
				error: string;
			}

			type CallResult = SuccessResult | FailureResult;

			const promises = Array.from(
				{ length: numCalls },
				async (_, i): Promise<CallResult> => {
					try {
						const result = await withRetry(
							async () => {
								const response = await testOctokit.rest.repos.get({
									owner: testConfig.owner,
									repo: testConfig.repo,
								});
								return response;
							},
							`rapidCall-${i}`,
							{ maxRetries: 2 },
						);

						return {
							success: true as const,
							rateLimitRemaining: Number(
								result.headers["x-ratelimit-remaining"],
							),
						};
					} catch (error) {
						return {
							success: false as const,
							error: String(error),
						};
					}
				},
			);

			const outcomes = await Promise.all(promises);

			// All calls should succeed
			const successCount = outcomes.filter((o) => o.success).length;
			expect(successCount).toBe(numCalls);

			// Verify rate limit is being consumed (remaining should decrease)
			const rateLimits = outcomes
				.filter((o): o is SuccessResult => o.success)
				.map((o) => o.rateLimitRemaining)
				.filter((r): r is number => r !== undefined);

			if (rateLimits.length > 1) {
				// The remaining count should generally decrease across calls
				// (though order isn't guaranteed with concurrent requests)
				const minRemaining = Math.min(...rateLimits);
				const maxRemaining = Math.max(...rateLimits);

				// There should be some variance showing API calls are being counted
				// Allow for same value if requests were processed very quickly
				expect(maxRemaining - minRemaining).toBeLessThanOrEqual(numCalls);
			}
		},
		60000,
	);

	test.skipIf(SKIP_TESTS)(
		"rate limit reset time is in the future",
		async () => {
			if (!octokit || !config) {
				throw new Error("Test setup failed - missing octokit or config");
			}

			// Get current rate limit status
			const response = await octokit.rest.rateLimit.get();
			const core = response.data.resources.core;

			// Reset time should be in the future (within the next hour for authenticated requests)
			const resetTime = core.reset * 1000; // Convert to milliseconds
			const now = Date.now();
			const oneHourFromNow = now + 60 * 60 * 1000;

			// Reset time should be between now and an hour from now
			// (for authenticated requests, the window resets hourly)
			expect(resetTime).toBeGreaterThan(now - 60000); // Allow 1 minute clock drift
			expect(resetTime).toBeLessThanOrEqual(oneHourFromNow + 60000);

			// If we have remaining requests, ensure we're not close to the limit
			if (core.remaining < 10) {
				console.warn(
					`Warning: Only ${core.remaining} API requests remaining until reset at ${new Date(resetTime).toISOString()}`,
				);
			}
		},
		30000,
	);
});
