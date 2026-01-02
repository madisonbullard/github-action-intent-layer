import { describe, expect, mock, test } from "bun:test";
import type { GitHubClient } from "../../src/github/client";
import {
	extractLinkedIssues,
	extractLinkedIssuesFromContext,
	extractPRCommits,
	extractPRCommitsFromContext,
	extractPRDiff,
	extractPRDiffFromContext,
	extractPRMetadata,
	extractPRMetadataFromContext,
	extractPRReviewComments,
	extractPRReviewCommentsFromContext,
	type LinkedIssue,
	type PRChangedFile,
	type PRCommit,
	type PRDiff,
	type PRMetadata,
	type PRReviewComment,
	parseLinkedIssues,
} from "../../src/github/context";

/**
 * Creates a mock GitHub client with the specified PR data
 */
function createMockClient(
	prData: Record<string, unknown>,
	pullRequestNumber?: number,
): GitHubClient {
	return {
		getPullRequest: mock(() => Promise.resolve(prData)),
		pullRequestNumber,
	} as unknown as GitHubClient;
}

/**
 * Sample PR data matching GitHub API response structure
 */
const samplePRData = {
	number: 42,
	title: "feat: add new feature",
	body: "This PR adds a wonderful new feature.\n\nFixes #123",
	labels: [
		{
			name: "enhancement",
			color: "84b6eb",
			description: "New feature or request",
		},
		{
			name: "needs-review",
			color: "fbca04",
			description: null,
		},
	],
	user: {
		login: "testuser",
		id: 12345,
		avatar_url: "https://avatars.githubusercontent.com/u/12345",
		type: "User",
	},
	state: "open" as const,
	draft: false,
	merged: false,
	base: {
		ref: "main",
		sha: "abc123base",
	},
	head: {
		ref: "feature/new-feature",
		sha: "def456head",
	},
	html_url: "https://github.com/owner/repo/pull/42",
	created_at: "2024-01-15T10:30:00Z",
	updated_at: "2024-01-16T14:20:00Z",
	commits: 5,
	changed_files: 10,
	additions: 250,
	deletions: 50,
};

describe("extractPRMetadata", () => {
	test("extracts basic PR metadata correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.number).toBe(42);
		expect(metadata.title).toBe("feat: add new feature");
		expect(metadata.description).toBe(
			"This PR adds a wonderful new feature.\n\nFixes #123",
		);
	});

	test("extracts labels correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.labels).toHaveLength(2);
		expect(metadata.labels[0]).toEqual({
			name: "enhancement",
			color: "84b6eb",
			description: "New feature or request",
		});
		expect(metadata.labels[1]).toEqual({
			name: "needs-review",
			color: "fbca04",
			description: null,
		});
	});

	test("extracts author information correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.author).toEqual({
			login: "testuser",
			id: 12345,
			avatarUrl: "https://avatars.githubusercontent.com/u/12345",
			isBot: false,
		});
	});

	test("identifies bot authors correctly", async () => {
		const botPRData = {
			...samplePRData,
			user: {
				...samplePRData.user,
				login: "dependabot[bot]",
				type: "Bot",
			},
		};
		const client = createMockClient(botPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.author.isBot).toBe(true);
		expect(metadata.author.login).toBe("dependabot[bot]");
	});

	test("extracts branch information correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.baseBranch).toBe("main");
		expect(metadata.headBranch).toBe("feature/new-feature");
		expect(metadata.baseSha).toBe("abc123base");
		expect(metadata.headSha).toBe("def456head");
	});

	test("extracts PR state correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.state).toBe("open");
		expect(metadata.isDraft).toBe(false);
		expect(metadata.merged).toBe(false);
	});

	test("extracts draft PR state correctly", async () => {
		const draftPRData = { ...samplePRData, draft: true };
		const client = createMockClient(draftPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.isDraft).toBe(true);
	});

	test("extracts merged PR state correctly", async () => {
		const mergedPRData = {
			...samplePRData,
			state: "closed" as const,
			merged: true,
		};
		const client = createMockClient(mergedPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.state).toBe("closed");
		expect(metadata.merged).toBe(true);
	});

	test("extracts timestamps correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.createdAt).toBe("2024-01-15T10:30:00Z");
		expect(metadata.updatedAt).toBe("2024-01-16T14:20:00Z");
	});

	test("extracts change statistics correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.commitsCount).toBe(5);
		expect(metadata.changedFilesCount).toBe(10);
		expect(metadata.additions).toBe(250);
		expect(metadata.deletions).toBe(50);
	});

	test("extracts URL correctly", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.url).toBe("https://github.com/owner/repo/pull/42");
	});

	test("handles null body (no description)", async () => {
		const noBodyPRData = { ...samplePRData, body: null };
		const client = createMockClient(noBodyPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.description).toBeNull();
	});

	test("handles empty labels array", async () => {
		const noLabelsPRData = { ...samplePRData, labels: [] };
		const client = createMockClient(noLabelsPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.labels).toEqual([]);
	});

	test("handles string labels (legacy format)", async () => {
		const stringLabelsPRData = {
			...samplePRData,
			labels: ["bug", "urgent"],
		};
		const client = createMockClient(stringLabelsPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.labels).toHaveLength(2);
		expect(metadata.labels[0]).toEqual({
			name: "bug",
			color: "",
			description: null,
		});
	});

	test("handles missing user gracefully", async () => {
		const noUserPRData = { ...samplePRData, user: null };
		const client = createMockClient(noUserPRData);
		const metadata = await extractPRMetadata(client, 42);

		expect(metadata.author.login).toBe("unknown");
		expect(metadata.author.id).toBe(0);
	});

	test("calls getPullRequest with correct pull number", async () => {
		const mockGetPR = mock(() => Promise.resolve(samplePRData));
		const client = {
			getPullRequest: mockGetPR,
		} as unknown as GitHubClient;

		await extractPRMetadata(client, 99);

		expect(mockGetPR).toHaveBeenCalledWith(99);
	});
});

describe("extractPRMetadataFromContext", () => {
	test("returns metadata when in PR context", async () => {
		const client = createMockClient(samplePRData, 42);
		const metadata = await extractPRMetadataFromContext(client);

		expect(metadata).not.toBeNull();
		expect(metadata?.number).toBe(42);
		expect(metadata?.title).toBe("feat: add new feature");
	});

	test("returns null when not in PR context", async () => {
		const client = createMockClient(samplePRData, undefined);
		const metadata = await extractPRMetadataFromContext(client);

		expect(metadata).toBeNull();
	});

	test("uses pullRequestNumber from context", async () => {
		const mockGetPR = mock(() => Promise.resolve(samplePRData));
		const client = {
			getPullRequest: mockGetPR,
			pullRequestNumber: 123,
		} as unknown as GitHubClient;

		await extractPRMetadataFromContext(client);

		expect(mockGetPR).toHaveBeenCalledWith(123);
	});
});

describe("PRMetadata type structure", () => {
	test("metadata has all expected fields", async () => {
		const client = createMockClient(samplePRData);
		const metadata = await extractPRMetadata(client, 42);

		// Verify all expected fields exist with correct types
		const expectedFields: (keyof PRMetadata)[] = [
			"number",
			"title",
			"description",
			"labels",
			"author",
			"state",
			"isDraft",
			"merged",
			"baseBranch",
			"headBranch",
			"headSha",
			"baseSha",
			"createdAt",
			"updatedAt",
			"commitsCount",
			"changedFilesCount",
			"additions",
			"deletions",
			"url",
		];

		for (const field of expectedFields) {
			expect(metadata).toHaveProperty(field);
		}
	});
});

/**
 * Sample commit data matching GitHub API response structure
 */
const sampleCommitData = [
	{
		sha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
		commit: {
			author: {
				name: "Monalisa Octocat",
				email: "support@github.com",
				date: "2024-01-14T16:00:49Z",
			},
			committer: {
				name: "Monalisa Octocat",
				email: "support@github.com",
				date: "2024-01-14T16:00:49Z",
			},
			message: "feat: add new feature\n\nThis adds an amazing new feature.",
			comment_count: 2,
		},
		html_url:
			"https://github.com/owner/repo/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e",
		author: {
			login: "octocat",
			id: 1,
			avatar_url: "https://github.com/images/error/octocat_happy.gif",
			type: "User",
		},
		committer: {
			login: "octocat",
			id: 1,
			avatar_url: "https://github.com/images/error/octocat_happy.gif",
			type: "User",
		},
		parents: [
			{
				sha: "abc123parent",
			},
		],
	},
	{
		sha: "abc456def789",
		commit: {
			author: {
				name: "Jane Developer",
				email: "jane@example.com",
				date: "2024-01-15T10:30:00Z",
			},
			committer: {
				name: "Jane Developer",
				email: "jane@example.com",
				date: "2024-01-15T10:30:00Z",
			},
			message: "fix: resolve bug in feature",
			comment_count: 0,
		},
		html_url: "https://github.com/owner/repo/commit/abc456def789",
		author: {
			login: "janedev",
			id: 2,
			avatar_url: "https://github.com/images/error/jane.gif",
			type: "User",
		},
		committer: {
			login: "janedev",
			id: 2,
			avatar_url: "https://github.com/images/error/jane.gif",
			type: "User",
		},
		parents: [
			{
				sha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
			},
		],
	},
];

/**
 * Creates a mock GitHub client for commit tests
 */
function createMockCommitClient(
	commitData: typeof sampleCommitData,
	pullRequestNumber?: number,
): GitHubClient {
	return {
		getPullRequestCommits: mock(() => Promise.resolve(commitData)),
		pullRequestNumber,
	} as unknown as GitHubClient;
}

describe("extractPRCommits", () => {
	test("extracts all commits from PR", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits).toHaveLength(2);
	});

	test("extracts commit SHA correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.sha).toBe("6dcb09b5b57875f334f61aebed695e2e4193db5e");
		expect(commits[1]!.sha).toBe("abc456def789");
	});

	test("extracts commit message correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.message).toBe(
			"feat: add new feature\n\nThis adds an amazing new feature.",
		);
		expect(commits[1]!.message).toBe("fix: resolve bug in feature");
	});

	test("extracts git author information correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.author).toEqual({
			name: "Monalisa Octocat",
			email: "support@github.com",
			date: "2024-01-14T16:00:49Z",
		});
	});

	test("extracts git committer information correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.committer).toEqual({
			name: "Monalisa Octocat",
			email: "support@github.com",
			date: "2024-01-14T16:00:49Z",
		});
	});

	test("extracts GitHub author correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.gitHubAuthor).toEqual({
			login: "octocat",
			id: 1,
			avatarUrl: "https://github.com/images/error/octocat_happy.gif",
			isBot: false,
		});
	});

	test("identifies bot GitHub authors correctly", async () => {
		const baseCommit = sampleCommitData[0]!;
		const botCommitData = [
			{
				sha: baseCommit.sha,
				commit: baseCommit.commit,
				html_url: baseCommit.html_url,
				author: {
					login: "dependabot[bot]",
					id: 1,
					avatar_url: "https://github.com/images/error/octocat_happy.gif",
					type: "Bot",
				},
				committer: baseCommit.committer,
				parents: baseCommit.parents,
			},
		];
		const client = createMockCommitClient(botCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.gitHubAuthor?.isBot).toBe(true);
		expect(commits[0]!.gitHubAuthor?.login).toBe("dependabot[bot]");
	});

	test("handles null GitHub author gracefully", async () => {
		const baseCommit = sampleCommitData[0]!;
		const noAuthorCommitData = [
			{
				sha: baseCommit.sha,
				commit: baseCommit.commit,
				html_url: baseCommit.html_url,
				author: null,
				committer: baseCommit.committer,
				parents: baseCommit.parents,
			},
		];
		const client = createMockCommitClient(
			noAuthorCommitData as unknown as typeof sampleCommitData,
		);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.gitHubAuthor).toBeNull();
	});

	test("handles null GitHub committer gracefully", async () => {
		const baseCommit = sampleCommitData[0]!;
		const noCommitterCommitData = [
			{
				sha: baseCommit.sha,
				commit: baseCommit.commit,
				html_url: baseCommit.html_url,
				author: baseCommit.author,
				committer: null,
				parents: baseCommit.parents,
			},
		];
		const client = createMockCommitClient(
			noCommitterCommitData as unknown as typeof sampleCommitData,
		);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.gitHubCommitter).toBeNull();
	});

	test("extracts commit URL correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.url).toBe(
			"https://github.com/owner/repo/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e",
		);
	});

	test("extracts comment count correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.commentCount).toBe(2);
		expect(commits[1]!.commentCount).toBe(0);
	});

	test("extracts parent SHAs correctly", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.parentShas).toEqual(["abc123parent"]);
		expect(commits[1]!.parentShas).toEqual([
			"6dcb09b5b57875f334f61aebed695e2e4193db5e",
		]);
	});

	test("handles multiple parent commits (merge commits)", async () => {
		const baseCommit = sampleCommitData[0]!;
		const mergeCommitData = [
			{
				sha: baseCommit.sha,
				commit: baseCommit.commit,
				html_url: baseCommit.html_url,
				author: baseCommit.author,
				committer: baseCommit.committer,
				parents: [{ sha: "parent1" }, { sha: "parent2" }],
			},
		];
		const client = createMockCommitClient(mergeCommitData);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.parentShas).toEqual(["parent1", "parent2"]);
	});

	test("handles empty commits list", async () => {
		const client = createMockCommitClient([]);
		const commits = await extractPRCommits(client, 42);

		expect(commits).toEqual([]);
	});

	test("handles missing git author fields gracefully", async () => {
		const baseCommit = sampleCommitData[0]!;
		const noGitAuthorCommitData = [
			{
				sha: baseCommit.sha,
				commit: {
					author: null,
					committer: baseCommit.commit.committer,
					message: baseCommit.commit.message,
					comment_count: baseCommit.commit.comment_count,
				},
				html_url: baseCommit.html_url,
				author: baseCommit.author,
				committer: baseCommit.committer,
				parents: baseCommit.parents,
			},
		];
		const client = createMockCommitClient(
			noGitAuthorCommitData as unknown as typeof sampleCommitData,
		);
		const commits = await extractPRCommits(client, 42);

		expect(commits[0]!.author).toEqual({
			name: "unknown",
			email: "",
			date: "",
		});
	});

	test("calls getPullRequestCommits with correct pull number", async () => {
		const mockGetCommits = mock(() => Promise.resolve(sampleCommitData));
		const client = {
			getPullRequestCommits: mockGetCommits,
		} as unknown as GitHubClient;

		await extractPRCommits(client, 99);

		expect(mockGetCommits).toHaveBeenCalledWith(99);
	});
});

describe("extractPRCommitsFromContext", () => {
	test("returns commits when in PR context", async () => {
		const client = createMockCommitClient(sampleCommitData, 42);
		const commits = await extractPRCommitsFromContext(client);

		expect(commits).not.toBeNull();
		expect(commits).toHaveLength(2);
	});

	test("returns null when not in PR context", async () => {
		const client = createMockCommitClient(sampleCommitData, undefined);
		const commits = await extractPRCommitsFromContext(client);

		expect(commits).toBeNull();
	});

	test("uses pullRequestNumber from context", async () => {
		const mockGetCommits = mock(() => Promise.resolve(sampleCommitData));
		const client = {
			getPullRequestCommits: mockGetCommits,
			pullRequestNumber: 123,
		} as unknown as GitHubClient;

		await extractPRCommitsFromContext(client);

		expect(mockGetCommits).toHaveBeenCalledWith(123);
	});
});

describe("PRCommit type structure", () => {
	test("commit has all expected fields", async () => {
		const client = createMockCommitClient(sampleCommitData);
		const commits = await extractPRCommits(client, 42);
		const commit = commits[0]!;

		// Verify all expected fields exist with correct types
		const expectedFields: (keyof PRCommit)[] = [
			"sha",
			"message",
			"author",
			"committer",
			"gitHubAuthor",
			"gitHubCommitter",
			"url",
			"commentCount",
			"parentShas",
		];

		for (const field of expectedFields) {
			expect(commit).toHaveProperty(field);
		}
	});
});

// ============================================================================
// Linked Issues Tests
// ============================================================================

describe("parseLinkedIssues", () => {
	test("parses simple 'Fixes #123' format", () => {
		const issues = parseLinkedIssues("Fixes #123");

		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual({
			number: 123,
			owner: null,
			repo: null,
			keyword: "fixes",
			rawMatch: "Fixes #123",
		});
	});

	test("parses 'closes #456' format (lowercase)", () => {
		const issues = parseLinkedIssues("closes #456");

		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(456);
		expect(issues[0]!.keyword).toBe("closes");
	});

	test("parses 'RESOLVES #789' format (uppercase)", () => {
		const issues = parseLinkedIssues("RESOLVES #789");

		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(789);
		expect(issues[0]!.keyword).toBe("resolves");
	});

	test("parses keyword with colon 'Closes: #100'", () => {
		const issues = parseLinkedIssues("Closes: #100");

		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(100);
		expect(issues[0]!.keyword).toBe("closes");
	});

	test("parses cross-repo reference 'Fixes owner/repo#123'", () => {
		const issues = parseLinkedIssues("Fixes octo-org/octo-repo#123");

		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual({
			number: 123,
			owner: "octo-org",
			repo: "octo-repo",
			keyword: "fixes",
			rawMatch: "Fixes octo-org/octo-repo#123",
		});
	});

	test("parses all supported keywords", () => {
		const keywords = [
			"close",
			"closes",
			"closed",
			"fix",
			"fixes",
			"fixed",
			"resolve",
			"resolves",
			"resolved",
		];

		for (const keyword of keywords) {
			const issues = parseLinkedIssues(`${keyword} #1`);
			expect(issues).toHaveLength(1);
			expect(issues[0]!.keyword).toBe(keyword);
		}
	});

	test("parses multiple issues in same text", () => {
		const text = "Fixes #123, closes #456, resolves owner/repo#789";
		const issues = parseLinkedIssues(text);

		expect(issues).toHaveLength(3);
		expect(issues[0]!.number).toBe(123);
		expect(issues[1]!.number).toBe(456);
		expect(issues[2]!.number).toBe(789);
		expect(issues[2]!.owner).toBe("owner");
		expect(issues[2]!.repo).toBe("repo");
	});

	test("parses issues from multi-line text", () => {
		const text = `This PR adds a new feature.

Fixes #123

Also resolves #456 which was related.`;
		const issues = parseLinkedIssues(text);

		expect(issues).toHaveLength(2);
		expect(issues[0]!.number).toBe(123);
		expect(issues[1]!.number).toBe(456);
	});

	test("returns empty array for null/empty text", () => {
		expect(parseLinkedIssues("")).toEqual([]);
		expect(parseLinkedIssues(null as unknown as string)).toEqual([]);
	});

	test("returns empty array when no linked issues found", () => {
		const text = "This is a regular commit message with no issue references.";
		const issues = parseLinkedIssues(text);

		expect(issues).toEqual([]);
	});

	test("does not match partial keywords", () => {
		const text = "prefix_fixes #123 or fixing #456";
		const issues = parseLinkedIssues(text);

		// 'fixing' is not a valid keyword, 'prefix_fixes' should not match due to \\b
		expect(issues).toHaveLength(0);
	});

	test("handles repo names with dots and underscores", () => {
		const issues = parseLinkedIssues("Fixes my_org/my.repo-name#42");

		expect(issues).toHaveLength(1);
		expect(issues[0]!.owner).toBe("my_org");
		expect(issues[0]!.repo).toBe("my.repo-name");
	});

	test("handles multiple spaces after keyword", () => {
		const issues = parseLinkedIssues("Fixes  #123");

		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(123);
	});
});

/**
 * Creates a mock GitHub client for linked issues tests
 */
function createMockLinkedIssuesClient(
	prData: Record<string, unknown>,
	commitData: typeof sampleCommitData,
	pullRequestNumber?: number,
): GitHubClient {
	return {
		getPullRequest: mock(() => Promise.resolve(prData)),
		getPullRequestCommits: mock(() => Promise.resolve(commitData)),
		pullRequestNumber,
	} as unknown as GitHubClient;
}

describe("extractLinkedIssues", () => {
	test("extracts linked issues from PR description", async () => {
		const prData = {
			...samplePRData,
			body: "This PR fixes #123 and closes #456",
		};
		const client = createMockLinkedIssuesClient(prData, []);
		const issues = await extractLinkedIssues(client, 42);

		expect(issues).toHaveLength(2);
		expect(issues[0]!.number).toBe(123);
		expect(issues[1]!.number).toBe(456);
	});

	test("extracts linked issues from commit messages", async () => {
		const commitData = [
			{
				...sampleCommitData[0]!,
				commit: {
					...sampleCommitData[0]!.commit,
					message: "feat: add feature\n\nFixes #100",
				},
			},
			{
				...sampleCommitData[1]!,
				commit: {
					...sampleCommitData[1]!.commit,
					message: "fix: resolve bug\n\nCloses #200",
				},
			},
		];
		const prData = { ...samplePRData, body: null };
		const client = createMockLinkedIssuesClient(prData, commitData);
		const issues = await extractLinkedIssues(client, 42);

		expect(issues).toHaveLength(2);
		expect(issues[0]!.number).toBe(100);
		expect(issues[1]!.number).toBe(200);
	});

	test("combines issues from PR description and commits", async () => {
		const commitData = [
			{
				...sampleCommitData[0]!,
				commit: {
					...sampleCommitData[0]!.commit,
					message: "fix: resolve\n\nFixes #200",
				},
			},
		];
		const prData = { ...samplePRData, body: "Closes #100" };
		const client = createMockLinkedIssuesClient(prData, commitData);
		const issues = await extractLinkedIssues(client, 42);

		expect(issues).toHaveLength(2);
		expect(issues[0]!.number).toBe(100);
		expect(issues[1]!.number).toBe(200);
	});

	test("deduplicates linked issues", async () => {
		const commitData = [
			{
				...sampleCommitData[0]!,
				commit: {
					...sampleCommitData[0]!.commit,
					message: "feat: add feature\n\nFixes #123",
				},
			},
			{
				...sampleCommitData[1]!,
				commit: {
					...sampleCommitData[1]!.commit,
					message: "fix: tweak feature\n\nFixes #123",
				},
			},
		];
		const prData = { ...samplePRData, body: "Fixes #123" };
		const client = createMockLinkedIssuesClient(prData, commitData);
		const issues = await extractLinkedIssues(client, 42);

		// Same issue referenced 3 times, should only appear once
		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(123);
	});

	test("keeps cross-repo issues separate from same-repo issues", async () => {
		const prData = {
			...samplePRData,
			body: "Fixes #123, fixes owner/repo#123",
		};
		const client = createMockLinkedIssuesClient(prData, []);
		const issues = await extractLinkedIssues(client, 42);

		// Same issue number but different repos = different issues
		expect(issues).toHaveLength(2);
		expect(issues[0]!.owner).toBeNull();
		expect(issues[1]!.owner).toBe("owner");
	});

	test("returns empty array when no linked issues found", async () => {
		const prData = {
			...samplePRData,
			body: "This is just a regular PR description",
		};
		const commitData = [
			{
				...sampleCommitData[0]!,
				commit: {
					...sampleCommitData[0]!.commit,
					message: "feat: add something",
				},
			},
		];
		const client = createMockLinkedIssuesClient(prData, commitData);
		const issues = await extractLinkedIssues(client, 42);

		expect(issues).toEqual([]);
	});

	test("handles null PR description", async () => {
		const prData = { ...samplePRData, body: null };
		const commitData = [
			{
				...sampleCommitData[0]!,
				commit: {
					...sampleCommitData[0]!.commit,
					message: "Fixes #42",
				},
			},
		];
		const client = createMockLinkedIssuesClient(prData, commitData);
		const issues = await extractLinkedIssues(client, 42);

		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(42);
	});
});

describe("extractLinkedIssuesFromContext", () => {
	test("returns linked issues when in PR context", async () => {
		const prData = { ...samplePRData, body: "Fixes #123" };
		const client = createMockLinkedIssuesClient(prData, [], 42);
		const issues = await extractLinkedIssuesFromContext(client);

		expect(issues).not.toBeNull();
		expect(issues).toHaveLength(1);
		expect(issues![0]!.number).toBe(123);
	});

	test("returns null when not in PR context", async () => {
		const prData = { ...samplePRData, body: "Fixes #123" };
		const client = createMockLinkedIssuesClient(prData, [], undefined);
		const issues = await extractLinkedIssuesFromContext(client);

		expect(issues).toBeNull();
	});

	test("uses pullRequestNumber from context", async () => {
		const mockGetPR = mock(() =>
			Promise.resolve({ ...samplePRData, body: "Fixes #1" }),
		);
		const mockGetCommits = mock(() => Promise.resolve([]));
		const client = {
			getPullRequest: mockGetPR,
			getPullRequestCommits: mockGetCommits,
			pullRequestNumber: 99,
		} as unknown as GitHubClient;

		await extractLinkedIssuesFromContext(client);

		expect(mockGetPR).toHaveBeenCalledWith(99);
		expect(mockGetCommits).toHaveBeenCalledWith(99);
	});
});

describe("LinkedIssue type structure", () => {
	test("linked issue has all expected fields", () => {
		const issues = parseLinkedIssues("Fixes owner/repo#123");
		const issue = issues[0]!;

		const expectedFields: (keyof LinkedIssue)[] = [
			"number",
			"owner",
			"repo",
			"keyword",
			"rawMatch",
		];

		for (const field of expectedFields) {
			expect(issue).toHaveProperty(field);
		}
	});
});

// ============================================================================
// Review Comments Tests
// ============================================================================

/**
 * Sample review comment data matching GitHub API response structure
 */
const sampleReviewCommentData = [
	{
		url: "https://api.github.com/repos/octocat/Hello-World/pulls/comments/1",
		pull_request_review_id: 42,
		id: 10,
		node_id: "MDI0OlB1bGxSZXF1ZXN0UmV2aWV3Q29tbWVudDEw",
		diff_hunk: "@@ -16,33 +16,40 @@ public class Connection : IConnection...",
		path: "file1.txt",
		position: 1,
		original_position: 4,
		commit_id: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
		original_commit_id: "9c48853fa3dc5c1c3d6f1f1cd1f2743e72652840",
		in_reply_to_id: 8,
		user: {
			login: "octocat",
			id: 1,
			node_id: "MDQ6VXNlcjE=",
			avatar_url: "https://github.com/images/error/octocat_happy.gif",
			gravatar_id: "",
			url: "https://api.github.com/users/octocat",
			html_url: "https://github.com/octocat",
			type: "User",
			site_admin: false,
		},
		body: "Great stuff!",
		created_at: "2011-04-14T16:00:49Z",
		updated_at: "2011-04-14T16:00:49Z",
		html_url: "https://github.com/octocat/Hello-World/pull/1#discussion-diff-1",
		pull_request_url:
			"https://api.github.com/repos/octocat/Hello-World/pulls/1",
		author_association: "COLLABORATOR",
		_links: {
			self: {
				href: "https://api.github.com/repos/octocat/Hello-World/pulls/comments/1",
			},
			html: {
				href: "https://github.com/octocat/Hello-World/pull/1#discussion-diff-1",
			},
			pull_request: {
				href: "https://api.github.com/repos/octocat/Hello-World/pulls/1",
			},
		},
		start_line: 1,
		original_start_line: 1,
		start_side: "RIGHT",
		line: 2,
		original_line: 2,
		side: "RIGHT",
	},
	{
		url: "https://api.github.com/repos/octocat/Hello-World/pulls/comments/2",
		pull_request_review_id: 43,
		id: 11,
		node_id: "MDI0OlB1bGxSZXF1ZXN0UmV2aWV3Q29tbWVudDEx",
		diff_hunk: "@@ -1,5 +1,10 @@ import something",
		path: "src/index.ts",
		position: 5,
		original_position: 3,
		commit_id: "abc123def456",
		original_commit_id: "def456abc123",
		in_reply_to_id: null,
		user: {
			login: "reviewer",
			id: 2,
			node_id: "MDQ6VXNlcjI=",
			avatar_url: "https://github.com/images/reviewer.gif",
			gravatar_id: "",
			url: "https://api.github.com/users/reviewer",
			html_url: "https://github.com/reviewer",
			type: "User",
			site_admin: false,
		},
		body: "Consider using a more descriptive variable name here.",
		created_at: "2024-01-15T10:30:00Z",
		updated_at: "2024-01-15T11:00:00Z",
		html_url: "https://github.com/octocat/Hello-World/pull/1#discussion-diff-2",
		pull_request_url:
			"https://api.github.com/repos/octocat/Hello-World/pulls/1",
		author_association: "MEMBER",
		_links: {
			self: {
				href: "https://api.github.com/repos/octocat/Hello-World/pulls/comments/2",
			},
			html: {
				href: "https://github.com/octocat/Hello-World/pull/1#discussion-diff-2",
			},
			pull_request: {
				href: "https://api.github.com/repos/octocat/Hello-World/pulls/1",
			},
		},
		start_line: null,
		original_start_line: null,
		start_side: null,
		line: 5,
		original_line: 3,
		side: "LEFT",
	},
];

/**
 * Creates a mock GitHub client for review comment tests
 */
function createMockReviewCommentClient(
	commentData: typeof sampleReviewCommentData,
	pullRequestNumber?: number,
): GitHubClient {
	return {
		getPullRequestReviewComments: mock(() => Promise.resolve(commentData)),
		pullRequestNumber,
	} as unknown as GitHubClient;
}

describe("extractPRReviewComments", () => {
	test("extracts all review comments from PR", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments).toHaveLength(2);
	});

	test("extracts comment ID correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.id).toBe(10);
		expect(comments[1]!.id).toBe(11);
	});

	test("extracts pull request review ID correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.pullRequestReviewId).toBe(42);
		expect(comments[1]!.pullRequestReviewId).toBe(43);
	});

	test("extracts comment body correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.body).toBe("Great stuff!");
		expect(comments[1]!.body).toBe(
			"Consider using a more descriptive variable name here.",
		);
	});

	test("extracts diff hunk correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.diffHunk).toBe(
			"@@ -16,33 +16,40 @@ public class Connection : IConnection...",
		);
	});

	test("extracts file path correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.path).toBe("file1.txt");
		expect(comments[1]!.path).toBe("src/index.ts");
	});

	test("extracts position information correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.position).toBe(1);
		expect(comments[0]!.originalPosition).toBe(4);
		expect(comments[1]!.position).toBe(5);
		expect(comments[1]!.originalPosition).toBe(3);
	});

	test("extracts commit IDs correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.commitId).toBe(
			"6dcb09b5b57875f334f61aebed695e2e4193db5e",
		);
		expect(comments[0]!.originalCommitId).toBe(
			"9c48853fa3dc5c1c3d6f1f1cd1f2743e72652840",
		);
	});

	test("extracts in_reply_to_id correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.inReplyToId).toBe(8);
		expect(comments[1]!.inReplyToId).toBeNull();
	});

	test("extracts author information correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.author).toEqual({
			login: "octocat",
			id: 1,
			avatarUrl: "https://github.com/images/error/octocat_happy.gif",
			isBot: false,
		});
		expect(comments[1]!.author).toEqual({
			login: "reviewer",
			id: 2,
			avatarUrl: "https://github.com/images/reviewer.gif",
			isBot: false,
		});
	});

	test("identifies bot authors correctly", async () => {
		const botCommentData = [
			{
				...sampleReviewCommentData[0]!,
				user: {
					...sampleReviewCommentData[0]!.user,
					login: "dependabot[bot]",
					type: "Bot",
				},
			},
		];
		const client = createMockReviewCommentClient(botCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.author.isBot).toBe(true);
		expect(comments[0]!.author.login).toBe("dependabot[bot]");
	});

	test("extracts author association correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.authorAssociation).toBe("COLLABORATOR");
		expect(comments[1]!.authorAssociation).toBe("MEMBER");
	});

	test("extracts URLs correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.url).toBe(
			"https://github.com/octocat/Hello-World/pull/1#discussion-diff-1",
		);
	});

	test("extracts timestamps correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.createdAt).toBe("2011-04-14T16:00:49Z");
		expect(comments[0]!.updatedAt).toBe("2011-04-14T16:00:49Z");
		expect(comments[1]!.createdAt).toBe("2024-01-15T10:30:00Z");
		expect(comments[1]!.updatedAt).toBe("2024-01-15T11:00:00Z");
	});

	test("extracts multi-line comment info correctly", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);

		// First comment has multi-line info
		expect(comments[0]!.startLine).toBe(1);
		expect(comments[0]!.originalStartLine).toBe(1);
		expect(comments[0]!.startSide).toBe("RIGHT");
		expect(comments[0]!.line).toBe(2);
		expect(comments[0]!.originalLine).toBe(2);
		expect(comments[0]!.side).toBe("RIGHT");

		// Second comment is single-line (no start_line)
		expect(comments[1]!.startLine).toBeNull();
		expect(comments[1]!.originalStartLine).toBeNull();
		expect(comments[1]!.startSide).toBeNull();
		expect(comments[1]!.line).toBe(5);
		expect(comments[1]!.originalLine).toBe(3);
		expect(comments[1]!.side).toBe("LEFT");
	});

	test("handles empty comments list", async () => {
		const client = createMockReviewCommentClient([]);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments).toEqual([]);
	});

	test("handles missing user gracefully", async () => {
		const noUserCommentData = [
			{
				...sampleReviewCommentData[0]!,
				user: null,
			},
		];
		const client = createMockReviewCommentClient(
			noUserCommentData as unknown as typeof sampleReviewCommentData,
		);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.author.login).toBe("unknown");
		expect(comments[0]!.author.id).toBe(0);
		expect(comments[0]!.author.avatarUrl).toBe("");
	});

	test("handles null pull_request_review_id gracefully", async () => {
		const noReviewIdCommentData = [
			{
				...sampleReviewCommentData[0]!,
				pull_request_review_id: null,
			},
		];
		const client = createMockReviewCommentClient(
			noReviewIdCommentData as unknown as typeof sampleReviewCommentData,
		);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.pullRequestReviewId).toBeNull();
	});

	test("handles outdated comment with null position", async () => {
		const outdatedCommentData = [
			{
				...sampleReviewCommentData[0]!,
				position: null,
			},
		];
		const client = createMockReviewCommentClient(
			outdatedCommentData as unknown as typeof sampleReviewCommentData,
		);
		const comments = await extractPRReviewComments(client, 42);

		expect(comments[0]!.position).toBeNull();
	});

	test("calls getPullRequestReviewComments with correct pull number", async () => {
		const mockGetComments = mock(() =>
			Promise.resolve(sampleReviewCommentData),
		);
		const client = {
			getPullRequestReviewComments: mockGetComments,
		} as unknown as GitHubClient;

		await extractPRReviewComments(client, 99);

		expect(mockGetComments).toHaveBeenCalledWith(99);
	});
});

describe("extractPRReviewCommentsFromContext", () => {
	test("returns review comments when in PR context", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData, 42);
		const comments = await extractPRReviewCommentsFromContext(client);

		expect(comments).not.toBeNull();
		expect(comments).toHaveLength(2);
	});

	test("returns null when not in PR context", async () => {
		const client = createMockReviewCommentClient(
			sampleReviewCommentData,
			undefined,
		);
		const comments = await extractPRReviewCommentsFromContext(client);

		expect(comments).toBeNull();
	});

	test("uses pullRequestNumber from context", async () => {
		const mockGetComments = mock(() =>
			Promise.resolve(sampleReviewCommentData),
		);
		const client = {
			getPullRequestReviewComments: mockGetComments,
			pullRequestNumber: 123,
		} as unknown as GitHubClient;

		await extractPRReviewCommentsFromContext(client);

		expect(mockGetComments).toHaveBeenCalledWith(123);
	});
});

describe("PRReviewComment type structure", () => {
	test("review comment has all expected fields", async () => {
		const client = createMockReviewCommentClient(sampleReviewCommentData);
		const comments = await extractPRReviewComments(client, 42);
		const comment = comments[0]!;

		// Verify all expected fields exist with correct types
		const expectedFields: (keyof PRReviewComment)[] = [
			"id",
			"pullRequestReviewId",
			"body",
			"diffHunk",
			"path",
			"position",
			"originalPosition",
			"commitId",
			"originalCommitId",
			"inReplyToId",
			"author",
			"authorAssociation",
			"url",
			"createdAt",
			"updatedAt",
			"startLine",
			"originalStartLine",
			"startSide",
			"line",
			"originalLine",
			"side",
		];

		for (const field of expectedFields) {
			expect(comment).toHaveProperty(field);
		}
	});
});

// ============================================================================
// PR Diff / Files Changed Tests
// ============================================================================

/**
 * Sample file data matching GitHub API response structure
 */
const sampleFilesData = [
	{
		sha: "bbcd538c8e72b8c175046e27cc8f907076331401",
		filename: "src/index.ts",
		status: "added",
		additions: 103,
		deletions: 0,
		changes: 103,
		blob_url:
			"https://github.com/octocat/Hello-World/blob/6dcb09b5b57875f334f61aebed695e2e4193db5e/src/index.ts",
		raw_url:
			"https://github.com/octocat/Hello-World/raw/6dcb09b5b57875f334f61aebed695e2e4193db5e/src/index.ts",
		contents_url:
			"https://api.github.com/repos/octocat/Hello-World/contents/src/index.ts?ref=6dcb09b5b57875f334f61aebed695e2e4193db5e",
		patch:
			"@@ -0,0 +1,103 @@ export function main() {\n+  console.log('Hello World');\n+}",
	},
	{
		sha: "abc123def456",
		filename: "README.md",
		status: "modified",
		additions: 10,
		deletions: 5,
		changes: 15,
		blob_url:
			"https://github.com/octocat/Hello-World/blob/6dcb09b5b57875f334f61aebed695e2e4193db5e/README.md",
		raw_url:
			"https://github.com/octocat/Hello-World/raw/6dcb09b5b57875f334f61aebed695e2e4193db5e/README.md",
		contents_url:
			"https://api.github.com/repos/octocat/Hello-World/contents/README.md?ref=6dcb09b5b57875f334f61aebed695e2e4193db5e",
		patch: "@@ -1,5 +1,10 @@ # Hello World\n+\n+This is a test project.",
	},
	{
		sha: "def789ghi012",
		filename: "old-file.ts",
		status: "removed",
		additions: 0,
		deletions: 50,
		changes: 50,
		blob_url:
			"https://github.com/octocat/Hello-World/blob/6dcb09b5b57875f334f61aebed695e2e4193db5e/old-file.ts",
		raw_url:
			"https://github.com/octocat/Hello-World/raw/6dcb09b5b57875f334f61aebed695e2e4193db5e/old-file.ts",
		contents_url:
			"https://api.github.com/repos/octocat/Hello-World/contents/old-file.ts?ref=6dcb09b5b57875f334f61aebed695e2e4193db5e",
		patch: "@@ -1,50 +0,0 @@ // Old code removed",
	},
	{
		sha: "ghi345jkl678",
		filename: "src/utils/helper.ts",
		status: "renamed",
		additions: 2,
		deletions: 1,
		changes: 3,
		blob_url:
			"https://github.com/octocat/Hello-World/blob/6dcb09b5b57875f334f61aebed695e2e4193db5e/src/utils/helper.ts",
		raw_url:
			"https://github.com/octocat/Hello-World/raw/6dcb09b5b57875f334f61aebed695e2e4193db5e/src/utils/helper.ts",
		contents_url:
			"https://api.github.com/repos/octocat/Hello-World/contents/src/utils/helper.ts?ref=6dcb09b5b57875f334f61aebed695e2e4193db5e",
		patch:
			"@@ -1,1 +1,2 @@ export const helper = () => {};\n+export const helper2 = () => {};",
		previous_filename: "src/helper.ts",
	},
];

/**
 * Creates a mock GitHub client for diff tests
 */
function createMockDiffClient(
	filesData: typeof sampleFilesData,
	rawDiff = "",
	pullRequestNumber?: number,
): GitHubClient {
	return {
		getPullRequestFiles: mock(() => Promise.resolve(filesData)),
		getPullRequestDiff: mock(() => Promise.resolve(rawDiff)),
		pullRequestNumber,
	} as unknown as GitHubClient;
}

describe("extractPRDiff", () => {
	test("extracts all files from PR", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files).toHaveLength(4);
	});

	test("extracts file SHA correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.sha).toBe("bbcd538c8e72b8c175046e27cc8f907076331401");
	});

	test("extracts filename correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.filename).toBe("src/index.ts");
		expect(diff.files[1]!.filename).toBe("README.md");
		expect(diff.files[2]!.filename).toBe("old-file.ts");
	});

	test("extracts file status correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.status).toBe("added");
		expect(diff.files[1]!.status).toBe("modified");
		expect(diff.files[2]!.status).toBe("removed");
		expect(diff.files[3]!.status).toBe("renamed");
	});

	test("extracts additions and deletions correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.additions).toBe(103);
		expect(diff.files[0]!.deletions).toBe(0);
		expect(diff.files[0]!.changes).toBe(103);

		expect(diff.files[1]!.additions).toBe(10);
		expect(diff.files[1]!.deletions).toBe(5);
		expect(diff.files[1]!.changes).toBe(15);
	});

	test("extracts URLs correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.blobUrl).toBe(
			"https://github.com/octocat/Hello-World/blob/6dcb09b5b57875f334f61aebed695e2e4193db5e/src/index.ts",
		);
		expect(diff.files[0]!.rawUrl).toBe(
			"https://github.com/octocat/Hello-World/raw/6dcb09b5b57875f334f61aebed695e2e4193db5e/src/index.ts",
		);
		expect(diff.files[0]!.contentsUrl).toBe(
			"https://api.github.com/repos/octocat/Hello-World/contents/src/index.ts?ref=6dcb09b5b57875f334f61aebed695e2e4193db5e",
		);
	});

	test("extracts patch correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.patch).toBe(
			"@@ -0,0 +1,103 @@ export function main() {\n+  console.log('Hello World');\n+}",
		);
	});

	test("extracts previous filename for renamed files", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[3]!.previousFilename).toBe("src/helper.ts");
		expect(diff.files[0]!.previousFilename).toBeNull();
	});

	test("calculates summary statistics correctly", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.summary.totalFiles).toBe(4);
		expect(diff.summary.totalAdditions).toBe(103 + 10 + 0 + 2);
		expect(diff.summary.totalDeletions).toBe(0 + 5 + 50 + 1);
		expect(diff.summary.filesAdded).toBe(1);
		expect(diff.summary.filesRemoved).toBe(1);
		expect(diff.summary.filesModified).toBe(1);
		expect(diff.summary.filesRenamed).toBe(1);
	});

	test("handles empty files list", async () => {
		const client = createMockDiffClient([]);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files).toEqual([]);
		expect(diff.summary.totalFiles).toBe(0);
		expect(diff.summary.totalAdditions).toBe(0);
		expect(diff.summary.totalDeletions).toBe(0);
		expect(diff.summary.filesAdded).toBe(0);
		expect(diff.summary.filesRemoved).toBe(0);
		expect(diff.summary.filesModified).toBe(0);
		expect(diff.summary.filesRenamed).toBe(0);
	});

	test("handles missing patch (binary files)", async () => {
		const binaryFileData = [
			{
				sha: "abc123",
				filename: "image.png",
				status: "added",
				additions: 0,
				deletions: 0,
				changes: 0,
				blob_url:
					"https://github.com/octocat/Hello-World/blob/abc123/image.png",
				raw_url: "https://github.com/octocat/Hello-World/raw/abc123/image.png",
				contents_url:
					"https://api.github.com/repos/octocat/Hello-World/contents/image.png?ref=abc123",
				// No patch field for binary files
			},
		];
		const client = createMockDiffClient(
			binaryFileData as unknown as typeof sampleFilesData,
		);
		const diff = await extractPRDiff(client, 42);

		expect(diff.files[0]!.patch).toBeNull();
	});

	test("handles missing previous_filename for non-renamed files", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		// First 3 files are not renamed
		expect(diff.files[0]!.previousFilename).toBeNull();
		expect(diff.files[1]!.previousFilename).toBeNull();
		expect(diff.files[2]!.previousFilename).toBeNull();
	});

	test("does not fetch raw diff by default", async () => {
		const mockGetDiff = mock(() => Promise.resolve("diff content"));
		const client = {
			getPullRequestFiles: mock(() => Promise.resolve(sampleFilesData)),
			getPullRequestDiff: mockGetDiff,
		} as unknown as GitHubClient;

		const diff = await extractPRDiff(client, 42);

		expect(mockGetDiff).not.toHaveBeenCalled();
		expect(diff.rawDiff).toBeNull();
	});

	test("fetches raw diff when includeRawDiff is true", async () => {
		const rawDiffContent =
			"diff --git a/file1.txt b/file1.txt\n--- a/file1.txt\n+++ b/file1.txt";
		const client = createMockDiffClient(sampleFilesData, rawDiffContent);

		const diff = await extractPRDiff(client, 42, { includeRawDiff: true });

		expect(diff.rawDiff).toBe(rawDiffContent);
	});

	test("calls getPullRequestFiles with correct pull number", async () => {
		const mockGetFiles = mock(() => Promise.resolve(sampleFilesData));
		const client = {
			getPullRequestFiles: mockGetFiles,
			getPullRequestDiff: mock(() => Promise.resolve("")),
		} as unknown as GitHubClient;

		await extractPRDiff(client, 99);

		expect(mockGetFiles).toHaveBeenCalledWith(99);
	});

	test("counts changed status as modified", async () => {
		const changedFileData = [
			{
				sha: "abc123",
				filename: "file.ts",
				status: "changed",
				additions: 5,
				deletions: 3,
				changes: 8,
				blob_url: "https://github.com/octocat/Hello-World/blob/abc123/file.ts",
				raw_url: "https://github.com/octocat/Hello-World/raw/abc123/file.ts",
				contents_url:
					"https://api.github.com/repos/octocat/Hello-World/contents/file.ts?ref=abc123",
				patch: "@@ -1,3 +1,5 @@",
			},
		];
		const client = createMockDiffClient(changedFileData);
		const diff = await extractPRDiff(client, 42);

		expect(diff.summary.filesModified).toBe(1);
	});
});

describe("extractPRDiffFromContext", () => {
	test("returns diff when in PR context", async () => {
		const client = createMockDiffClient(sampleFilesData, "", 42);
		const diff = await extractPRDiffFromContext(client);

		expect(diff).not.toBeNull();
		expect(diff?.files).toHaveLength(4);
	});

	test("returns null when not in PR context", async () => {
		const client = createMockDiffClient(sampleFilesData, "", undefined);
		const diff = await extractPRDiffFromContext(client);

		expect(diff).toBeNull();
	});

	test("uses pullRequestNumber from context", async () => {
		const mockGetFiles = mock(() => Promise.resolve(sampleFilesData));
		const client = {
			getPullRequestFiles: mockGetFiles,
			getPullRequestDiff: mock(() => Promise.resolve("")),
			pullRequestNumber: 123,
		} as unknown as GitHubClient;

		await extractPRDiffFromContext(client);

		expect(mockGetFiles).toHaveBeenCalledWith(123);
	});

	test("passes options through to extractPRDiff", async () => {
		const rawDiffContent = "diff content";
		const client = createMockDiffClient(sampleFilesData, rawDiffContent, 42);

		const diff = await extractPRDiffFromContext(client, {
			includeRawDiff: true,
		});

		expect(diff?.rawDiff).toBe(rawDiffContent);
	});
});

describe("PRDiff type structure", () => {
	test("diff has all expected top-level fields", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		const expectedFields: (keyof PRDiff)[] = ["files", "summary", "rawDiff"];

		for (const field of expectedFields) {
			expect(diff).toHaveProperty(field);
		}
	});

	test("changed file has all expected fields", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);
		const file = diff.files[0]!;

		const expectedFields: (keyof PRChangedFile)[] = [
			"sha",
			"filename",
			"status",
			"additions",
			"deletions",
			"changes",
			"blobUrl",
			"rawUrl",
			"contentsUrl",
			"patch",
			"previousFilename",
		];

		for (const field of expectedFields) {
			expect(file).toHaveProperty(field);
		}
	});

	test("summary has all expected fields", async () => {
		const client = createMockDiffClient(sampleFilesData);
		const diff = await extractPRDiff(client, 42);

		const expectedFields = [
			"totalFiles",
			"totalAdditions",
			"totalDeletions",
			"filesAdded",
			"filesRemoved",
			"filesModified",
			"filesRenamed",
		];

		for (const field of expectedFields) {
			expect(diff.summary).toHaveProperty(field);
		}
	});
});
