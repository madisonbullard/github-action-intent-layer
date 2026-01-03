import { describe, expect, test } from "bun:test";
import {
	createFixtureMocks,
	createMockBlobResponse,
	createMockTreeResponse,
	getExpectedIntentFiles,
	getFileContent,
	getFilePaths,
	listFixtures,
	loadFixture,
	shouldSuggestRootAgentsMd,
} from "../fixtures";

describe("test setup", () => {
	test("bun test runner is configured correctly", () => {
		expect(true).toBe(true);
	});

	test("can perform basic assertions", () => {
		expect(2 + 2).toBe(4);
		expect("hello").toContain("ell");
		expect([1, 2, 3]).toHaveLength(3);
	});

	test("can handle async operations", async () => {
		const result = await Promise.resolve(42);
		expect(result).toBe(42);
	});
});

describe("Test Fixtures Setup", () => {
	describe("listFixtures", () => {
		test("returns available fixture names", () => {
			const fixtures = listFixtures();

			expect(Array.isArray(fixtures)).toBe(true);
			expect(fixtures.length).toBeGreaterThan(0);
			expect(fixtures).toContain("no-intent-layer");
			expect(fixtures).toContain("basic-agents");
			expect(fixtures).toContain("nested-hierarchy");
		});
	});

	describe("loadFixture", () => {
		test("loads no-intent-layer fixture", () => {
			const fixture = loadFixture("no-intent-layer");

			expect(fixture.name).toBe("no-intent-layer");
			expect(fixture.config.description).toContain("without any intent layer");
			expect(fixture.config.expectedIntentFiles).toHaveLength(0);
			expect(fixture.files["README.md"]).toBeDefined();
			expect(fixture.files["src/index.ts"]).toBeDefined();
		});

		test("loads basic-agents fixture", () => {
			const fixture = loadFixture("basic-agents");

			expect(fixture.name).toBe("basic-agents");
			expect(fixture.config.expectedIntentFiles).toEqual(["AGENTS.md"]);
			expect(fixture.files["AGENTS.md"]).toBeDefined();
			expect(fixture.files["AGENTS.md"]).toContain("# AGENTS.md");
		});

		test("loads nested-hierarchy fixture", () => {
			const fixture = loadFixture("nested-hierarchy");

			expect(fixture.name).toBe("nested-hierarchy");
			expect(fixture.config.expectedIntentFiles).toHaveLength(3);
			expect(fixture.config.expectedIntentFiles).toContain("AGENTS.md");
			expect(fixture.config.expectedIntentFiles).toContain(
				"packages/api/AGENTS.md",
			);
			expect(fixture.config.expectedIntentFiles).toContain(
				"packages/core/AGENTS.md",
			);
		});

		test("throws error for non-existent fixture", () => {
			expect(() => loadFixture("non-existent-fixture")).toThrow("not found");
		});
	});

	describe("getFileContent", () => {
		test("returns file content for existing file", () => {
			const fixture = loadFixture("basic-agents");
			const content = getFileContent(fixture, "AGENTS.md");

			expect(content).toBeDefined();
			expect(content).toContain("# AGENTS.md");
		});

		test("returns undefined for non-existent file", () => {
			const fixture = loadFixture("basic-agents");
			const content = getFileContent(fixture, "non-existent.ts");

			expect(content).toBeUndefined();
		});
	});

	describe("getFilePaths", () => {
		test("returns all file paths", () => {
			const fixture = loadFixture("basic-agents");
			const paths = getFilePaths(fixture);

			expect(paths).toContain("AGENTS.md");
			expect(paths).toContain("README.md");
			expect(paths).toContain("src/index.ts");
		});
	});

	describe("createMockTreeResponse", () => {
		test("creates GitHub API compatible tree response", () => {
			const fixture = loadFixture("basic-agents");
			const response = createMockTreeResponse(fixture);

			expect(response.data).toBeDefined();
			expect(response.data.sha).toBeDefined();
			expect(response.data.tree).toBeInstanceOf(Array);
			expect(response.data.tree.length).toBeGreaterThan(0);

			// Check tree entry structure
			const agentsEntry = response.data.tree.find(
				(e) => e.path === "AGENTS.md",
			);
			expect(agentsEntry).toBeDefined();
			expect(agentsEntry?.mode).toBe("100644");
			expect(agentsEntry?.type).toBe("blob");
			expect(agentsEntry?.sha).toBeDefined();
		});
	});

	describe("createMockBlobResponse", () => {
		test("creates GitHub API compatible blob response for regular file", () => {
			const fixture = loadFixture("basic-agents");
			const treeEntry = fixture.tree.tree.find((e) => e.path === "AGENTS.md");

			expect(treeEntry).toBeDefined();

			const response = createMockBlobResponse(fixture, treeEntry!.sha);

			expect(response.data).toBeDefined();
			expect(response.data.content).toBeDefined();
			expect(response.data.encoding).toBe("base64");

			// Decode and verify content
			const content = Buffer.from(response.data.content, "base64").toString(
				"utf-8",
			);
			expect(content).toContain("# AGENTS.md");
		});

		test("throws for non-existent SHA", () => {
			const fixture = loadFixture("basic-agents");

			expect(() =>
				createMockBlobResponse(fixture, "non-existent-sha"),
			).toThrow();
		});
	});

	describe("getExpectedIntentFiles", () => {
		test("returns expected intent files from config", () => {
			const fixture = loadFixture("nested-hierarchy");
			const expected = getExpectedIntentFiles(fixture);

			expect(expected).toHaveLength(3);
			expect(expected).toContain("AGENTS.md");
		});
	});

	describe("shouldSuggestRootAgentsMd", () => {
		test("returns true for no-intent-layer fixture", () => {
			const fixture = loadFixture("no-intent-layer");

			expect(shouldSuggestRootAgentsMd(fixture)).toBe(true);
		});

		test("returns false for basic-agents fixture", () => {
			const fixture = loadFixture("basic-agents");

			expect(shouldSuggestRootAgentsMd(fixture)).toBe(false);
		});
	});

	describe("createFixtureMocks", () => {
		test("creates mock functions for GitHub API", async () => {
			const fixture = loadFixture("basic-agents");
			const mocks = createFixtureMocks(fixture);

			// Test getRef
			const refResult = await mocks.getRef();
			expect(refResult.data.object.sha).toBeDefined();

			// Test getCommit
			const commitResult = await mocks.getCommit();
			expect(commitResult.data.tree.sha).toBe(fixture.tree.sha);

			// Test getTree
			const treeResult = await mocks.getTree();
			expect(treeResult.data.tree).toBeInstanceOf(Array);

			// Test getDefaultBranch
			const branchResult = await mocks.getDefaultBranch();
			expect(branchResult.data.default_branch).toBe("main");
		});
	});

	describe("symlink fixture", () => {
		test("loads symlink-agents-source fixture", () => {
			const fixture = loadFixture("symlink-agents-source");

			expect(fixture.name).toBe("symlink-agents-source");
			expect(fixture.files["AGENTS.md"]).toBeDefined();
			expect(fixture.files["CLAUDE.md"]).toBe("-> AGENTS.md");

			// Check tree has symlink mode
			const claudeEntry = fixture.tree.tree.find((e) => e.path === "CLAUDE.md");
			expect(claudeEntry).toBeDefined();
			expect(claudeEntry?.mode).toBe("120000"); // Symlink mode
		});

		test("createMockBlobResponse handles symlinks", () => {
			const fixture = loadFixture("symlink-agents-source");
			const claudeEntry = fixture.tree.tree.find((e) => e.path === "CLAUDE.md");

			expect(claudeEntry).toBeDefined();

			const response = createMockBlobResponse(fixture, claudeEntry!.sha);

			// Decode and verify it returns the symlink target
			const content = Buffer.from(response.data.content, "base64").toString(
				"utf-8",
			);
			expect(content).toBe("AGENTS.md");
		});
	});
});
