/**
 * Test fixture loader utilities for integration testing.
 *
 * Provides functions to load fixture data and create mocked GitHub API responses
 * based on fixture files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Structure of a fixture's files.json
 */
export interface FixtureFiles {
	[path: string]: string;
}

/**
 * Structure of a fixture's tree.json (GitHub API compatible)
 */
export interface FixtureTree {
	sha: string;
	tree: Array<{
		path: string;
		mode: string;
		type: "blob" | "tree";
		sha: string;
	}>;
	/** Optional symlink targets for mode 120000 entries */
	symlinkTargets?: Record<string, string>;
}

/**
 * Structure of a fixture's config.json
 */
export interface FixtureConfig {
	description: string;
	expectedIntentFiles: string[];
	expectedSymlinks: Array<{
		source: string;
		target: string;
	}>;
	expectedBehavior?: {
		shouldSuggestRootAgentsMd?: boolean;
		shouldSuggestHierarchy?: boolean;
		canUpdateExistingNode?: boolean;
		symlinkSource?: "agents" | "claude";
		shouldDetectSymlink?: boolean;
	};
	expectedHierarchy?: {
		roots: string[];
		children: Record<string, string[]>;
	};
	expectedCoverage?: Record<string, string[]>;
	configOverrides?: Record<string, unknown>;
}

/**
 * Complete loaded fixture data
 */
export interface LoadedFixture {
	name: string;
	files: FixtureFiles;
	tree: FixtureTree;
	config: FixtureConfig;
}

/**
 * List available fixture names
 */
export function listFixtures(): string[] {
	const fixturesDir = __dirname;
	return readdirSync(fixturesDir, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);
}

/**
 * Load a fixture by name
 */
export function loadFixture(name: string): LoadedFixture {
	const fixtureDir = join(__dirname, name);

	if (!existsSync(fixtureDir)) {
		throw new Error(`Fixture '${name}' not found at ${fixtureDir}`);
	}

	const filesPath = join(fixtureDir, "files.json");
	const treePath = join(fixtureDir, "tree.json");
	const configPath = join(fixtureDir, "config.json");

	if (!existsSync(filesPath)) {
		throw new Error(`Fixture '${name}' is missing files.json`);
	}
	if (!existsSync(treePath)) {
		throw new Error(`Fixture '${name}' is missing tree.json`);
	}
	if (!existsSync(configPath)) {
		throw new Error(`Fixture '${name}' is missing config.json`);
	}

	return {
		name,
		files: JSON.parse(readFileSync(filesPath, "utf-8")),
		tree: JSON.parse(readFileSync(treePath, "utf-8")),
		config: JSON.parse(readFileSync(configPath, "utf-8")),
	};
}

/**
 * Get file content from a loaded fixture
 */
export function getFileContent(
	fixture: LoadedFixture,
	path: string,
): string | undefined {
	return fixture.files[path];
}

/**
 * Get all file paths from a loaded fixture
 */
export function getFilePaths(fixture: LoadedFixture): string[] {
	return Object.keys(fixture.files);
}

/**
 * Create a mock GitHub tree API response from a fixture
 */
export function createMockTreeResponse(fixture: LoadedFixture) {
	return {
		data: fixture.tree,
	};
}

/**
 * Create a mock GitHub blob API response for a specific file
 */
export function createMockBlobResponse(fixture: LoadedFixture, sha: string) {
	// Find the file by SHA in the tree
	const treeEntry = fixture.tree.tree.find((entry) => entry.sha === sha);

	if (!treeEntry) {
		throw new Error(
			`Blob with SHA '${sha}' not found in fixture '${fixture.name}'`,
		);
	}

	// Check if this is a symlink (mode 120000)
	if (treeEntry.mode === "120000") {
		// Return the symlink target from the symlinkTargets map
		const target = fixture.tree.symlinkTargets?.[sha];
		if (!target) {
			throw new Error(
				`Symlink target not found for SHA '${sha}' in fixture '${fixture.name}'`,
			);
		}
		return {
			data: {
				content: Buffer.from(target).toString("base64"),
				encoding: "base64",
			},
		};
	}

	// Regular file - get content from files.json
	const content = fixture.files[treeEntry.path];
	if (content === undefined) {
		throw new Error(
			`File content not found for path '${treeEntry.path}' in fixture '${fixture.name}'`,
		);
	}

	return {
		data: {
			content: Buffer.from(content).toString("base64"),
			encoding: "base64",
		},
	};
}

/**
 * Get expected intent files from fixture config
 */
export function getExpectedIntentFiles(fixture: LoadedFixture): string[] {
	return fixture.config.expectedIntentFiles;
}

/**
 * Check if fixture expects root AGENTS.md suggestion
 */
export function shouldSuggestRootAgentsMd(fixture: LoadedFixture): boolean {
	return fixture.config.expectedBehavior?.shouldSuggestRootAgentsMd ?? false;
}

/**
 * Create mock GitHub API helpers for a fixture
 */
export function createFixtureMocks(fixture: LoadedFixture) {
	return {
		getRef: () =>
			Promise.resolve({
				data: {
					object: { sha: "commit-sha-fixture" },
				},
			}),

		getCommit: () =>
			Promise.resolve({
				data: {
					tree: { sha: fixture.tree.sha },
				},
			}),

		getTree: () => Promise.resolve(createMockTreeResponse(fixture)),

		getBlob: (sha: string) =>
			Promise.resolve(createMockBlobResponse(fixture, sha)),

		getDefaultBranch: () =>
			Promise.resolve({ data: { default_branch: "main" } }),
	};
}
