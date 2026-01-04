/**
 * Integration test: Real GitHub API Checkbox Revert Flow
 *
 * Tests the checkbox untoggle -> revert flow using the real GitHub API.
 * This test verifies:
 * 1. Creating a branch and PR with an intent layer comment
 * 2. Simulating checkbox check by creating a file (intent applied)
 * 3. Simulating checkbox uncheck by updating the comment
 * 4. Verifying file is reverted to pre-commit state via GitHub API
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
	addRevertedStatus,
	clearCommentMarkerAppliedCommit,
	generateComment,
	hasIntentLayerMarker,
	parseCommentMarker,
	updateCommentMarkerWithCommit,
} from "../../src/github/comments";
import {
	generateAddCommitMessage,
	generateRevertCommitMessage,
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

describe("Real GitHub API: Checkbox Revert Flow", () => {
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
		"checkbox untoggle reverts file to pre-commit state",
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
				title: `[TEST] Checkbox Revert Flow - ${Date.now()}`,
				body: "Automated test PR for verifying checkbox revert flow.\n\nThis PR will be automatically cleaned up.",
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
			const testPath = `test-fixtures/revert-test-${Date.now()}/AGENTS.md`;
			const intentUpdate: IntentUpdate = {
				nodePath: testPath,
				action: "create",
				reason: "Test checkbox revert flow integration test",
				currentContent: undefined,
				suggestedContent:
					"# Test Intent Layer\n\nThis file was created by the checkbox revert flow integration test.\n\n## Purpose\n\nVerify that the checkbox untoggle correctly reverts files via the GitHub API.",
			};

			// Step 5: Post an intent layer comment (unchecked initially)
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

			// Step 6: Simulate checkbox checked -> create the file (like handleCheckedCheckbox does)
			const commitMessage = generateAddCommitMessage(
				testPath,
				intentUpdate.reason,
			);

			const { data: addCommitResult } =
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

			expect(addCommitResult.commit.sha).toBeDefined();
			const appliedCommitSha = addCommitResult.commit.sha ?? "";

			// Step 7: Update the comment marker to reflect the applied commit
			let updatedBody = updateCommentMarkerWithCommit(
				createdComment.body ?? "",
				appliedCommitSha,
			);
			updatedBody = addCommittedStatus(updatedBody, appliedCommitSha);

			const { data: commentAfterApply } =
				await octokit.rest.issues.updateComment({
					owner: config.owner,
					repo: config.repo,
					comment_id: createdComment.id,
					body: updatedBody,
				});

			// Verify the comment now has appliedCommit
			const markerAfterApply = parseCommentMarker(commentAfterApply.body ?? "");
			expect(markerAfterApply).not.toBeNull();
			expect(markerAfterApply?.appliedCommit).toBe(appliedCommitSha);

			// Step 8: Verify the file exists before revert
			const { data: fileBeforeRevert } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});
			expect(fileBeforeRevert).toBeDefined();

			// Step 9: Now simulate the checkbox being unchecked -> revert
			// Get the parent commit of the appliedCommit
			const { data: appliedCommitData } = await octokit.rest.git.getCommit({
				owner: config.owner,
				repo: config.repo,
				commit_sha: appliedCommitSha,
			});

			expect(appliedCommitData.parents.length).toBeGreaterThan(0);
			const parentSha = appliedCommitData.parents[0]?.sha;
			expect(parentSha).toBeDefined();

			// Step 10: Check if file existed at parent commit (it shouldn't since we created it)
			let fileExistedBefore = false;
			try {
				await octokit.rest.repos.getContent({
					owner: config.owner,
					repo: config.repo,
					path: testPath,
					ref: parentSha,
				});
				fileExistedBefore = true;
			} catch (error) {
				// File didn't exist at parent commit - expected for create action
				if (
					error &&
					typeof error === "object" &&
					"status" in error &&
					error.status === 404
				) {
					fileExistedBefore = false;
				} else {
					throw error;
				}
			}

			expect(fileExistedBefore).toBe(false);

			// Step 11: Since file didn't exist before, revert means deleting it
			// Get current file SHA for deletion
			const { data: currentFileData } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});
			const currentFileSha =
				"sha" in currentFileData ? currentFileData.sha : undefined;
			expect(currentFileSha).toBeDefined();

			const revertMessage = generateRevertCommitMessage(
				testPath,
				"Reverted via checkbox",
			);

			const { data: revertCommitResult } = await octokit.rest.repos.deleteFile({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				message: revertMessage,
				branch: branchName,
				sha: currentFileSha ?? "",
			});

			expect(revertCommitResult.commit.sha).toBeDefined();
			const revertCommitSha = revertCommitResult.commit.sha ?? "";

			// Step 12: Update the comment to clear appliedCommit and add REVERTED status
			let revertedBody = clearCommentMarkerAppliedCommit(
				commentAfterApply.body ?? "",
			);
			revertedBody = addRevertedStatus(revertedBody, revertCommitSha);

			const { data: commentAfterRevert } =
				await octokit.rest.issues.updateComment({
					owner: config.owner,
					repo: config.repo,
					comment_id: createdComment.id,
					body: revertedBody,
				});

			// Step 13: Verify the comment reflects the revert
			expect(commentAfterRevert.body).toContain("**REVERTED**");
			expect(commentAfterRevert.body).toContain(
				revertCommitSha.substring(0, 7),
			);

			const markerAfterRevert = parseCommentMarker(
				commentAfterRevert.body ?? "",
			);
			expect(markerAfterRevert).not.toBeNull();
			expect(markerAfterRevert?.appliedCommit).toBeUndefined();

			// Step 14: Verify the file no longer exists
			let fileExistsAfterRevert = true;
			try {
				await octokit.rest.repos.getContent({
					owner: config.owner,
					repo: config.repo,
					path: testPath,
					ref: branchName,
				});
			} catch (error) {
				if (
					error &&
					typeof error === "object" &&
					"status" in error &&
					error.status === 404
				) {
					fileExistsAfterRevert = false;
				} else {
					throw error;
				}
			}

			expect(fileExistsAfterRevert).toBe(false);

			// Step 15: Verify commit messages are correct
			expect(revertMessage).toContain("[INTENT:REVERT]");
			expect(revertMessage).toContain(testPath);
		},
		// Allow 120 seconds for this test as it involves many API calls
		120000,
	);

	test.skipIf(SKIP_TESTS)(
		"checkbox untoggle restores file content when file existed before",
		async () => {
			if (!octokit || !config || !branchName || !prNumber) {
				throw new Error("Test setup failed or previous test did not run");
			}

			// This test verifies the revert flow for UPDATE actions
			// where the file existed before and should be restored to its previous content

			// Step 1: Create an initial file on the branch
			const testPath = `test-fixtures/update-revert-test-${Date.now()}/AGENTS.md`;
			const originalContent =
				"# Original Content\n\nThis is the original file content before the intent update.";

			const { data: initialFileResult } =
				await octokit.rest.repos.createOrUpdateFileContents({
					owner: config.owner,
					repo: config.repo,
					path: testPath,
					message: "Initial file for update-revert test",
					content: Buffer.from(originalContent).toString("base64"),
					branch: branchName,
				});

			expect(initialFileResult.commit.sha).toBeDefined();
			const initialFileSha = initialFileResult.content?.sha ?? "";

			// Step 2: Simulate an intent UPDATE by modifying the file
			const updatedContent =
				"# Updated Content\n\nThis is the updated file content from the intent layer suggestion.";

			const { data: updateCommitResult } =
				await octokit.rest.repos.createOrUpdateFileContents({
					owner: config.owner,
					repo: config.repo,
					path: testPath,
					message: `[INTENT:UPDATE] ${testPath} - Test update`,
					content: Buffer.from(updatedContent).toString("base64"),
					branch: branchName,
					sha: initialFileSha,
				});

			expect(updateCommitResult.commit.sha).toBeDefined();
			const updateCommitSha = updateCommitResult.commit.sha ?? "";

			// Step 3: Verify the file has the updated content
			const { data: fileAfterUpdate } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});

			expect("content" in fileAfterUpdate).toBe(true);
			if ("content" in fileAfterUpdate && fileAfterUpdate.content) {
				const decodedContent = Buffer.from(
					fileAfterUpdate.content,
					"base64",
				).toString("utf-8");
				expect(decodedContent).toContain("Updated Content");
			}

			// Step 4: Get the parent commit (before the update)
			const { data: updateCommitData } = await octokit.rest.git.getCommit({
				owner: config.owner,
				repo: config.repo,
				commit_sha: updateCommitSha,
			});

			const parentSha = updateCommitData.parents[0]?.sha;
			expect(parentSha).toBeDefined();

			// Step 5: Get the file content from the parent commit
			const { data: fileAtParent } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: parentSha,
			});

			let previousContent = "";
			if ("content" in fileAtParent && fileAtParent.content) {
				previousContent = Buffer.from(fileAtParent.content, "base64").toString(
					"utf-8",
				);
			}

			expect(previousContent).toBe(originalContent);

			// Step 6: Perform the revert by restoring the previous content
			// Get current file SHA for update
			const { data: currentFileData } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});
			const currentFileSha =
				"sha" in currentFileData ? currentFileData.sha : undefined;
			expect(currentFileSha).toBeDefined();

			const revertMessage = generateRevertCommitMessage(
				testPath,
				"Reverted via checkbox",
			);

			const { data: revertResult } =
				await octokit.rest.repos.createOrUpdateFileContents({
					owner: config.owner,
					repo: config.repo,
					path: testPath,
					message: revertMessage,
					content: Buffer.from(previousContent).toString("base64"),
					branch: branchName,
					sha: currentFileSha,
				});

			expect(revertResult.commit.sha).toBeDefined();

			// Step 7: Verify the file now has the original content
			const { data: fileAfterRevert } = await octokit.rest.repos.getContent({
				owner: config.owner,
				repo: config.repo,
				path: testPath,
				ref: branchName,
			});

			expect("content" in fileAfterRevert).toBe(true);
			if ("content" in fileAfterRevert && fileAfterRevert.content) {
				const decodedContent = Buffer.from(
					fileAfterRevert.content,
					"base64",
				).toString("utf-8");
				expect(decodedContent).toBe(originalContent);
			}
		},
		90000,
	);
});
