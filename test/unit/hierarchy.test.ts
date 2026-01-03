import { describe, expect, test } from "bun:test";
import type {
	IntentFile,
	IntentLayerDetectionResult,
} from "../../src/intent/detector";
import {
	buildHierarchies,
	buildHierarchy,
	findCoveringNode,
	findLeastCommonAncestor,
	findNearestParentDirectory,
	getAllNodes,
	getAncestors,
	getCoveredFilesForHierarchy,
	getCoveredFilesForNode,
	getDescendants,
	getDirectory,
	getMaxDepth,
	getNodeCount,
	isAncestorDirectory,
	traversePostOrder,
	traversePreOrder,
} from "../../src/intent/hierarchy";
import { IntentLayerIgnore } from "../../src/patterns/ignore";

/**
 * Helper to create an IntentFile for testing.
 */
function createIntentFile(
	path: string,
	type: "agents" | "claude" = "agents",
): IntentFile {
	return {
		path,
		type,
		sha: `sha-${path.replace(/\//g, "-")}`,
		isSymlink: false,
	};
}

describe("getDirectory", () => {
	test("returns empty string for root files", () => {
		expect(getDirectory("AGENTS.md")).toBe("");
		expect(getDirectory("CLAUDE.md")).toBe("");
	});

	test("returns parent directory for nested files", () => {
		expect(getDirectory("src/AGENTS.md")).toBe("src");
		expect(getDirectory("packages/api/AGENTS.md")).toBe("packages/api");
		expect(getDirectory("a/b/c/d/AGENTS.md")).toBe("a/b/c/d");
	});
});

describe("isAncestorDirectory", () => {
	test("root is ancestor of all non-root directories", () => {
		expect(isAncestorDirectory("", "src")).toBe(true);
		expect(isAncestorDirectory("", "packages/api")).toBe(true);
		expect(isAncestorDirectory("", "a/b/c")).toBe(true);
	});

	test("root is not ancestor of itself", () => {
		expect(isAncestorDirectory("", "")).toBe(false);
	});

	test("directory is not ancestor of itself", () => {
		expect(isAncestorDirectory("src", "src")).toBe(false);
		expect(isAncestorDirectory("packages/api", "packages/api")).toBe(false);
	});

	test("detects direct parent", () => {
		expect(isAncestorDirectory("src", "src/components")).toBe(true);
		expect(isAncestorDirectory("packages", "packages/api")).toBe(true);
	});

	test("detects grandparent", () => {
		expect(isAncestorDirectory("src", "src/components/ui")).toBe(true);
		expect(isAncestorDirectory("packages", "packages/api/src")).toBe(true);
	});

	test("returns false for unrelated directories", () => {
		expect(isAncestorDirectory("src", "packages")).toBe(false);
		expect(isAncestorDirectory("packages/api", "packages/core")).toBe(false);
	});

	test("returns false when descendant is shorter", () => {
		expect(isAncestorDirectory("packages/api", "packages")).toBe(false);
	});

	test("handles similar prefixes correctly", () => {
		// "src" should NOT be ancestor of "src-old"
		expect(isAncestorDirectory("src", "src-old")).toBe(false);
		expect(isAncestorDirectory("src", "srcfoo")).toBe(false);
	});
});

describe("findNearestParentDirectory", () => {
	test("returns undefined for root directory", () => {
		const allDirs = new Set(["", "src"]);
		expect(findNearestParentDirectory("", allDirs)).toBeUndefined();
	});

	test("finds immediate parent", () => {
		const allDirs = new Set(["", "src", "src/components"]);
		expect(findNearestParentDirectory("src/components", allDirs)).toBe("src");
	});

	test("finds root as parent when no intermediate exists", () => {
		const allDirs = new Set(["", "src/components/ui"]);
		expect(findNearestParentDirectory("src/components/ui", allDirs)).toBe("");
	});

	test("skips intermediate directories without intent files", () => {
		// Only root and deep nested have intent files
		const allDirs = new Set(["", "a/b/c"]);
		expect(findNearestParentDirectory("a/b/c", allDirs)).toBe("");
	});

	test("finds nearest ancestor among multiple", () => {
		const allDirs = new Set(["", "src", "src/components", "src/components/ui"]);
		expect(findNearestParentDirectory("src/components/ui", allDirs)).toBe(
			"src/components",
		);
	});

	test("returns undefined when no parent exists", () => {
		const allDirs = new Set(["src", "packages"]);
		expect(findNearestParentDirectory("src", allDirs)).toBeUndefined();
	});
});

describe("buildHierarchy", () => {
	test("returns empty hierarchy for no files", () => {
		const hierarchy = buildHierarchy([], "agents");

		expect(hierarchy.roots).toHaveLength(0);
		expect(hierarchy.nodesByPath.size).toBe(0);
		expect(hierarchy.fileType).toBe("agents");
	});

	test("builds single root node", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");

		expect(hierarchy.roots).toHaveLength(1);
		expect(hierarchy.roots[0]?.file.path).toBe("AGENTS.md");
		expect(hierarchy.roots[0]?.parent).toBeUndefined();
		expect(hierarchy.roots[0]?.children).toHaveLength(0);
		expect(hierarchy.roots[0]?.depth).toBe(0);
	});

	test("builds parent-child relationship", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		expect(hierarchy.roots).toHaveLength(1);

		const root = hierarchy.roots[0]!;
		expect(root.file.path).toBe("AGENTS.md");
		expect(root.children).toHaveLength(1);
		expect(root.depth).toBe(0);

		const child = root.children[0]!;
		expect(child.file.path).toBe("src/AGENTS.md");
		expect(child.parent).toBe(root);
		expect(child.depth).toBe(1);
	});

	test("builds multi-level hierarchy", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("src/components/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const root = hierarchy.roots[0]!;
		const srcNode = hierarchy.nodesByPath.get("src/AGENTS.md")!;
		const componentsNode = hierarchy.nodesByPath.get(
			"src/components/AGENTS.md",
		)!;

		expect(root.depth).toBe(0);
		expect(srcNode.depth).toBe(1);
		expect(componentsNode.depth).toBe(2);

		expect(srcNode.parent).toBe(root);
		expect(componentsNode.parent).toBe(srcNode);
	});

	test("handles multiple root nodes", () => {
		// When there's no root AGENTS.md, multiple top-level directories become roots
		const files = [
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		expect(hierarchy.roots).toHaveLength(2);
		expect(hierarchy.roots[0]?.parent).toBeUndefined();
		expect(hierarchy.roots[1]?.parent).toBeUndefined();
	});

	test("handles sibling directories correctly", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("tests/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const root = hierarchy.roots[0]!;
		expect(root.children).toHaveLength(2);
		expect(root.children.map((c) => c.file.path).sort()).toEqual([
			"src/AGENTS.md",
			"tests/AGENTS.md",
		]);
	});

	test("skips intermediate directories without intent files", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/api/src/AGENTS.md"), // No packages/api/AGENTS.md
		];
		const hierarchy = buildHierarchy(files, "agents");

		const root = hierarchy.roots[0]!;
		const deepNode = hierarchy.nodesByPath.get("packages/api/src/AGENTS.md")!;

		// Deep node should be direct child of root (no intermediate nodes)
		expect(deepNode.parent).toBe(root);
		expect(root.children).toHaveLength(1);
		expect(root.children[0]).toBe(deepNode);
	});

	test("builds claude hierarchy", () => {
		const files = [
			createIntentFile("CLAUDE.md", "claude"),
			createIntentFile("src/CLAUDE.md", "claude"),
		];
		const hierarchy = buildHierarchy(files, "claude");

		expect(hierarchy.fileType).toBe("claude");
		expect(hierarchy.roots).toHaveLength(1);
	});

	test("sorts roots and children alphabetically", () => {
		const files = [
			createIntentFile("z/AGENTS.md"),
			createIntentFile("a/AGENTS.md"),
			createIntentFile("m/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		expect(hierarchy.roots.map((r) => r.directory)).toEqual(["a", "m", "z"]);
	});

	test("complex hierarchy structure", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
			createIntentFile("packages/api/src/AGENTS.md"),
			createIntentFile("packages/api/test/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		// Root
		const root = hierarchy.roots[0]!;
		expect(root.file.path).toBe("AGENTS.md");
		expect(root.children).toHaveLength(1); // packages

		// packages
		const packages = hierarchy.nodesByPath.get("packages/AGENTS.md")!;
		expect(packages.parent).toBe(root);
		expect(packages.children).toHaveLength(2); // api, core

		// packages/api
		const api = hierarchy.nodesByPath.get("packages/api/AGENTS.md")!;
		expect(api.parent).toBe(packages);
		expect(api.children).toHaveLength(2); // src, test

		// packages/core
		const core = hierarchy.nodesByPath.get("packages/core/AGENTS.md")!;
		expect(core.parent).toBe(packages);
		expect(core.children).toHaveLength(0);

		// Depths
		expect(root.depth).toBe(0);
		expect(packages.depth).toBe(1);
		expect(api.depth).toBe(2);
		expect(core.depth).toBe(2);
		expect(hierarchy.nodesByPath.get("packages/api/src/AGENTS.md")?.depth).toBe(
			3,
		);
	});
});

describe("buildHierarchies", () => {
	test("builds both agents and claude hierarchies", () => {
		const detectionResult: IntentLayerDetectionResult = {
			agentsFiles: [
				createIntentFile("AGENTS.md"),
				createIntentFile("src/AGENTS.md"),
			],
			claudeFiles: [
				createIntentFile("CLAUDE.md", "claude"),
				createIntentFile("packages/CLAUDE.md", "claude"),
			],
		};

		const hierarchies = buildHierarchies(detectionResult);

		expect(hierarchies.agents.fileType).toBe("agents");
		expect(hierarchies.agents.nodesByPath.size).toBe(2);

		expect(hierarchies.claude.fileType).toBe("claude");
		expect(hierarchies.claude.nodesByPath.size).toBe(2);
	});
});

describe("getAncestors", () => {
	test("returns empty array for root node", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		expect(getAncestors(root)).toHaveLength(0);
	});

	test("returns immediate parent for child node", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const child = hierarchy.nodesByPath.get("src/AGENTS.md")!;

		const ancestors = getAncestors(child);
		expect(ancestors).toHaveLength(1);
		expect(ancestors[0]?.file.path).toBe("AGENTS.md");
	});

	test("returns all ancestors from child to root", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const deepNode = hierarchy.nodesByPath.get("packages/api/AGENTS.md")!;

		const ancestors = getAncestors(deepNode);
		expect(ancestors).toHaveLength(2);
		expect(ancestors[0]?.file.path).toBe("packages/AGENTS.md"); // immediate parent
		expect(ancestors[1]?.file.path).toBe("AGENTS.md"); // root
	});
});

describe("getDescendants", () => {
	test("returns empty array for leaf node", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		expect(getDescendants(root)).toHaveLength(0);
	});

	test("returns direct children", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const descendants = getDescendants(root);
		expect(descendants).toHaveLength(1);
		expect(descendants[0]?.file.path).toBe("src/AGENTS.md");
	});

	test("returns all descendants", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const descendants = getDescendants(root);
		expect(descendants).toHaveLength(3);
		expect(descendants.map((d) => d.file.path).sort()).toEqual([
			"packages/AGENTS.md",
			"packages/api/AGENTS.md",
			"packages/core/AGENTS.md",
		]);
	});
});

describe("findCoveringNode", () => {
	test("returns undefined for empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");

		expect(findCoveringNode("src/index.ts", hierarchy)).toBeUndefined();
	});

	test("finds root node for files in root directory", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");

		const covering = findCoveringNode("index.ts", hierarchy);
		expect(covering?.file.path).toBe("AGENTS.md");
	});

	test("finds root node for nested files when only root exists", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");

		const covering = findCoveringNode("src/components/Button.tsx", hierarchy);
		expect(covering?.file.path).toBe("AGENTS.md");
	});

	test("finds exact directory match", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const covering = findCoveringNode("src/index.ts", hierarchy);
		expect(covering?.file.path).toBe("src/AGENTS.md");
	});

	test("finds nearest parent when exact match not available", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const covering = findCoveringNode("src/components/Button.tsx", hierarchy);
		expect(covering?.file.path).toBe("src/AGENTS.md");
	});

	test("finds most specific covering node", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const covering = findCoveringNode("packages/api/src/handler.ts", hierarchy);
		expect(covering?.file.path).toBe("packages/api/AGENTS.md");
	});

	test("returns undefined when file is outside covered areas", () => {
		// No root AGENTS.md, only in src/
		const files = [createIntentFile("src/AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");

		const covering = findCoveringNode("packages/index.ts", hierarchy);
		expect(covering).toBeUndefined();
	});
});

describe("findLeastCommonAncestor", () => {
	test("returns node itself when both nodes are the same", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		expect(findLeastCommonAncestor(root, root)).toBe(root);
	});

	test("returns parent when one node is ancestor of other", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;
		const child = hierarchy.nodesByPath.get("src/AGENTS.md")!;

		expect(findLeastCommonAncestor(root, child)).toBe(root);
		expect(findLeastCommonAncestor(child, root)).toBe(root);
	});

	test("finds common ancestor for siblings", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("tests/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;
		const srcNode = hierarchy.nodesByPath.get("src/AGENTS.md")!;
		const testsNode = hierarchy.nodesByPath.get("tests/AGENTS.md")!;

		expect(findLeastCommonAncestor(srcNode, testsNode)).toBe(root);
	});

	test("finds common ancestor for cousins", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const packages = hierarchy.nodesByPath.get("packages/AGENTS.md")!;
		const api = hierarchy.nodesByPath.get("packages/api/AGENTS.md")!;
		const core = hierarchy.nodesByPath.get("packages/core/AGENTS.md")!;

		expect(findLeastCommonAncestor(api, core)).toBe(packages);
	});

	test("returns undefined for unrelated trees", () => {
		// Two separate trees with no common ancestor
		const files = [
			createIntentFile("packages/api/AGENTS.md"),
			createIntentFile("packages/core/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const api = hierarchy.nodesByPath.get("packages/api/AGENTS.md")!;
		const core = hierarchy.nodesByPath.get("packages/core/AGENTS.md")!;

		expect(findLeastCommonAncestor(api, core)).toBeUndefined();
	});
});

describe("traversePreOrder", () => {
	test("visits nodes in pre-order (parent before children)", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("src/components/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const visited: string[] = [];
		traversePreOrder(hierarchy, (node) => {
			visited.push(node.file.path);
		});

		expect(visited).toEqual([
			"AGENTS.md",
			"src/AGENTS.md",
			"src/components/AGENTS.md",
		]);
	});

	test("handles multiple roots", () => {
		const files = [
			createIntentFile("a/AGENTS.md"),
			createIntentFile("b/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const visited: string[] = [];
		traversePreOrder(hierarchy, (node) => {
			visited.push(node.file.path);
		});

		expect(visited).toEqual(["a/AGENTS.md", "b/AGENTS.md"]);
	});
});

describe("traversePostOrder", () => {
	test("visits nodes in post-order (children before parent)", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("src/components/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const visited: string[] = [];
		traversePostOrder(hierarchy, (node) => {
			visited.push(node.file.path);
		});

		expect(visited).toEqual([
			"src/components/AGENTS.md",
			"src/AGENTS.md",
			"AGENTS.md",
		]);
	});

	test("handles multiple roots", () => {
		const files = [
			createIntentFile("a/AGENTS.md"),
			createIntentFile("a/sub/AGENTS.md"),
			createIntentFile("b/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const visited: string[] = [];
		traversePostOrder(hierarchy, (node) => {
			visited.push(node.file.path);
		});

		expect(visited).toEqual(["a/sub/AGENTS.md", "a/AGENTS.md", "b/AGENTS.md"]);
	});
});

describe("getAllNodes", () => {
	test("returns empty array for empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");
		expect(getAllNodes(hierarchy)).toHaveLength(0);
	});

	test("returns all nodes", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const nodes = getAllNodes(hierarchy);
		expect(nodes).toHaveLength(2);
	});
});

describe("getNodeCount", () => {
	test("returns 0 for empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");
		expect(getNodeCount(hierarchy)).toBe(0);
	});

	test("returns correct count", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("tests/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		expect(getNodeCount(hierarchy)).toBe(3);
	});
});

describe("getMaxDepth", () => {
	test("returns 0 for empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");
		expect(getMaxDepth(hierarchy)).toBe(0);
	});

	test("returns 1 for single root", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		expect(getMaxDepth(hierarchy)).toBe(1);
	});

	test("returns correct max depth", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
			createIntentFile("src/components/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		expect(getMaxDepth(hierarchy)).toBe(3);
	});

	test("handles multiple branches of different depths", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("shallow/AGENTS.md"),
			createIntentFile("deep/a/b/c/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		// deep/a/b/c is depth 1 from root (skipping intermediate directories)
		expect(getMaxDepth(hierarchy)).toBe(2);
	});
});

describe("getCoveredFilesForNode", () => {
	test("returns empty for empty file list", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const result = getCoveredFilesForNode(root, [], hierarchy);

		expect(result.coveredFiles).toHaveLength(0);
		expect(result.ignoredFiles).toHaveLength(0);
		expect(result.node).toBe(root);
	});

	test("covers files in root directory", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const allFiles = ["index.ts", "package.json", "README.md"];
		const result = getCoveredFilesForNode(root, allFiles, hierarchy);

		expect(result.coveredFiles).toEqual([
			"README.md",
			"index.ts",
			"package.json",
		]);
	});

	test("covers files in subdirectories when root is only node", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const allFiles = ["index.ts", "src/main.ts", "src/utils/helper.ts"];
		const result = getCoveredFilesForNode(root, allFiles, hierarchy);

		expect(result.coveredFiles).toEqual([
			"index.ts",
			"src/main.ts",
			"src/utils/helper.ts",
		]);
	});

	test("respects more specific nodes", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;
		const srcNode = hierarchy.nodesByPath.get("src/AGENTS.md")!;

		const allFiles = [
			"index.ts",
			"package.json",
			"src/main.ts",
			"src/utils/helper.ts",
		];

		const rootResult = getCoveredFilesForNode(root, allFiles, hierarchy);
		const srcResult = getCoveredFilesForNode(srcNode, allFiles, hierarchy);

		// Root should only cover files in root directory
		expect(rootResult.coveredFiles).toEqual(["index.ts", "package.json"]);

		// src node should cover files in src/ directory
		expect(srcResult.coveredFiles).toEqual([
			"src/main.ts",
			"src/utils/helper.ts",
		]);
	});

	test("excludes intent files from coverage", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const allFiles = [
			"index.ts",
			"AGENTS.md",
			"CLAUDE.md",
			"src/AGENTS.md",
			"src/main.ts",
		];
		const result = getCoveredFilesForNode(root, allFiles, hierarchy);

		// Should exclude all intent files
		expect(result.coveredFiles).toEqual(["index.ts", "src/main.ts"]);
	});

	test("respects .intentlayerignore patterns", () => {
		const files = [createIntentFile("AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const root = hierarchy.roots[0]!;

		const ignore = new IntentLayerIgnore();
		ignore.add("*.log\nnode_modules/\ndist/");

		const allFiles = [
			"index.ts",
			"debug.log",
			"node_modules/package/index.js",
			"dist/bundle.js",
			"src/main.ts",
		];
		const result = getCoveredFilesForNode(root, allFiles, hierarchy, ignore);

		expect(result.coveredFiles).toEqual(["index.ts", "src/main.ts"]);
		expect(result.ignoredFiles).toEqual([
			"debug.log",
			"dist/bundle.js",
			"node_modules/package/index.js",
		]);
	});

	test("handles node in subdirectory without root", () => {
		const files = [createIntentFile("packages/api/AGENTS.md")];
		const hierarchy = buildHierarchy(files, "agents");
		const apiNode = hierarchy.roots[0]!;

		const allFiles = [
			"index.ts", // Not covered (outside packages/api)
			"packages/api/src/handler.ts",
			"packages/api/test/handler.test.ts",
			"packages/core/index.ts", // Not covered (different package)
		];
		const result = getCoveredFilesForNode(apiNode, allFiles, hierarchy);

		expect(result.coveredFiles).toEqual([
			"packages/api/src/handler.ts",
			"packages/api/test/handler.test.ts",
		]);
	});

	test("complex hierarchy with multiple levels", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("packages/AGENTS.md"),
			createIntentFile("packages/api/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const allFiles = [
			"README.md",
			"packages/shared.ts",
			"packages/api/handler.ts",
			"packages/api/routes/users.ts",
			"packages/core/index.ts",
		];

		const rootResult = getCoveredFilesForNode(
			hierarchy.roots[0]!,
			allFiles,
			hierarchy,
		);
		const packagesResult = getCoveredFilesForNode(
			hierarchy.nodesByPath.get("packages/AGENTS.md")!,
			allFiles,
			hierarchy,
		);
		const apiResult = getCoveredFilesForNode(
			hierarchy.nodesByPath.get("packages/api/AGENTS.md")!,
			allFiles,
			hierarchy,
		);

		// Root covers only root directory files
		expect(rootResult.coveredFiles).toEqual(["README.md"]);

		// packages node covers packages/ but not packages/api/
		expect(packagesResult.coveredFiles).toEqual([
			"packages/core/index.ts",
			"packages/shared.ts",
		]);

		// api node covers packages/api/
		expect(apiResult.coveredFiles).toEqual([
			"packages/api/handler.ts",
			"packages/api/routes/users.ts",
		]);
	});
});

describe("getCoveredFilesForHierarchy", () => {
	test("returns empty map for empty hierarchy", () => {
		const hierarchy = buildHierarchy([], "agents");
		const results = getCoveredFilesForHierarchy(hierarchy, ["file.ts"]);

		expect(results.size).toBe(0);
	});

	test("calculates coverage for all nodes", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const allFiles = ["index.ts", "src/main.ts", "src/utils/helper.ts"];
		const results = getCoveredFilesForHierarchy(hierarchy, allFiles);

		expect(results.size).toBe(2);
		expect(results.get("AGENTS.md")?.coveredFiles).toEqual(["index.ts"]);
		expect(results.get("src/AGENTS.md")?.coveredFiles).toEqual([
			"src/main.ts",
			"src/utils/helper.ts",
		]);
	});

	test("applies ignore patterns to all nodes", () => {
		const files = [
			createIntentFile("AGENTS.md"),
			createIntentFile("src/AGENTS.md"),
		];
		const hierarchy = buildHierarchy(files, "agents");

		const ignore = new IntentLayerIgnore();
		ignore.add("*.test.ts");

		const allFiles = [
			"index.ts",
			"index.test.ts",
			"src/main.ts",
			"src/main.test.ts",
		];
		const results = getCoveredFilesForHierarchy(hierarchy, allFiles, ignore);

		expect(results.get("AGENTS.md")?.coveredFiles).toEqual(["index.ts"]);
		expect(results.get("AGENTS.md")?.ignoredFiles).toEqual(["index.test.ts"]);
		expect(results.get("src/AGENTS.md")?.coveredFiles).toEqual(["src/main.ts"]);
		expect(results.get("src/AGENTS.md")?.ignoredFiles).toEqual([
			"src/main.test.ts",
		]);
	});
});
