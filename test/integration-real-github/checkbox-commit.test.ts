/**
 * Integration test: Real GitHub API Checkbox Commit Flow
 *
 * Tests the checkbox toggle → commit flow using the real GitHub API.
 * This test verifies:
 * 1. Creating a branch and PR with an intent layer comment
 * 2. Simulating checkbox check by updating the comment
 * 3. Verifying commit creation via GitHub API
 *
 * IMPORTANT: This test creates real resources (branches, PRs, files, commits) in the repository.
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
	addCommittedStatus,
	generateComment,
	hasIntentLayerMarker,
	parseCommentMarker,
	updateCommentMarkerWithCommit,
} from "../../src/github/comments";
import {
	createIntentAddCommit,
	generateAddCommitMessage,
	getFileSha,
} from "../../src/github/commits";
import type { IntentUpdate } from "../../src/opencode/output-schema";
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

/**
 * Create a GitHubClient-like object from raw Octokit.
 * This adapts the Octokit client to match the GitHubClient interface.
 */
function createClientAdapter(
	octokit: ReturnType<typeof github.getOctokit>,
	owner: string,
	repo: string,
) {
	return {
		getFileContent: async (path: string, ref?: string) => {
			const { data } = await octokit.rest.repos.getContent({
				owner,
				repo,
				path,
				ref,
			});
			return data;
		},
		createOrUpdateFile: async (
			path: string,
			content: string,
			message: string,
			branch: string,
			sha?: string,
		) => {
			const { data } = await octokit.rest.repos.createOrUpdateFileContents({
				owner,
				repo,
				path,
				message,
				content: Buffer.from(content).toString("base64"),
				branch,
				sha,
			});
			return data;
		},
		updateComment: async (commentId: number, body: string) => {
			const { data } = await octokit.rest.issues.updateComment({
				owner,
				repo,
				comment_id: commentId,
				body,
			});
			return data;
		},
		getComment: async (commentId: number) => {
			const { data } = await octokit.rest.issues.getComment({
				owner,
				repo,
				comment_id: commentId,
			});
			return data;
		},
		// Required by getFileSha but not all methods needed
		repo: { owner, repo },
	};
}

describe("Real GitHub API: Checkbox Commit Flow", () => {
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
		"checkbox toggle creates intent commit on PR branch",
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
				title: `[TEST] Checkbox Commit Flow - ${Date.now()}`,
				body: "Automated test PR for verifying checkbox commit flow.\n\nThis PR will be automatically cleaned up.",
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

			// Step 4: Create an intent update for a new file
			const testPath = `test-fixtures/checkbox-test-${Date.now()}/AGENTS.md`;
			const intentUpdate: IntentUpdate = {
				nodePath: testPath,
				action: "create",
				reason: "Test checkbox commit flow integration test",
				currentContent: undefined,
				suggestedContent:
					"# Test Intent Layer\n\nThis file was created by the checkbox commit flow integration test.\n\n## Purpose\n\nVerify that the checkbox toggle correctly creates commits via the GitHub API.",
			};

			// Step 5: Post an intent layer comment (unchecked)
			const commentBody = generateComment(intentUpdate, headSha, {
				includeCheckbox: true,
			});

			const { data: createdComment } = await octokit.rest.issues.createComment({
				owner: config.owner,
				repo: config.repo,
				issue_number: prNumber,
				body: commentBody,
			});

			expect(createdComment.id).toBeGreaterThan(0);
			expect(hasIntentLayerMarker(createdComment.body ?? "")).toBe(true);

			// Step 6: Verify the marker is parseable
			const markerData = parseCommentMarker(createdComment.body ?? "");
			expect(markerData).not.toBeNull();
			expect(markerData?.nodePath).toBe(testPath);
			expect(markerData?.headSha).toBe(headSha);
			expect(markerData?.appliedCommit).toBeUndefined();

			// Step 7: Simulate checkbox being checked by creating the file
			// (In real usage, this would be done by handleCheckedCheckbox)
			// We're testing the low-level commit creation here
			const client = createClientAdapter(octokit, config.owner, config.repo);

			// Verify file doesn't exist yet
			const existingSha = await getFileSha(
				client as Parameters<typeof getFileSha>[0],
				testPath,
				branchName,
			);
			expect(existingSha).toBeUndefined();

			// Create the file (simulating what handleCheckedCheckbox does)
			const commitMessage = generateAddCommitMessage(
				testPath,
				intentUpdate.reason,
			);

			const { data: commitResult } =
				await octokit.rest.repos.createOrUpdateFileContents({
					owner: config.owner,
					repo: config.repo,
					path: testPath,
					message: commitMessage,
					content: Buffer.from(intentUpdate.suggestedContent ?? "").toString(
						"base64",
					),
					branch: branchName,
				});

			expect(commitResult.commit.sha).toBeDefined();
			expect(commitResult.commit.message).toContain("[INTENT:ADD]");
			expect(commitResult.commit.message).toContain(testPath);

			// Step 8: Update the comment marker with the applied commit
			let updatedBody = updateCommentMarkerWithCommit(
				createdComment.body ?? "",
				commitResult.commit.sha ?? "",
			);
			updatedBody = addCommittedStatus(
				updatedBody,
				commitResult.commit.sha ?? "",
			);

			const { data: updatedComment } = await octokit.rest.issues.updateComment({
				owner: config.owner,
				repo: config.repo,
				comment_id: createdComment.id,
				body: updatedBody,
			});

			// Step 9: Verify the comment was updated correctly
			expect(updatedComment.body).toContain("appliedCommit=");
			expect(updatedComment.body).toContain("COMMITTED");

			const updatedMarker = parseCommentMarker(updatedComment.body ?? "");
			expect(updatedMarker).not.toBeNull();
			expect(updatedMarker?.appliedCommit).toBe(commitResult.commit.sha);

			// Step 10: Verify the file was actually created
			const { data: fileContent } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});

			expect(fileContent).toBeDefined();
			expect("content" in fileContent).toBe(true);
			if ("content" in fileContent && fileContent.content) {
				const decodedContent = Buffer.from(
					fileContent.content,
					"base64",
				).toString("utf-8");
				expect(decodedContent).toContain("Test Intent Layer");
				expect(decodedContent).toContain("checkbox commit flow");
			}

			// Step 11: Verify the PR now has a new commit
			const { data: prAfterCommit } = await octokit.rest.pulls.get({
				owner: config.owner,
				repo: config.repo,
				pull_number: prNumber,
			});

			// The head SHA should have changed after the commit
			expect(prAfterCommit.head.sha).not.toBe(headSha);

			// List commits to verify our commit is there
			const { data: commits } = await octokit.rest.pulls.listCommits({
				owner: config.owner,
				repo: config.repo,
				pull_number: prNumber,
			});

			const intentCommit = commits.find(
				(c) => c.sha === commitResult.commit.sha,
			);
			expect(intentCommit).toBeDefined();
			expect(intentCommit?.commit.message).toContain("[INTENT:ADD]");
		},
		// Allow 90 seconds for this test as it involves multiple API calls
		90000,
	);

	test.skipIf(SKIP_TESTS)(
		"createIntentAddCommit works with real GitHub API",
		async () => {
			if (!octokit || !config || !branchName || !prNumber) {
				throw new Error("Test setup failed or previous test did not run");
			}

			// Create a new file using the high-level createIntentAddCommit function
			const testPath = `test-fixtures/high-level-test-${Date.now()}/AGENTS.md`;
			const intentUpdate: IntentUpdate = {
				nodePath: testPath,
				action: "create",
				reason: "High-level API test",
				currentContent: undefined,
				suggestedContent:
					"# High-Level Test\n\nCreated using createIntentAddCommit function.",
			};

			// Create a client adapter
			const client = createClientAdapter(octokit, config.owner, config.repo);

			// Use the high-level function
			const result = await createIntentAddCommit(
				client as Parameters<typeof createIntentAddCommit>[0],
				intentUpdate,
				{ branch: branchName },
			);

			expect(result.sha).toBeDefined();
			expect(result.sha.length).toBeGreaterThan(0);
			expect(result.message).toContain("[INTENT:ADD]");
			expect(result.message).toContain(testPath);
			expect(result.filePath).toBe(testPath);

			// Verify the file exists
			const { data: fileContent } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});

			expect(fileContent).toBeDefined();
			if ("content" in fileContent && fileContent.content) {
				const decodedContent = Buffer.from(
					fileContent.content,
					"base64",
				).toString("utf-8");
				expect(decodedContent).toContain("High-Level Test");
			}
		},
		60000,
	);
});
