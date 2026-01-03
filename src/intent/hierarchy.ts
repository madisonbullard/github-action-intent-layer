/**
 * Intent Layer Hierarchy
 *
 * Builds and traverses a hierarchical tree of intent nodes.
 * Intent nodes (AGENTS.md/CLAUDE.md) cover their directory and all subdirectories.
 * The hierarchy is determined by the file system structure - each node's parent
 * is the nearest ancestor intent file.
 */

import type { IntentLayerIgnore } from "../patterns/ignore";
import type { IntentFile, IntentLayerDetectionResult } from "./detector";

/**
 * A node in the intent layer hierarchy tree.
 * Each node represents an AGENTS.md or CLAUDE.md file and its coverage.
 */
export interface IntentNode {
	/** The intent file this node represents */
	file: IntentFile;
	/** Directory this node covers (empty string for root) */
	directory: string;
	/** Parent node (undefined for root nodes) */
	parent: IntentNode | undefined;
	/** Child nodes (intent files in subdirectories) */
	children: IntentNode[];
	/** Depth in the hierarchy (0 for root-level nodes) */
	depth: number;
}

/**
 * The complete intent layer hierarchy.
 */
export interface IntentHierarchy {
	/** Root-level nodes (nodes with no parent intent file above them) */
	roots: IntentNode[];
	/** All nodes indexed by their file path for quick lookup */
	nodesByPath: Map<string, IntentNode>;
	/** File type this hierarchy represents: 'agents' or 'claude' */
	fileType: "agents" | "claude";
}

/**
 * Get the directory path from a file path.
 *
 * @param filePath - Full file path (e.g., "packages/api/AGENTS.md")
 * @returns Directory path (e.g., "packages/api"), or empty string for root files
 */
export function getDirectory(filePath: string): string {
	const lastSlash = filePath.lastIndexOf("/");
	return lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
}

/**
 * Check if a directory is an ancestor of another directory.
 *
 * @param ancestor - Potential ancestor directory
 * @param descendant - Potential descendant directory
 * @returns True if ancestor is a parent/grandparent/etc of descendant
 */
export function isAncestorDirectory(
	ancestor: string,
	descendant: string,
): boolean {
	// Root (empty string) is ancestor of everything except itself
	if (ancestor === "") {
		return descendant !== "";
	}

	// descendant must start with ancestor path and have a separator after
	return (
		descendant.startsWith(ancestor) &&
		descendant.length > ancestor.length &&
		descendant[ancestor.length] === "/"
	);
}

/**
 * Find the nearest parent intent file for a given directory.
 *
 * @param directory - Directory to find parent for
 * @param allDirectories - Set of all directories that have intent files
 * @returns The nearest ancestor directory that has an intent file, or undefined
 */
export function findNearestParentDirectory(
	directory: string,
	allDirectories: Set<string>,
): string | undefined {
	if (directory === "") {
		return undefined;
	}

	// Walk up the directory tree
	let current = directory;
	while (current !== "") {
		const lastSlash = current.lastIndexOf("/");
		const parent = lastSlash === -1 ? "" : current.substring(0, lastSlash);

		if (allDirectories.has(parent)) {
			return parent;
		}

		current = parent;
	}

	return undefined;
}

/**
 * Build a hierarchy tree from a list of intent files.
 *
 * @param files - Array of intent files (all same type: agents or claude)
 * @param fileType - The type of files being processed
 * @returns The hierarchical tree structure
 */
export function buildHierarchy(
	files: IntentFile[],
	fileType: "agents" | "claude",
): IntentHierarchy {
	const nodesByPath = new Map<string, IntentNode>();
	const nodesByDirectory = new Map<string, IntentNode>();
	const roots: IntentNode[] = [];

	// First pass: create all nodes
	for (const file of files) {
		const directory = getDirectory(file.path);
		const node: IntentNode = {
			file,
			directory,
			parent: undefined,
			children: [],
			depth: 0,
		};
		nodesByPath.set(file.path, node);
		nodesByDirectory.set(directory, node);
	}

	// Get all directories that have intent files
	const allDirectories = new Set(nodesByDirectory.keys());

	// Second pass: establish parent-child relationships
	for (const node of nodesByPath.values()) {
		const parentDir = findNearestParentDirectory(
			node.directory,
			allDirectories,
		);

		if (parentDir !== undefined) {
			const parentNode = nodesByDirectory.get(parentDir);
			if (parentNode) {
				node.parent = parentNode;
				parentNode.children.push(node);
			}
		} else {
			// No parent found - this is a root node
			roots.push(node);
		}
	}

	// Third pass: calculate depths
	function calculateDepth(node: IntentNode, depth: number): void {
		node.depth = depth;
		for (const child of node.children) {
			calculateDepth(child, depth + 1);
		}
	}

	for (const root of roots) {
		calculateDepth(root, 0);
	}

	// Sort roots and children by path for consistent ordering
	roots.sort((a, b) => a.file.path.localeCompare(b.file.path));
	for (const node of nodesByPath.values()) {
		node.children.sort((a, b) => a.file.path.localeCompare(b.file.path));
	}

	return {
		roots,
		nodesByPath,
		fileType,
	};
}

/**
 * Build hierarchies for both agents and claude files from detection results.
 *
 * @param detectionResult - Results from detectIntentLayer
 * @returns Object containing both hierarchies
 */
export function buildHierarchies(detectionResult: IntentLayerDetectionResult): {
	agents: IntentHierarchy;
	claude: IntentHierarchy;
} {
	return {
		agents: buildHierarchy(detectionResult.agentsFiles, "agents"),
		claude: buildHierarchy(detectionResult.claudeFiles, "claude"),
	};
}

/**
 * Get all ancestor nodes for a given node (from immediate parent to root).
 *
 * @param node - The starting node
 * @returns Array of ancestor nodes, ordered from immediate parent to root
 */
export function getAncestors(node: IntentNode): IntentNode[] {
	const ancestors: IntentNode[] = [];
	let current = node.parent;

	while (current) {
		ancestors.push(current);
		current = current.parent;
	}

	return ancestors;
}

/**
 * Get all descendant nodes for a given node (all children, grandchildren, etc).
 *
 * @param node - The starting node
 * @returns Array of all descendant nodes
 */
export function getDescendants(node: IntentNode): IntentNode[] {
	const descendants: IntentNode[] = [];

	function collectDescendants(current: IntentNode): void {
		for (const child of current.children) {
			descendants.push(child);
			collectDescendants(child);
		}
	}

	collectDescendants(node);
	return descendants;
}

/**
 * Find the covering intent node for a given file path.
 * The covering node is the nearest ancestor intent file.
 *
 * @param filePath - Path to a file in the repository
 * @param hierarchy - The intent hierarchy to search
 * @returns The nearest covering intent node, or undefined if none
 */
export function findCoveringNode(
	filePath: string,
	hierarchy: IntentHierarchy,
): IntentNode | undefined {
	const fileDir = getDirectory(filePath);

	// Check if there's an intent file in the same directory
	for (const node of hierarchy.nodesByPath.values()) {
		if (node.directory === fileDir) {
			return node;
		}
	}

	// Find the nearest parent directory with an intent file
	const allDirectories = new Set<string>();
	for (const node of hierarchy.nodesByPath.values()) {
		allDirectories.add(node.directory);
	}

	let currentDir = fileDir;
	while (currentDir !== "") {
		const lastSlash = currentDir.lastIndexOf("/");
		const parentDir =
			lastSlash === -1 ? "" : currentDir.substring(0, lastSlash);

		for (const node of hierarchy.nodesByPath.values()) {
			if (node.directory === parentDir) {
				return node;
			}
		}

		currentDir = parentDir;
	}

	// Check if there's a root-level intent file
	for (const node of hierarchy.nodesByPath.values()) {
		if (node.directory === "") {
			return node;
		}
	}

	return undefined;
}

/**
 * Find the Least Common Ancestor (LCA) of two nodes.
 * Useful for determining where shared knowledge should be placed.
 *
 * @param nodeA - First node
 * @param nodeB - Second node
 * @returns The LCA node, or undefined if they share no common ancestor
 */
export function findLeastCommonAncestor(
	nodeA: IntentNode,
	nodeB: IntentNode,
): IntentNode | undefined {
	// Get ancestors including the nodes themselves
	const ancestorsA = new Set<IntentNode>([nodeA, ...getAncestors(nodeA)]);

	// Walk up from nodeB to find first common ancestor
	let current: IntentNode | undefined = nodeB;
	while (current) {
		if (ancestorsA.has(current)) {
			return current;
		}
		current = current.parent;
	}

	return undefined;
}

/**
 * Traverse the hierarchy in pre-order (parent before children).
 *
 * @param hierarchy - The hierarchy to traverse
 * @param visitor - Function called for each node
 */
export function traversePreOrder(
	hierarchy: IntentHierarchy,
	visitor: (node: IntentNode) => void,
): void {
	function visit(node: IntentNode): void {
		visitor(node);
		for (const child of node.children) {
			visit(child);
		}
	}

	for (const root of hierarchy.roots) {
		visit(root);
	}
}

/**
 * Traverse the hierarchy in post-order (children before parent).
 * Useful for leaf-first processing.
 *
 * @param hierarchy - The hierarchy to traverse
 * @param visitor - Function called for each node
 */
export function traversePostOrder(
	hierarchy: IntentHierarchy,
	visitor: (node: IntentNode) => void,
): void {
	function visit(node: IntentNode): void {
		for (const child of node.children) {
			visit(child);
		}
		visitor(node);
	}

	for (const root of hierarchy.roots) {
		visit(root);
	}
}

/**
 * Get all nodes in the hierarchy as a flat array.
 *
 * @param hierarchy - The hierarchy to flatten
 * @returns Array of all nodes
 */
export function getAllNodes(hierarchy: IntentHierarchy): IntentNode[] {
	return Array.from(hierarchy.nodesByPath.values());
}

/**
 * Get the total count of nodes in the hierarchy.
 *
 * @param hierarchy - The hierarchy to count
 * @returns Number of nodes
 */
export function getNodeCount(hierarchy: IntentHierarchy): number {
	return hierarchy.nodesByPath.size;
}

/**
 * Get the maximum depth of the hierarchy.
 *
 * @param hierarchy - The hierarchy to measure
 * @returns Maximum depth (0 if empty, 1 if only root nodes, etc.)
 */
export function getMaxDepth(hierarchy: IntentHierarchy): number {
	let maxDepth = 0;
	for (const node of hierarchy.nodesByPath.values()) {
		if (node.depth > maxDepth) {
			maxDepth = node.depth;
		}
	}
	return hierarchy.nodesByPath.size > 0 ? maxDepth + 1 : 0;
}

/**
 * Result of covered files calculation for a single intent node.
 */
export interface CoveredFilesResult {
	/** The intent node */
	node: IntentNode;
	/** All files covered by this node (where this is the nearest covering node) */
	coveredFiles: string[];
	/** Files that were excluded by .intentlayerignore patterns */
	ignoredFiles: string[];
}

/**
 * Calculate which files are covered by a specific intent node.
 *
 * A file is "covered" by a node if:
 * 1. The file is in the node's directory or a subdirectory
 * 2. There is no more specific (closer) intent node covering the file
 * 3. The file is not excluded by .intentlayerignore patterns
 *
 * @param node - The intent node to calculate coverage for
 * @param allFiles - Array of all file paths in the repository
 * @param hierarchy - The intent hierarchy (to check for more specific nodes)
 * @param ignore - Optional IntentLayerIgnore instance for excluding files
 * @returns Object containing covered files and ignored files
 */
export function getCoveredFilesForNode(
	node: IntentNode,
	allFiles: string[],
	hierarchy: IntentHierarchy,
	ignore?: IntentLayerIgnore,
): CoveredFilesResult {
	const coveredFiles: string[] = [];
	const ignoredFiles: string[] = [];

	for (const filePath of allFiles) {
		// Skip the intent file itself
		if (filePath === node.file.path) {
			continue;
		}

		// Skip other intent files (AGENTS.md / CLAUDE.md)
		const fileName = filePath.substring(filePath.lastIndexOf("/") + 1);
		if (fileName === "AGENTS.md" || fileName === "CLAUDE.md") {
			continue;
		}

		// Check if this file is in the node's coverage area
		const fileDir = getDirectory(filePath);
		const nodeDir = node.directory;

		// File must be in node's directory or a subdirectory
		const isInCoverageArea =
			fileDir === nodeDir ||
			(nodeDir === "" && fileDir !== "") ||
			(nodeDir !== "" && isAncestorDirectory(nodeDir, fileDir));

		if (!isInCoverageArea) {
			continue;
		}

		// Check if there's a more specific node covering this file
		const coveringNode = findCoveringNode(filePath, hierarchy);
		if (coveringNode !== node) {
			continue;
		}

		// Check if file is ignored
		if (ignore && ignore.ignores(filePath)) {
			ignoredFiles.push(filePath);
			continue;
		}

		coveredFiles.push(filePath);
	}

	// Sort for consistent ordering
	coveredFiles.sort();
	ignoredFiles.sort();

	return {
		node,
		coveredFiles,
		ignoredFiles,
	};
}

/**
 * Calculate covered files for all nodes in a hierarchy.
 *
 * @param hierarchy - The intent hierarchy
 * @param allFiles - Array of all file paths in the repository
 * @param ignore - Optional IntentLayerIgnore instance for excluding files
 * @returns Map of node path to covered files result
 */
export function getCoveredFilesForHierarchy(
	hierarchy: IntentHierarchy,
	allFiles: string[],
	ignore?: IntentLayerIgnore,
): Map<string, CoveredFilesResult> {
	const results = new Map<string, CoveredFilesResult>();

	for (const node of hierarchy.nodesByPath.values()) {
		const result = getCoveredFilesForNode(node, allFiles, hierarchy, ignore);
		results.set(node.file.path, result);
	}

	return results;
}
