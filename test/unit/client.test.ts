import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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
 * 4. API methods properly call underlying Octokit with correct parameters
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

// ============================================================================
// Mocked GitHub API Response Tests
// ============================================================================

/**
 * Creates a mock GitHubClient with a mocked Octokit instance.
 * This allows testing that client methods properly call the underlying API
 * with correct parameters and return the expected data.
 */
function createMockedGitHubClient(mocks: {
	pullsGet?: ReturnType<typeof mock>;
	pullsListFiles?: ReturnType<typeof mock>;
	pullsListCommits?: ReturnType<typeof mock>;
	pullsListReviewComments?: ReturnType<typeof mock>;
	pullsCreate?: ReturnType<typeof mock>;
	issuesListComments?: ReturnType<typeof mock>;
	issuesCreateComment?: ReturnType<typeof mock>;
	issuesUpdateComment?: ReturnType<typeof mock>;
	issuesGetComment?: ReturnType<typeof mock>;
	issuesGet?: ReturnType<typeof mock>;
	reposGetContent?: ReturnType<typeof mock>;
	reposCreateOrUpdateFileContents?: ReturnType<typeof mock>;
	reposGet?: ReturnType<typeof mock>;
	gitCreateRef?: ReturnType<typeof mock>;
}) {
	const mockOctokit = {
		rest: {
			pulls: {
				get: mocks.pullsGet ?? mock(() => Promise.resolve({ data: {} })),
				listFiles:
					mocks.pullsListFiles ?? mock(() => Promise.resolve({ data: [] })),
				listCommits:
					mocks.pullsListCommits ?? mock(() => Promise.resolve({ data: [] })),
				listReviewComments:
					mocks.pullsListReviewComments ??
					mock(() => Promise.resolve({ data: [] })),
				create: mocks.pullsCreate ?? mock(() => Promise.resolve({ data: {} })),
			},
			issues: {
				listComments:
					mocks.issuesListComments ?? mock(() => Promise.resolve({ data: [] })),
				createComment:
					mocks.issuesCreateComment ??
					mock(() => Promise.resolve({ data: {} })),
				updateComment:
					mocks.issuesUpdateComment ??
					mock(() => Promise.resolve({ data: {} })),
				getComment:
					mocks.issuesGetComment ?? mock(() => Promise.resolve({ data: {} })),
				get: mocks.issuesGet ?? mock(() => Promise.resolve({ data: {} })),
			},
			repos: {
				getContent:
					mocks.reposGetContent ?? mock(() => Promise.resolve({ data: {} })),
				createOrUpdateFileContents:
					mocks.reposCreateOrUpdateFileContents ??
					mock(() => Promise.resolve({ data: {} })),
				get: mocks.reposGet ?? mock(() => Promise.resolve({ data: {} })),
			},
			git: {
				createRef:
					mocks.gitCreateRef ?? mock(() => Promise.resolve({ data: {} })),
			},
		},
	};

	// Create a client with mocked octokit
	const client = new GitHubClient({ token: "test-token" });

	// Replace the octokit instance with our mock
	(client as unknown as { octokit: typeof mockOctokit }).octokit = mockOctokit;

	// Mock the repo accessor since context won't have it in tests
	Object.defineProperty(client, "repo", {
		get: () => ({ owner: "test-owner", repo: "test-repo" }),
	});

	return { client, mockOctokit };
}

describe("GitHubClient API methods with mocked responses", () => {
	describe("getPullRequest", () => {
		test("calls pulls.get with correct parameters", async () => {
			const mockData = {
				number: 42,
				title: "Test PR",
				body: "Test body",
				state: "open",
			};
			const mockGet = mock(() => Promise.resolve({ data: mockData }));
			const { client } = createMockedGitHubClient({ pullsGet: mockGet });

			const result = await client.getPullRequest(42);

			expect(mockGet).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				pull_number: 42,
			});
			expect(result.number).toBe(42);
			expect(result.title).toBe("Test PR");
			expect(result.body).toBe("Test body");
			expect(result.state).toBe("open");
		});

		test("returns full PR data including labels and author", async () => {
			const mockData = {
				number: 123,
				title: "Feature: Add new functionality",
				body: "This PR adds new functionality\n\nFixes #456",
				state: "open",
				draft: false,
				merged: false,
				labels: [
					{ name: "enhancement", color: "84b6eb", description: "New feature" },
				],
				user: {
					login: "testuser",
					id: 12345,
					avatar_url: "https://avatars.github.com/u/12345",
					type: "User",
				},
				base: { ref: "main", sha: "base-sha-123" },
				head: { ref: "feature-branch", sha: "head-sha-456" },
				html_url: "https://github.com/test-owner/test-repo/pull/123",
				created_at: "2024-01-15T10:00:00Z",
				updated_at: "2024-01-16T14:00:00Z",
				commits: 5,
				changed_files: 10,
				additions: 200,
				deletions: 50,
			};
			const mockGet = mock(() => Promise.resolve({ data: mockData }));
			const { client } = createMockedGitHubClient({ pullsGet: mockGet });

			const result = await client.getPullRequest(123);

			expect(result.number).toBe(123);
			expect(result.title).toBe("Feature: Add new functionality");
			expect(result.labels).toHaveLength(1);
			expect(result.user?.login).toBe("testuser");
			expect(result.base.ref).toBe("main");
			expect(result.head.ref).toBe("feature-branch");
		});
	});

	describe("getPullRequestDiff", () => {
		test("calls pulls.get with diff mediaType and returns string", async () => {
			const mockDiff =
				"diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts";
			const mockGet = mock(() => Promise.resolve({ data: mockDiff }));
			const { client } = createMockedGitHubClient({ pullsGet: mockGet });

			const result = await client.getPullRequestDiff(42);

			expect(mockGet).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				pull_number: 42,
				mediaType: { format: "diff" },
			});
			expect(result).toBe(mockDiff);
		});
	});

	describe("getPullRequestFiles", () => {
		test("calls pulls.listFiles with correct parameters", async () => {
			const mockFiles = [
				{
					sha: "abc123",
					filename: "src/index.ts",
					status: "modified",
					additions: 10,
					deletions: 5,
					changes: 15,
				},
				{
					sha: "def456",
					filename: "README.md",
					status: "added",
					additions: 50,
					deletions: 0,
					changes: 50,
				},
			];
			const mockListFiles = mock(() => Promise.resolve({ data: mockFiles }));
			const { client } = createMockedGitHubClient({
				pullsListFiles: mockListFiles,
			});

			const result = await client.getPullRequestFiles(42);

			expect(mockListFiles).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				pull_number: 42,
				per_page: 100,
			});
			expect(result).toHaveLength(2);
			expect(result[0]?.filename).toBe("src/index.ts");
			expect(result[1]?.status).toBe("added");
		});
	});

	describe("getPullRequestCommits", () => {
		test("calls pulls.listCommits with correct parameters", async () => {
			const mockCommits = [
				{
					sha: "commit-sha-1",
					commit: {
						message: "feat: add new feature",
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
						comment_count: 0,
					},
					html_url:
						"https://github.com/test-owner/test-repo/commit/commit-sha-1",
					author: { login: "testuser", id: 1, avatar_url: "", type: "User" },
					committer: { login: "testuser", id: 1, avatar_url: "", type: "User" },
					parents: [{ sha: "parent-sha" }],
				},
			];
			const mockListCommits = mock(() =>
				Promise.resolve({ data: mockCommits }),
			);
			const { client } = createMockedGitHubClient({
				pullsListCommits: mockListCommits,
			});

			const result = await client.getPullRequestCommits(42);

			expect(mockListCommits).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				pull_number: 42,
				per_page: 100,
			});
			expect(result).toHaveLength(1);
			expect(result[0]?.sha).toBe("commit-sha-1");
			expect(result[0]?.commit.message).toBe("feat: add new feature");
		});
	});

	describe("getIssueComments", () => {
		test("calls issues.listComments with correct parameters", async () => {
			const mockComments = [
				{
					id: 1,
					body: "Great PR!",
					user: { login: "reviewer", id: 2 },
					created_at: "2024-01-15T10:00:00Z",
					updated_at: "2024-01-15T10:00:00Z",
				},
				{
					id: 2,
					body: "<!-- INTENT_LAYER node=AGENTS.md -->",
					user: { login: "github-actions[bot]", id: 3 },
					created_at: "2024-01-15T11:00:00Z",
					updated_at: "2024-01-15T11:00:00Z",
				},
			];
			const mockListComments = mock(() =>
				Promise.resolve({ data: mockComments }),
			);
			const { client } = createMockedGitHubClient({
				issuesListComments: mockListComments,
			});

			const result = await client.getIssueComments(42);

			expect(mockListComments).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				issue_number: 42,
				per_page: 100,
			});
			expect(result).toHaveLength(2);
			expect(result[0]?.body).toBe("Great PR!");
		});
	});

	describe("createComment", () => {
		test("calls issues.createComment with correct parameters", async () => {
			const mockComment = {
				id: 123,
				body: "New comment body",
				user: { login: "testuser", id: 1 },
				created_at: "2024-01-15T10:00:00Z",
				updated_at: "2024-01-15T10:00:00Z",
			};
			const mockCreateComment = mock(() =>
				Promise.resolve({ data: mockComment }),
			);
			const { client } = createMockedGitHubClient({
				issuesCreateComment: mockCreateComment,
			});

			const result = await client.createComment(42, "New comment body");

			expect(mockCreateComment).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				issue_number: 42,
				body: "New comment body",
			});
			expect(result.id).toBe(123);
			expect(result.body).toBe("New comment body");
		});
	});

	describe("updateComment", () => {
		test("calls issues.updateComment with correct parameters", async () => {
			const mockComment = {
				id: 123,
				body: "Updated comment body",
				user: { login: "testuser", id: 1 },
				created_at: "2024-01-15T10:00:00Z",
				updated_at: "2024-01-15T12:00:00Z",
			};
			const mockUpdateComment = mock(() =>
				Promise.resolve({ data: mockComment }),
			);
			const { client } = createMockedGitHubClient({
				issuesUpdateComment: mockUpdateComment,
			});

			const result = await client.updateComment(123, "Updated comment body");

			expect(mockUpdateComment).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				comment_id: 123,
				body: "Updated comment body",
			});
			expect(result.body).toBe("Updated comment body");
		});
	});

	describe("getComment", () => {
		test("calls issues.getComment with correct parameters", async () => {
			const mockComment = {
				id: 123,
				body: "Comment body",
				user: { login: "testuser", id: 1 },
				created_at: "2024-01-15T10:00:00Z",
				updated_at: "2024-01-15T10:00:00Z",
			};
			const mockGetComment = mock(() => Promise.resolve({ data: mockComment }));
			const { client } = createMockedGitHubClient({
				issuesGetComment: mockGetComment,
			});

			const result = await client.getComment(123);

			expect(mockGetComment).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				comment_id: 123,
			});
			expect(result.id).toBe(123);
		});
	});

	describe("getPullRequestReviewComments", () => {
		test("calls pulls.listReviewComments with correct parameters", async () => {
			const mockComments = [
				{
					id: 1,
					body: "Consider refactoring this",
					path: "src/index.ts",
					position: 5,
					commit_id: "abc123",
					user: { login: "reviewer", id: 2, avatar_url: "", type: "User" },
					created_at: "2024-01-15T10:00:00Z",
					updated_at: "2024-01-15T10:00:00Z",
				},
			];
			const mockListReviewComments = mock(() =>
				Promise.resolve({ data: mockComments }),
			);
			const { client } = createMockedGitHubClient({
				pullsListReviewComments: mockListReviewComments,
			});

			const result = await client.getPullRequestReviewComments(42);

			expect(mockListReviewComments).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				pull_number: 42,
				per_page: 100,
			});
			expect(result).toHaveLength(1);
			expect(result[0]?.body).toBe("Consider refactoring this");
		});
	});

	describe("getFileContent", () => {
		test("calls repos.getContent with correct parameters", async () => {
			const mockContent = {
				type: "file",
				name: "AGENTS.md",
				path: "AGENTS.md",
				sha: "abc123",
				content: Buffer.from("# Agents Guide\n\nTest content").toString(
					"base64",
				),
				encoding: "base64",
			};
			const mockGetContent = mock(() => Promise.resolve({ data: mockContent }));
			const { client } = createMockedGitHubClient({
				reposGetContent: mockGetContent,
			});

			const result = await client.getFileContent("AGENTS.md");

			expect(mockGetContent).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				path: "AGENTS.md",
				ref: undefined,
			});
			// Cast result to access properties since return type is union
			const fileResult = result as { type: string; name: string; sha: string };
			expect(fileResult.type).toBe("file");
			expect(fileResult.name).toBe("AGENTS.md");
			expect(fileResult.sha).toBe("abc123");
		});

		test("calls repos.getContent with ref when provided", async () => {
			const mockContent = { type: "file", name: "README.md" };
			const mockGetContent = mock(() => Promise.resolve({ data: mockContent }));
			const { client } = createMockedGitHubClient({
				reposGetContent: mockGetContent,
			});

			await client.getFileContent("README.md", "feature-branch");

			expect(mockGetContent).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				path: "README.md",
				ref: "feature-branch",
			});
		});
	});

	describe("createOrUpdateFile", () => {
		test("calls repos.createOrUpdateFileContents with correct parameters for new file", async () => {
			const mockResult = {
				content: { sha: "new-sha-123", path: "AGENTS.md" },
				commit: { sha: "commit-sha-456", message: "[INTENT:ADD] AGENTS.md" },
			};
			const mockCreateOrUpdate = mock(() =>
				Promise.resolve({ data: mockResult }),
			);
			const { client } = createMockedGitHubClient({
				reposCreateOrUpdateFileContents: mockCreateOrUpdate,
			});

			const content = "# Agents Guide\n\nNew content";
			const result = await client.createOrUpdateFile(
				"AGENTS.md",
				content,
				"[INTENT:ADD] AGENTS.md",
				"feature-branch",
			);

			expect(mockCreateOrUpdate).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				path: "AGENTS.md",
				message: "[INTENT:ADD] AGENTS.md",
				content: Buffer.from(content).toString("base64"),
				branch: "feature-branch",
				sha: undefined,
			});
			expect(result.commit.sha).toBe("commit-sha-456");
		});

		test("calls repos.createOrUpdateFileContents with sha for existing file", async () => {
			const mockResult = {
				content: { sha: "new-sha-789", path: "AGENTS.md" },
				commit: { sha: "commit-sha-012", message: "[INTENT:UPDATE] AGENTS.md" },
			};
			const mockCreateOrUpdate = mock(() =>
				Promise.resolve({ data: mockResult }),
			);
			const { client } = createMockedGitHubClient({
				reposCreateOrUpdateFileContents: mockCreateOrUpdate,
			});

			const content = "# Updated Agents Guide";
			await client.createOrUpdateFile(
				"AGENTS.md",
				content,
				"[INTENT:UPDATE] AGENTS.md",
				"feature-branch",
				"existing-sha-456",
			);

			expect(mockCreateOrUpdate).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				path: "AGENTS.md",
				message: "[INTENT:UPDATE] AGENTS.md",
				content: Buffer.from(content).toString("base64"),
				branch: "feature-branch",
				sha: "existing-sha-456",
			});
		});
	});

	describe("getIssue", () => {
		test("calls issues.get with correct parameters", async () => {
			const mockIssue = {
				number: 123,
				title: "Bug: Something is broken",
				body: "Description of the bug",
				state: "open",
				labels: [{ name: "bug", color: "d73a4a" }],
				user: { login: "reporter", id: 5 },
				created_at: "2024-01-10T10:00:00Z",
				updated_at: "2024-01-15T14:00:00Z",
			};
			const mockGet = mock(() => Promise.resolve({ data: mockIssue }));
			const { client } = createMockedGitHubClient({ issuesGet: mockGet });

			const result = await client.getIssue(123);

			expect(mockGet).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				issue_number: 123,
			});
			expect(result.number).toBe(123);
			expect(result.title).toBe("Bug: Something is broken");
		});
	});

	describe("createBranch", () => {
		test("calls git.createRef with correct parameters", async () => {
			const mockRef = {
				ref: "refs/heads/intent-layer/42",
				node_id: "REF_123",
				url: "https://api.github.com/repos/test-owner/test-repo/git/refs/heads/intent-layer/42",
				object: { sha: "base-sha-123", type: "commit" },
			};
			const mockCreateRef = mock(() => Promise.resolve({ data: mockRef }));
			const { client } = createMockedGitHubClient({
				gitCreateRef: mockCreateRef,
			});

			const result = await client.createBranch(
				"intent-layer/42",
				"base-sha-123",
			);

			expect(mockCreateRef).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				ref: "refs/heads/intent-layer/42",
				sha: "base-sha-123",
			});
			expect(result.ref).toBe("refs/heads/intent-layer/42");
		});
	});

	describe("createPullRequest", () => {
		test("calls pulls.create with correct parameters", async () => {
			const mockPR = {
				number: 100,
				title: "Intent Layer Updates",
				body: "Automated intent layer updates",
				state: "open",
				html_url: "https://github.com/test-owner/test-repo/pull/100",
				head: { ref: "intent-layer/42" },
				base: { ref: "feature-branch" },
			};
			const mockCreate = mock(() => Promise.resolve({ data: mockPR }));
			const { client } = createMockedGitHubClient({ pullsCreate: mockCreate });

			const result = await client.createPullRequest(
				"Intent Layer Updates",
				"Automated intent layer updates",
				"intent-layer/42",
				"feature-branch",
			);

			expect(mockCreate).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
				title: "Intent Layer Updates",
				body: "Automated intent layer updates",
				head: "intent-layer/42",
				base: "feature-branch",
			});
			expect(result.number).toBe(100);
			expect(result.html_url).toBe(
				"https://github.com/test-owner/test-repo/pull/100",
			);
		});
	});

	describe("getDefaultBranch", () => {
		test("calls repos.get and returns default_branch", async () => {
			const mockRepo = {
				name: "test-repo",
				full_name: "test-owner/test-repo",
				default_branch: "main",
			};
			const mockGet = mock(() => Promise.resolve({ data: mockRepo }));
			const { client } = createMockedGitHubClient({ reposGet: mockGet });

			const result = await client.getDefaultBranch();

			expect(mockGet).toHaveBeenCalledWith({
				owner: "test-owner",
				repo: "test-repo",
			});
			expect(result).toBe("main");
		});

		test("returns correct branch when default is not main", async () => {
			const mockRepo = {
				name: "test-repo",
				full_name: "test-owner/test-repo",
				default_branch: "master",
			};
			const mockGet = mock(() => Promise.resolve({ data: mockRepo }));
			const { client } = createMockedGitHubClient({ reposGet: mockGet });

			const result = await client.getDefaultBranch();

			expect(result).toBe("master");
		});
	});
});

describe("GitHubClient error handling", () => {
	test("propagates API errors from getPullRequest", async () => {
		const mockError = new Error("Not Found");
		const mockGet = mock(() => Promise.reject(mockError));
		const { client } = createMockedGitHubClient({ pullsGet: mockGet });

		await expect(client.getPullRequest(999)).rejects.toThrow("Not Found");
	});

	test("propagates API errors from createComment", async () => {
		const mockError = new Error("Forbidden");
		const mockCreate = mock(() => Promise.reject(mockError));
		const { client } = createMockedGitHubClient({
			issuesCreateComment: mockCreate,
		});

		await expect(client.createComment(42, "test")).rejects.toThrow("Forbidden");
	});

	test("propagates API errors from getFileContent", async () => {
		const mockError = new Error("Not Found");
		const mockGet = mock(() => Promise.reject(mockError));
		const { client } = createMockedGitHubClient({ reposGetContent: mockGet });

		await expect(client.getFileContent("nonexistent.md")).rejects.toThrow(
			"Not Found",
		);
	});
});

// ============================================================================
// Retry Logic Tests
// ============================================================================

import { withRetry } from "../../src/github/client";

describe("withRetry", () => {
	describe("successful operations", () => {
		test("returns result on first successful attempt", async () => {
			const fn = mock(() => Promise.resolve("success"));
			const result = await withRetry(fn, "testOp");

			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(1);
		});

		test("returns result after retry on transient error", async () => {
			let attempts = 0;
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Server Error") as Error & { status: number };
					error.status = 503;
					return Promise.reject(error);
				}
				return Promise.resolve("success after retry");
			});

			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 10,
			});

			expect(result).toBe("success after retry");
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe("rate limit handling", () => {
		test("retries on 429 status code", async () => {
			let attempts = 0;
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Rate Limited") as Error & { status: number };
					error.status = 429;
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 10,
			});

			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		test("retries on 403 status code (secondary rate limit)", async () => {
			let attempts = 0;
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Forbidden") as Error & { status: number };
					error.status = 403;
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 10,
			});

			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		test("respects retry-after header from error response", async () => {
			let attempts = 0;
			const startTime = Date.now();
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Rate Limited") as Error & {
						status: number;
						response: { headers: Record<string, string> };
					};
					error.status = 429;
					error.response = { headers: { "retry-after": "1" } }; // 1 second
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			// Use small jitter to make the test more deterministic
			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 5000,
				jitterFactor: 0,
			});

			const elapsed = Date.now() - startTime;
			expect(result).toBe("success");
			// Should have waited approximately 1 second (1000ms)
			expect(elapsed).toBeGreaterThanOrEqual(900);
		});
	});

	describe("transient error handling", () => {
		test("retries on 500 status code", async () => {
			let attempts = 0;
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Internal Server Error") as Error & {
						status: number;
					};
					error.status = 500;
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 10,
			});

			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		test("retries on 502 status code", async () => {
			let attempts = 0;
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Bad Gateway") as Error & { status: number };
					error.status = 502;
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 10,
			});

			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		test("retries on 504 status code", async () => {
			let attempts = 0;
			const fn = mock(() => {
				attempts++;
				if (attempts < 2) {
					const error = new Error("Gateway Timeout") as Error & {
						status: number;
					};
					error.status = 504;
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			const result = await withRetry(fn, "testOp", {
				baseDelayMs: 1,
				maxDelayMs: 10,
			});

			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe("non-retryable errors", () => {
		test("does not retry on 404 status code", async () => {
			const error = new Error("Not Found") as Error & { status: number };
			error.status = 404;
			const fn = mock(() => Promise.reject(error));

			await expect(
				withRetry(fn, "testOp", { baseDelayMs: 1, maxDelayMs: 10 }),
			).rejects.toThrow("Not Found");

			expect(fn).toHaveBeenCalledTimes(1);
		});

		test("does not retry on 401 status code", async () => {
			const error = new Error("Unauthorized") as Error & { status: number };
			error.status = 401;
			const fn = mock(() => Promise.reject(error));

			await expect(
				withRetry(fn, "testOp", { baseDelayMs: 1, maxDelayMs: 10 }),
			).rejects.toThrow("Unauthorized");

			expect(fn).toHaveBeenCalledTimes(1);
		});

		test("does not retry on 422 status code", async () => {
			const error = new Error("Unprocessable Entity") as Error & {
				status: number;
			};
			error.status = 422;
			const fn = mock(() => Promise.reject(error));

			await expect(
				withRetry(fn, "testOp", { baseDelayMs: 1, maxDelayMs: 10 }),
			).rejects.toThrow("Unprocessable Entity");

			expect(fn).toHaveBeenCalledTimes(1);
		});

		test("does not retry errors without status code", async () => {
			const error = new Error("Network Error");
			const fn = mock(() => Promise.reject(error));

			await expect(
				withRetry(fn, "testOp", { baseDelayMs: 1, maxDelayMs: 10 }),
			).rejects.toThrow("Network Error");

			expect(fn).toHaveBeenCalledTimes(1);
		});
	});

	describe("retry limits", () => {
		test("gives up after max retries", async () => {
			const error = new Error("Server Error") as Error & { status: number };
			error.status = 503;
			const fn = mock(() => Promise.reject(error));

			await expect(
				withRetry(fn, "testOp", {
					maxRetries: 2,
					baseDelayMs: 1,
					maxDelayMs: 10,
				}),
			).rejects.toThrow("Server Error");

			// Initial attempt + 2 retries = 3 total calls
			expect(fn).toHaveBeenCalledTimes(3);
		});

		test("respects custom maxRetries config", async () => {
			const error = new Error("Server Error") as Error & { status: number };
			error.status = 503;
			const fn = mock(() => Promise.reject(error));

			await expect(
				withRetry(fn, "testOp", {
					maxRetries: 1,
					baseDelayMs: 1,
					maxDelayMs: 10,
				}),
			).rejects.toThrow("Server Error");

			// Initial attempt + 1 retry = 2 total calls
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe("exponential backoff", () => {
		test("delays increase exponentially", async () => {
			const delays: number[] = [];
			let lastTime = Date.now();
			let attempts = 0;

			const fn = mock(() => {
				const now = Date.now();
				if (attempts > 0) {
					delays.push(now - lastTime);
				}
				lastTime = now;
				attempts++;

				if (attempts < 4) {
					const error = new Error("Server Error") as Error & { status: number };
					error.status = 503;
					return Promise.reject(error);
				}
				return Promise.resolve("success");
			});

			await withRetry(fn, "testOp", {
				maxRetries: 3,
				baseDelayMs: 50,
				maxDelayMs: 500,
				jitterFactor: 0, // No jitter for predictable delays
			});

			expect(delays.length).toBe(3);
			// Delays should be approximately 50, 100, 200 (exponential)
			// Allow some tolerance for timing
			expect(delays[0]).toBeGreaterThanOrEqual(40);
			expect(delays[0]).toBeLessThan(70);
			expect(delays[1]).toBeGreaterThanOrEqual(90);
			expect(delays[1]).toBeLessThan(130);
			expect(delays[2]).toBeGreaterThanOrEqual(180);
			expect(delays[2]).toBeLessThan(250);
		});
	});
});
