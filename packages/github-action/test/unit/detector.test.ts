import { describe, expect, mock, test } from "bun:test";
import { GitHubClient } from "../../src/github/client";
import {
	detectAgentsFiles,
	detectClaudeFiles,
	detectIntentLayer,
	detectSymlinkRelationships,
	getRootIntentFile,
	hasIntentLayer,
	type IntentFile,
	type IntentLayerDetectionResult,
} from "../../src/intent/detector";

/**
 * Creates a mock GitHubClient for testing the detector.
 */
function createMockedDetectorClient(mocks: {
	getRef?: ReturnType<typeof mock>;
	getCommit?: ReturnType<typeof mock>;
	getTree?: ReturnType<typeof mock>;
	getBlob?: ReturnType<typeof mock>;
	getDefaultBranch?: ReturnType<typeof mock>;
}) {
	const mockOctokit = {
		rest: {
			git: {
				getRef: mocks.getRef ?? mock(() => Promise.resolve({ data: {} })),
				getCommit: mocks.getCommit ?? mock(() => Promise.resolve({ data: {} })),
				getTree:
					mocks.getTree ?? mock(() => Promise.resolve({ data: { tree: [] } })),
				getBlob: mocks.getBlob ?? mock(() => Promise.resolve({ data: {} })),
			},
			repos: {
				get:
					mocks.getDefaultBranch ??
					mock(() => Promise.resolve({ data: { default_branch: "main" } })),
			},
		},
	};

	const client = new GitHubClient({ token: "test-token" });

	// Replace the octokit instance with our mock
	(client as unknown as { octokit: typeof mockOctokit }).octokit = mockOctokit;

	// Mock the repo accessor
	Object.defineProperty(client, "repo", {
		get: () => ({ owner: "test-owner", repo: "test-repo" }),
	});

	return { client, mockOctokit };
}

/**
 * Creates standard mock implementations for a repository with the given tree.
 */
function createTreeMocks(
	treeItems: Array<{
		path?: string;
		type?: string;
		mode?: string;
		sha?: string;
	}>,
) {
	const getRef = mock(() =>
		Promise.resolve({
			data: {
				object: { sha: "commit-sha-123" },
			},
		}),
	);

	const getCommit = mock(() =>
		Promise.resolve({
			data: {
				tree: { sha: "tree-sha-456" },
			},
		}),
	);

	const getTree = mock(() =>
		Promise.resolve({
			data: {
				tree: treeItems,
			},
		}),
	);

	return { getRef, getCommit, getTree };
}

describe("detectAgentsFiles", () => {
	test("returns empty array when no AGENTS.md files exist", async () => {
		const mocks = createTreeMocks([
			{ path: "README.md", type: "blob", mode: "100644", sha: "sha1" },
			{ path: "src/index.ts", type: "blob", mode: "100644", sha: "sha2" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(0);
	});

	test("detects root AGENTS.md file", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "100644", sha: "agents-sha" },
			{ path: "README.md", type: "blob", mode: "100644", sha: "readme-sha" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			path: "AGENTS.md",
			type: "agents",
			sha: "agents-sha",
			isSymlink: false,
			symlinkTarget: undefined,
		});
	});

	test("detects nested AGENTS.md files", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "100644", sha: "root-sha" },
			{ path: "src/AGENTS.md", type: "blob", mode: "100644", sha: "src-sha" },
			{
				path: "packages/api/AGENTS.md",
				type: "blob",
				mode: "100644",
				sha: "api-sha",
			},
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(3);
		// Should be sorted by depth (root first) then alphabetically
		expect(result[0]!.path).toBe("AGENTS.md");
		expect(result[1]!.path).toBe("src/AGENTS.md");
		expect(result[2]!.path).toBe("packages/api/AGENTS.md");
	});

	test("ignores directories named AGENTS.md", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "tree", mode: "040000", sha: "dir-sha" },
			{ path: "real/AGENTS.md", type: "blob", mode: "100644", sha: "file-sha" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(1);
		expect(result[0]!.path).toBe("real/AGENTS.md");
	});

	test("ignores files with similar names", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "100644", sha: "real-sha" },
			{ path: "MY_AGENTS.md", type: "blob", mode: "100644", sha: "fake1-sha" },
			{ path: "AGENTS.md.bak", type: "blob", mode: "100644", sha: "fake2-sha" },
			{ path: "agents.md", type: "blob", mode: "100644", sha: "lowercase-sha" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(1);
		expect(result[0]!.path).toBe("AGENTS.md");
	});

	test("detects symlinked AGENTS.md file", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "120000", sha: "symlink-sha" },
		]);

		const getBlob = mock(() =>
			Promise.resolve({
				data: {
					content: Buffer.from("CLAUDE.md").toString("base64"),
					encoding: "base64",
				},
			}),
		);

		const { client } = createMockedDetectorClient({ ...mocks, getBlob });

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			path: "AGENTS.md",
			type: "agents",
			sha: "symlink-sha",
			isSymlink: true,
			symlinkTarget: "CLAUDE.md",
		});
	});

	test("handles symlink read failure gracefully", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "120000", sha: "symlink-sha" },
		]);

		const getBlob = mock(() => Promise.reject(new Error("Blob not found")));

		const { client } = createMockedDetectorClient({ ...mocks, getBlob });

		const result = await detectAgentsFiles(client, "main");

		expect(result).toHaveLength(1);
		expect(result[0]!.isSymlink).toBe(true);
		expect(result[0]!.symlinkTarget).toBeUndefined();
	});

	test("uses default branch when ref not provided", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "100644", sha: "sha1" },
		]);

		const getDefaultBranch = mock(() =>
			Promise.resolve({ data: { default_branch: "develop" } }),
		);

		const { client, mockOctokit } = createMockedDetectorClient({
			...mocks,
			getDefaultBranch,
		});

		await detectAgentsFiles(client);

		expect(mocks.getRef).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: "heads/develop",
			}),
		);
	});
});

describe("detectClaudeFiles", () => {
	test("returns empty array when no CLAUDE.md files exist", async () => {
		const mocks = createTreeMocks([
			{ path: "README.md", type: "blob", mode: "100644", sha: "sha1" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectClaudeFiles(client, "main");

		expect(result).toHaveLength(0);
	});

	test("detects root CLAUDE.md file", async () => {
		const mocks = createTreeMocks([
			{ path: "CLAUDE.md", type: "blob", mode: "100644", sha: "claude-sha" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectClaudeFiles(client, "main");

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			path: "CLAUDE.md",
			type: "claude",
			sha: "claude-sha",
			isSymlink: false,
			symlinkTarget: undefined,
		});
	});

	test("detects nested CLAUDE.md files", async () => {
		const mocks = createTreeMocks([
			{ path: "CLAUDE.md", type: "blob", mode: "100644", sha: "root-sha" },
			{
				path: "packages/core/CLAUDE.md",
				type: "blob",
				mode: "100644",
				sha: "core-sha",
			},
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectClaudeFiles(client, "main");

		expect(result).toHaveLength(2);
		expect(result[0]!.path).toBe("CLAUDE.md");
		expect(result[1]!.path).toBe("packages/core/CLAUDE.md");
	});
});

describe("detectIntentLayer", () => {
	test("detects both AGENTS.md and CLAUDE.md files", async () => {
		const mocks = createTreeMocks([
			{ path: "AGENTS.md", type: "blob", mode: "100644", sha: "agents-sha" },
			{ path: "CLAUDE.md", type: "blob", mode: "100644", sha: "claude-sha" },
			{
				path: "src/AGENTS.md",
				type: "blob",
				mode: "100644",
				sha: "src-agents-sha",
			},
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectIntentLayer(client, "main");

		expect(result.agentsFiles).toHaveLength(2);
		expect(result.claudeFiles).toHaveLength(1);
	});

	test("returns empty arrays when no intent files exist", async () => {
		const mocks = createTreeMocks([
			{ path: "README.md", type: "blob", mode: "100644", sha: "sha1" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectIntentLayer(client, "main");

		expect(result.agentsFiles).toHaveLength(0);
		expect(result.claudeFiles).toHaveLength(0);
	});
});

describe("hasIntentLayer", () => {
	test("returns false when no intent files exist", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [],
			claudeFiles: [],
		};

		expect(hasIntentLayer(result)).toBe(false);
	});

	test("returns true when AGENTS.md exists", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [],
		};

		expect(hasIntentLayer(result)).toBe(true);
	});

	test("returns true when CLAUDE.md exists", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha1", isSymlink: false },
			],
		};

		expect(hasIntentLayer(result)).toBe(true);
	});

	test("returns true when both exist", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		expect(hasIntentLayer(result)).toBe(true);
	});
});

describe("getRootIntentFile", () => {
	test("returns undefined when no files exist", () => {
		const files: IntentFile[] = [];

		expect(getRootIntentFile(files)).toBeUndefined();
	});

	test("returns undefined when no root file exists", () => {
		const files: IntentFile[] = [
			{ path: "src/AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			{
				path: "packages/api/AGENTS.md",
				type: "agents",
				sha: "sha2",
				isSymlink: false,
			},
		];

		expect(getRootIntentFile(files)).toBeUndefined();
	});

	test("returns root file when it exists", () => {
		const files: IntentFile[] = [
			{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			{ path: "src/AGENTS.md", type: "agents", sha: "sha2", isSymlink: false },
		];

		const root = getRootIntentFile(files);

		expect(root).toBeDefined();
		expect(root!.path).toBe("AGENTS.md");
	});

	test("handles root file among many nested files", () => {
		const files: IntentFile[] = [
			{ path: "AGENTS.md", type: "agents", sha: "root-sha", isSymlink: false },
			{ path: "a/AGENTS.md", type: "agents", sha: "a-sha", isSymlink: false },
			{
				path: "a/b/AGENTS.md",
				type: "agents",
				sha: "ab-sha",
				isSymlink: false,
			},
			{
				path: "a/b/c/AGENTS.md",
				type: "agents",
				sha: "abc-sha",
				isSymlink: false,
			},
		];

		const root = getRootIntentFile(files);

		expect(root).toBeDefined();
		expect(root!.sha).toBe("root-sha");
	});
});

describe("file sorting", () => {
	test("sorts files by depth then alphabetically", async () => {
		const mocks = createTreeMocks([
			{ path: "z/AGENTS.md", type: "blob", mode: "100644", sha: "z-sha" },
			{ path: "a/AGENTS.md", type: "blob", mode: "100644", sha: "a-sha" },
			{ path: "AGENTS.md", type: "blob", mode: "100644", sha: "root-sha" },
			{ path: "a/b/AGENTS.md", type: "blob", mode: "100644", sha: "ab-sha" },
		]);
		const { client } = createMockedDetectorClient(mocks);

		const result = await detectAgentsFiles(client, "main");

		expect(result.map((f) => f.path)).toEqual([
			"AGENTS.md", // depth 1
			"a/AGENTS.md", // depth 2, alphabetically first
			"z/AGENTS.md", // depth 2, alphabetically last
			"a/b/AGENTS.md", // depth 3
		]);
	});
});

describe("detectSymlinkRelationships", () => {
	test("returns empty array when no intent files exist", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [],
			claudeFiles: [],
		};

		expect(detectSymlinkRelationships(result)).toHaveLength(0);
	});

	test("returns empty array when only AGENTS.md files exist", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [],
		};

		expect(detectSymlinkRelationships(result)).toHaveLength(0);
	});

	test("returns empty array when only CLAUDE.md files exist", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha1", isSymlink: false },
			],
		};

		expect(detectSymlinkRelationships(result)).toHaveLength(0);
	});

	test("returns empty array when both files exist but neither is a symlink", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		expect(detectSymlinkRelationships(result)).toHaveLength(0);
	});

	test("detects AGENTS.md -> CLAUDE.md symlink relationship", () => {
		const claudeFile: IntentFile = {
			path: "CLAUDE.md",
			type: "claude",
			sha: "claude-sha",
			isSymlink: false,
		};
		const agentsFile: IntentFile = {
			path: "AGENTS.md",
			type: "agents",
			sha: "agents-sha",
			isSymlink: true,
			symlinkTarget: "CLAUDE.md",
		};
		const result: IntentLayerDetectionResult = {
			agentsFiles: [agentsFile],
			claudeFiles: [claudeFile],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(1);
		expect(relationships[0]).toEqual({
			directory: "",
			source: claudeFile,
			symlink: agentsFile,
			sourceType: "claude",
		});
	});

	test("detects CLAUDE.md -> AGENTS.md symlink relationship", () => {
		const agentsFile: IntentFile = {
			path: "AGENTS.md",
			type: "agents",
			sha: "agents-sha",
			isSymlink: false,
		};
		const claudeFile: IntentFile = {
			path: "CLAUDE.md",
			type: "claude",
			sha: "claude-sha",
			isSymlink: true,
			symlinkTarget: "AGENTS.md",
		};
		const result: IntentLayerDetectionResult = {
			agentsFiles: [agentsFile],
			claudeFiles: [claudeFile],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(1);
		expect(relationships[0]).toEqual({
			directory: "",
			source: agentsFile,
			symlink: claudeFile,
			sourceType: "agents",
		});
	});

	test("detects symlink with ./ prefix in target", () => {
		const agentsFile: IntentFile = {
			path: "AGENTS.md",
			type: "agents",
			sha: "agents-sha",
			isSymlink: false,
		};
		const claudeFile: IntentFile = {
			path: "CLAUDE.md",
			type: "claude",
			sha: "claude-sha",
			isSymlink: true,
			symlinkTarget: "./AGENTS.md",
		};
		const result: IntentLayerDetectionResult = {
			agentsFiles: [agentsFile],
			claudeFiles: [claudeFile],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(1);
		expect(relationships[0]!.sourceType).toBe("agents");
	});

	test("detects symlink relationships in nested directories", () => {
		const agentsFile: IntentFile = {
			path: "packages/api/AGENTS.md",
			type: "agents",
			sha: "agents-sha",
			isSymlink: true,
			symlinkTarget: "CLAUDE.md",
		};
		const claudeFile: IntentFile = {
			path: "packages/api/CLAUDE.md",
			type: "claude",
			sha: "claude-sha",
			isSymlink: false,
		};
		const result: IntentLayerDetectionResult = {
			agentsFiles: [agentsFile],
			claudeFiles: [claudeFile],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(1);
		expect(relationships[0]).toEqual({
			directory: "packages/api",
			source: claudeFile,
			symlink: agentsFile,
			sourceType: "claude",
		});
	});

	test("detects multiple symlink relationships at different levels", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "root-agents-sha",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
				{
					path: "src/AGENTS.md",
					type: "agents",
					sha: "src-agents-sha",
					isSymlink: false,
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "root-claude-sha",
					isSymlink: false,
				},
				{
					path: "src/CLAUDE.md",
					type: "claude",
					sha: "src-claude-sha",
					isSymlink: true,
					symlinkTarget: "AGENTS.md",
				},
			],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(2);

		// Root level: AGENTS.md -> CLAUDE.md
		expect(relationships[0]!.directory).toBe("");
		expect(relationships[0]!.sourceType).toBe("claude");

		// src level: CLAUDE.md -> AGENTS.md
		expect(relationships[1]!.directory).toBe("src");
		expect(relationships[1]!.sourceType).toBe("agents");
	});

	test("ignores files in different directories", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "agents-sha",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
			],
			claudeFiles: [
				{
					path: "src/CLAUDE.md",
					type: "claude",
					sha: "claude-sha",
					isSymlink: false,
				},
			],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(0);
	});

	test("ignores symlink when target is unknown", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "agents-sha",
					isSymlink: true,
					symlinkTarget: undefined, // Failed to read symlink target
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "claude-sha",
					isSymlink: false,
				},
			],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(0);
	});

	test("ignores symlink pointing to unrelated file", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "agents-sha",
					isSymlink: true,
					symlinkTarget: "README.md", // Points to unrelated file
				},
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "claude-sha",
					isSymlink: false,
				},
			],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(0);
	});

	test("sorts relationships with root directory first", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "z/AGENTS.md",
					type: "agents",
					sha: "z-sha",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "root-sha",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
				{
					path: "a/AGENTS.md",
					type: "agents",
					sha: "a-sha",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
			],
			claudeFiles: [
				{
					path: "z/CLAUDE.md",
					type: "claude",
					sha: "z-claude-sha",
					isSymlink: false,
				},
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "root-claude-sha",
					isSymlink: false,
				},
				{
					path: "a/CLAUDE.md",
					type: "claude",
					sha: "a-claude-sha",
					isSymlink: false,
				},
			],
		};

		const relationships = detectSymlinkRelationships(result);

		expect(relationships).toHaveLength(3);
		expect(relationships.map((r) => r.directory)).toEqual(["", "a", "z"]);
	});
});
