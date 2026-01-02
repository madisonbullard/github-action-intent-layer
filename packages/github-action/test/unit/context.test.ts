import { describe, expect, mock, test } from "bun:test";
import type { GitHubClient } from "../../src/github/client";
import {
	extractPRMetadata,
	extractPRMetadataFromContext,
	type PRMetadata,
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
