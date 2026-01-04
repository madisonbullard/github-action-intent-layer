/**
 * Integration test: Real GitHub API PR Comment Flow
 *
 * Tests the PR comment posting and retrieval flow using the real GitHub API.
 * This test verifies:
 * 1. Comments can be posted to a PR with intent layer markers
 * 2. Comments can be retrieved and parsed correctly
 * 3. Comment markers are preserved and parseable
 *
 * IMPORTANT: This test creates real resources (branches, PRs, comments) in the repository.
 * It should ONLY run when explicitly opted in via:
 * - CI: workflow_dispatch with run_github_tests=true
 * - Local: RUN_REAL_GITHUB_TESTS=true environment variable
 *
 * Required Environment Variables:
 * - GITHUB_TOKEN: A token with repo permissions
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as github from "@actions/github";
import {
	generateComment,
	hasIntentLayerMarker,
	parseCommentMarker,
} from "../../src/github/comments";
import type { IntentUpdate } from "../../src/opencode/output-schema";
import {
	cleanupTestBranch,
	closeTestPullRequest,
	createTestBranch,
	createTestPullRequest,
	getTestConfig,
	shouldSkipRealTests,
	waitForComment,
} from "./setup";

/**
 * Skip all tests if not explicitly opted in.
 */
const SKIP_TESTS = shouldSkipRealTests();

describe("Real GitHub API: PR Comment Flow", () => {
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
		"can post and retrieve intent layer comment on PR",
		async () => {
			if (!octokit || !config) {
				throw new Error("Test setup failed - missing octokit or config");
			}

			// Step 1: Create a test branch
			const runId = process.env.GITHUB_RUN_ID ?? "local";
			branchName = await createTestBranch(runId);
			expect(branchName).toMatch(/^test-fixture\//);

			// Step 2: Create a test PR
			const prResult = await createTestPullRequest({
				head: branchName,
				base: config.baseBranch ?? "main",
				title: `[TEST] PR Comment Flow - ${Date.now()}`,
				body: "Automated test PR for verifying comment posting flow.\n\nThis PR will be automatically cleaned up.",
			});
			prNumber = prResult.number;
			expect(prNumber).toBeGreaterThan(0);

			// Step 3: Get the PR to retrieve head SHA
			const { data: pr } = await octokit.rest.pulls.get({
				owner: config.owner,
				repo: config.repo,
				pull_number: prNumber,
			});
			const headSha = pr.head.sha;

			// Step 4: Create an intent update and generate a comment
			const intentUpdate: IntentUpdate = {
				nodePath: "test/AGENTS.md",
				action: "create",
				reason: "Test comment for PR comment flow integration test",
				currentContent: undefined,
				suggestedContent:
					"# Test Intent Layer\n\nThis is test content for the PR comment flow integration test.",
			};

			const commentBody = generateComment(intentUpdate, headSha, {
				includeCheckbox: true,
			});

			// Step 5: Post the comment
			const { data: createdComment } = await octokit.rest.issues.createComment({
				owner: config.owner,
				repo: config.repo,
				issue_number: prNumber,
				body: commentBody,
			});

			expect(createdComment.id).toBeGreaterThan(0);
			expect(createdComment.body).toBeDefined();

			// Step 6: Verify the comment has the intent layer marker
			expect(hasIntentLayerMarker(createdComment.body ?? "")).toBe(true);

			// Step 7: Parse and verify the marker data
			const markerData = parseCommentMarker(createdComment.body ?? "");
			expect(markerData).not.toBeNull();
			expect(markerData?.nodePath).toBe("test/AGENTS.md");
			expect(markerData?.headSha).toBe(headSha);
			expect(markerData?.appliedCommit).toBeUndefined();

			// Step 8: Retrieve comments and verify our comment is there
			const { data: comments } = await octokit.rest.issues.listComments({
				owner: config.owner,
				repo: config.repo,
				issue_number: prNumber,
			});

			const foundComment = comments.find(
				(c) => c.body && hasIntentLayerMarker(c.body),
			);
			expect(foundComment).toBeDefined();
			expect(foundComment?.id).toBe(createdComment.id);

			// Step 9: Verify waitForComment helper works
			const waitResult = await waitForComment(
				prNumber,
				/INTENT_LAYER/,
				5000, // Short timeout since comment already exists
			);
			expect(waitResult.id).toBe(createdComment.id);
			expect(waitResult.body).toContain("test/AGENTS.md");
		},
		// Allow 60 seconds for this test as it involves multiple API calls
		60000,
	);

	test.skipIf(SKIP_TESTS)(
		"can update an existing intent layer comment",
		async () => {
			if (!octokit || !config || !prNumber) {
				throw new Error("Test setup failed or previous test did not run");
			}

			// Get the existing comment
			const { data: comments } = await octokit.rest.issues.listComments({
				owner: config.owner,
				repo: config.repo,
				issue_number: prNumber,
			});

			const existingComment = comments.find(
				(c) => c.body && hasIntentLayerMarker(c.body),
			);
			if (!existingComment) {
				throw new Error("No existing intent layer comment found");
			}

			// Get PR head SHA
			const { data: pr } = await octokit.rest.pulls.get({
				owner: config.owner,
				repo: config.repo,
				pull_number: prNumber,
			});

			// Create an updated comment with appliedCommit set
			const updatedIntentUpdate: IntentUpdate = {
				nodePath: "test/AGENTS.md",
				action: "update",
				reason: "Updated test comment",
				currentContent: "# Old Content",
				suggestedContent: "# Updated Test Intent Layer\n\nUpdated content.",
			};

			const updatedCommentBody = generateComment(
				updatedIntentUpdate,
				pr.head.sha,
				{ includeCheckbox: true },
			);

			// Update the comment
			const { data: updatedComment } = await octokit.rest.issues.updateComment({
				owner: config.owner,
				repo: config.repo,
				comment_id: existingComment.id,
				body: updatedCommentBody,
			});

			expect(updatedComment.id).toBe(existingComment.id);
			expect(updatedComment.body).toContain("Updated Test Intent Layer");

			// Verify the marker is still valid
			const markerData = parseCommentMarker(updatedComment.body ?? "");
			expect(markerData).not.toBeNull();
			expect(markerData?.nodePath).toBe("test/AGENTS.md");
		},
		30000,
	);

	test.skipIf(SKIP_TESTS)(
		"waitForComment times out when pattern not found",
		async () => {
			if (!prNumber) {
				throw new Error("Test setup failed or previous test did not run");
			}

			// Try to wait for a pattern that doesn't exist
			await expect(
				waitForComment(
					prNumber,
					/NONEXISTENT_PATTERN_12345/,
					2000, // Very short timeout
				),
			).rejects.toThrow(/Timeout waiting for comment/);
		},
		10000,
	);
});
