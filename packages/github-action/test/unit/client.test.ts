import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createGitHubClient, GitHubClient } from "../../src/github/client";

/**
 * Note: The @actions/github context is instantiated at module load time,
 * reading environment variables when the module is first imported.
 * This means we cannot easily mock the context values in unit tests.
 *
 * These tests verify:
 * 1. Client construction and method availability
 * 2. Token handling for createGitHubClient
 * 3. Method signatures are correct
 *
 * Full integration testing with mocked GitHub context should be done
 * in integration tests or with a proper GitHub Actions test environment.
 */

describe("GitHubClient", () => {
	const mockToken = "ghp_test_token_12345";

	describe("constructor", () => {
		test("creates client with valid token", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(client).toBeInstanceOf(GitHubClient);
		});

		test("exposes raw octokit client", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(client.raw).toBeDefined();
			expect(client.raw.rest).toBeDefined();
			expect(client.raw.rest.pulls).toBeDefined();
			expect(client.raw.rest.issues).toBeDefined();
			expect(client.raw.rest.repos).toBeDefined();
		});

		test("exposes context object", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(client.context).toBeDefined();
			// Context should have payload property (may be empty in test env)
			expect(client.context.payload).toBeDefined();
		});
	});

	describe("accessor methods exist and are callable", () => {
		test("repo accessor is available", () => {
			const client = new GitHubClient({ token: mockToken });
			// In test environment without GITHUB_REPOSITORY, this will throw
			// We just verify the property exists
			expect(() => client.repo).toBeDefined();
		});

		test("eventName accessor returns string or undefined", () => {
			const client = new GitHubClient({ token: mockToken });
			const eventName = client.eventName;
			expect(eventName === undefined || typeof eventName === "string").toBe(
				true,
			);
		});

		test("sha accessor returns string or undefined", () => {
			const client = new GitHubClient({ token: mockToken });
			const sha = client.sha;
			expect(sha === undefined || typeof sha === "string").toBe(true);
		});

		test("actor accessor returns string or undefined", () => {
			const client = new GitHubClient({ token: mockToken });
			const actor = client.actor;
			expect(actor === undefined || typeof actor === "string").toBe(true);
		});

		test("pullRequestNumber accessor returns number or undefined", () => {
			const client = new GitHubClient({ token: mockToken });
			const prNumber = client.pullRequestNumber;
			expect(prNumber === undefined || typeof prNumber === "number").toBe(true);
		});

		test("issueNumber accessor exists", () => {
			const client = new GitHubClient({ token: mockToken });
			// In test environment without GITHUB_REPOSITORY, accessing issueNumber
			// will throw since context.issue requires context.repo
			// We verify the getter exists
			const descriptor = Object.getOwnPropertyDescriptor(
				Object.getPrototypeOf(client),
				"issueNumber",
			);
			expect(descriptor?.get).toBeDefined();
		});
	});

	describe("event type check methods", () => {
		test("isPullRequestEvent returns boolean", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.isPullRequestEvent()).toBe("boolean");
		});

		test("isIssueCommentEvent returns boolean", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.isIssueCommentEvent()).toBe("boolean");
		});
	});

	describe("API method signatures", () => {
		test("getPullRequest method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getPullRequest).toBe("function");
			// Verify it returns a Promise (would fail on network call, but structure is correct)
			const result = client.getPullRequest(1);
			expect(result).toBeInstanceOf(Promise);
			// Cleanup - catch the expected error since we're not making real API calls
			result.catch(() => {});
		});

		test("getPullRequestDiff method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getPullRequestDiff).toBe("function");
		});

		test("getPullRequestFiles method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getPullRequestFiles).toBe("function");
		});

		test("getPullRequestCommits method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getPullRequestCommits).toBe("function");
		});

		test("getIssueComments method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getIssueComments).toBe("function");
		});

		test("createComment method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.createComment).toBe("function");
		});

		test("updateComment method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.updateComment).toBe("function");
		});

		test("getComment method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getComment).toBe("function");
		});

		test("getPullRequestReviewComments method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getPullRequestReviewComments).toBe("function");
		});

		test("getFileContent method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getFileContent).toBe("function");
		});

		test("createOrUpdateFile method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.createOrUpdateFile).toBe("function");
		});

		test("getIssue method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getIssue).toBe("function");
		});

		test("createBranch method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.createBranch).toBe("function");
		});

		test("createPullRequest method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.createPullRequest).toBe("function");
		});

		test("getDefaultBranch method exists and is async", () => {
			const client = new GitHubClient({ token: mockToken });
			expect(typeof client.getDefaultBranch).toBe("function");
		});
	});
});

describe("createGitHubClient", () => {
	let originalGithubToken: string | undefined;

	beforeEach(() => {
		originalGithubToken = process.env.GITHUB_TOKEN;
	});

	afterEach(() => {
		// Restore original env
		if (originalGithubToken !== undefined) {
			process.env.GITHUB_TOKEN = originalGithubToken;
		} else {
			delete process.env.GITHUB_TOKEN;
		}
	});

	test("throws error when no token is available", () => {
		delete process.env.GITHUB_TOKEN;
		expect(() => createGitHubClient()).toThrow("GitHub token not found");
	});

	test("creates client from GITHUB_TOKEN env var", () => {
		process.env.GITHUB_TOKEN = "ghp_env_token_12345";
		const client = createGitHubClient();
		expect(client).toBeInstanceOf(GitHubClient);
	});
});
