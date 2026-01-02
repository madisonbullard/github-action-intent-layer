import { describe, expect, test } from "bun:test";
import {
	createEmptyIgnore,
	INTENTLAYERIGNORE_FILENAME,
	IntentLayerIgnore,
	parseIntentLayerIgnore,
} from "../../src/patterns/ignore";

describe("IntentLayerIgnore", () => {
	describe("constructor", () => {
		test("creates an instance that ignores nothing by default", () => {
			const ig = new IntentLayerIgnore();
			expect(ig.ignores("any/file.ts")).toBe(false);
			expect(ig.ignores("node_modules/package/index.js")).toBe(false);
		});
	});

	describe("add", () => {
		test("adds patterns from string content", () => {
			const ig = new IntentLayerIgnore();
			ig.add("*.log\nnode_modules/");

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("node_modules/foo")).toBe(true);
			expect(ig.ignores("src/index.ts")).toBe(false);
		});

		test("supports chaining", () => {
			const ig = new IntentLayerIgnore().add("*.log").add("*.tmp");

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("cache.tmp")).toBe(true);
		});

		test("handles empty string", () => {
			const ig = new IntentLayerIgnore();
			ig.add("");
			expect(ig.ignores("any/file.ts")).toBe(false);
		});

		test("handles comments", () => {
			const ig = new IntentLayerIgnore();
			ig.add("# This is a comment\n*.log\n# Another comment");

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("# This is a comment")).toBe(false);
		});

		test("handles blank lines", () => {
			const ig = new IntentLayerIgnore();
			ig.add("*.log\n\n\n*.tmp\n");

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("cache.tmp")).toBe(true);
		});
	});

	describe("addPatterns", () => {
		test("adds patterns from array", () => {
			const ig = new IntentLayerIgnore();
			ig.addPatterns(["*.log", "node_modules/"]);

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("node_modules/foo")).toBe(true);
		});

		test("supports chaining", () => {
			const ig = new IntentLayerIgnore()
				.addPatterns(["*.log"])
				.addPatterns(["*.tmp"]);

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("cache.tmp")).toBe(true);
		});
	});

	describe("ignores", () => {
		test("matches simple glob patterns", () => {
			const ig = new IntentLayerIgnore().add("*.log");

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("error.log")).toBe(true);
			expect(ig.ignores("debug.txt")).toBe(false);
		});

		test("matches directory patterns", () => {
			const ig = new IntentLayerIgnore().add("node_modules/");

			expect(ig.ignores("node_modules/package")).toBe(true);
			expect(ig.ignores("node_modules/deep/nested/file.js")).toBe(true);
			expect(ig.ignores("src/node_modules")).toBe(false);
		});

		test("matches negation patterns", () => {
			const ig = new IntentLayerIgnore().add("*.log\n!important.log");

			expect(ig.ignores("debug.log")).toBe(true);
			expect(ig.ignores("important.log")).toBe(false);
		});

		test("matches double-star patterns", () => {
			const ig = new IntentLayerIgnore().add("**/test/**");

			expect(ig.ignores("test/unit/foo.ts")).toBe(true);
			expect(ig.ignores("packages/foo/test/bar.ts")).toBe(true);
			expect(ig.ignores("src/index.ts")).toBe(false);
		});

		test("matches specific file patterns", () => {
			const ig = new IntentLayerIgnore().add("package-lock.json\nyarn.lock");

			expect(ig.ignores("package-lock.json")).toBe(true);
			expect(ig.ignores("yarn.lock")).toBe(true);
			expect(ig.ignores("package.json")).toBe(false);
		});

		test("handles paths with leading slash correctly", () => {
			const ig = new IntentLayerIgnore().add("/root-only.txt");

			// Pattern /root-only.txt should only match at root
			expect(ig.ignores("root-only.txt")).toBe(true);
			expect(ig.ignores("subdir/root-only.txt")).toBe(false);
		});
	});

	describe("filter", () => {
		test("returns non-ignored paths", () => {
			const ig = new IntentLayerIgnore().add("*.log\nnode_modules/");
			const paths = [
				"src/index.ts",
				"debug.log",
				"node_modules/foo",
				"README.md",
			];

			const filtered = ig.filter(paths);
			expect(filtered).toEqual(["src/index.ts", "README.md"]);
		});

		test("returns empty array when all paths ignored", () => {
			const ig = new IntentLayerIgnore().add("*");
			const paths = ["file1.ts", "file2.ts"];

			expect(ig.filter(paths)).toEqual([]);
		});

		test("returns all paths when none ignored", () => {
			const ig = new IntentLayerIgnore();
			const paths = ["src/index.ts", "README.md"];

			expect(ig.filter(paths)).toEqual(paths);
		});
	});

	describe("createFilter", () => {
		test("returns a filter function", () => {
			const ig = new IntentLayerIgnore().add("*.log");
			const filterFn = ig.createFilter();

			expect(typeof filterFn).toBe("function");
			expect(filterFn("debug.log")).toBe(false); // filtered out
			expect(filterFn("index.ts")).toBe(true); // kept
		});

		test("works with Array.prototype.filter", () => {
			const ig = new IntentLayerIgnore().add("*.log");
			const paths = ["src/index.ts", "debug.log", "README.md"];

			const filtered = paths.filter(ig.createFilter());
			expect(filtered).toEqual(["src/index.ts", "README.md"]);
		});
	});
});

describe("parseIntentLayerIgnore", () => {
	test("parses content and returns configured instance", () => {
		const content = `
# Ignore generated files
dist/
build/
*.min.js

# Ignore dependencies
node_modules/

# But keep important configs
!important.config.js
`;
		const ig = parseIntentLayerIgnore(content);

		expect(ig.ignores("dist/bundle.js")).toBe(true);
		expect(ig.ignores("build/output")).toBe(true);
		expect(ig.ignores("app.min.js")).toBe(true);
		expect(ig.ignores("node_modules/package")).toBe(true);
		expect(ig.ignores("src/index.ts")).toBe(false);
	});

	test("handles real-world .gitignore-style content", () => {
		const content = `
# Logs
logs
*.log
npm-debug.log*

# Dependencies
node_modules/

# Build output
/dist
/build

# Environment files
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Test coverage
coverage/
`;
		const ig = parseIntentLayerIgnore(content);

		// Logs
		expect(ig.ignores("logs")).toBe(true);
		expect(ig.ignores("debug.log")).toBe(true);
		expect(ig.ignores("npm-debug.log.1")).toBe(true);

		// Dependencies
		expect(ig.ignores("node_modules/lodash")).toBe(true);

		// Build output
		expect(ig.ignores("dist/index.js")).toBe(true);
		expect(ig.ignores("build/app.js")).toBe(true);

		// Environment files
		expect(ig.ignores(".env")).toBe(true);
		expect(ig.ignores(".env.local")).toBe(true);
		expect(ig.ignores(".env.production.local")).toBe(true);

		// IDE
		expect(ig.ignores(".idea/workspace.xml")).toBe(true);
		expect(ig.ignores(".vscode/settings.json")).toBe(true);

		// OS
		expect(ig.ignores(".DS_Store")).toBe(true);

		// Test coverage
		expect(ig.ignores("coverage/lcov.info")).toBe(true);

		// Should NOT be ignored
		expect(ig.ignores("src/index.ts")).toBe(false);
		expect(ig.ignores("package.json")).toBe(false);
		expect(ig.ignores("README.md")).toBe(false);
	});
});

describe("createEmptyIgnore", () => {
	test("returns instance that ignores nothing", () => {
		const ig = createEmptyIgnore();

		expect(ig.ignores("any/path/file.ts")).toBe(false);
		expect(ig.ignores("node_modules/package")).toBe(false);
		expect(ig.ignores(".env")).toBe(false);
	});

	test("can have patterns added later", () => {
		const ig = createEmptyIgnore();
		ig.add("*.log");

		expect(ig.ignores("debug.log")).toBe(true);
		expect(ig.ignores("index.ts")).toBe(false);
	});
});

describe("INTENTLAYERIGNORE_FILENAME", () => {
	test("is correct filename", () => {
		expect(INTENTLAYERIGNORE_FILENAME).toBe(".intentlayerignore");
	});
});
