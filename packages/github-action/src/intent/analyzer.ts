/**
 * Intent Layer Analyzer
 *
 * Analyzes changed files and maps them to their covering intent nodes.
 * This module bridges between PR diff information and the intent layer hierarchy.
 */

import type { PRChangedFile, PRDiff } from "../github/context";
import type { IntentLayerIgnore } from "../patterns/ignore";
import {
	findCoveringNode,
	getAncestors,
	type IntentHierarchy,
	type IntentNode,
} from "./hierarchy";

/**
 * Result of mapping a single changed file to its covering intent node.
 */
export interface ChangedFileCoverage {
	/** The changed file from the PR diff */
	file: PRChangedFile;
	/** The intent node that covers this file, or undefined if no coverage */
	coveringNode: IntentNode | undefined;
	/** Whether this file was ignored by .intentlayerignore */
	isIgnored: boolean;
}

/**
 * Result of mapping all changed files to their covering intent nodes.
 */
export interface ChangedFilesMappingResult {
	/** All changed files with their coverage information */
	files: ChangedFileCoverage[];
	/** Changed files grouped by their covering node (key is node path, or "__uncovered__" for files with no coverage) */
	byNode: Map<string, ChangedFileCoverage[]>;
	/** Summary statistics */
	summary: ChangedFilesMappingSummary;
}

/**
 * Summary statistics for changed files mapping.
 */
export interface ChangedFilesMappingSummary {
	/** Total number of changed files */
	totalChangedFiles: number;
	/** Number of files covered by an intent node */
	coveredFiles: number;
	/** Number of files not covered by any intent node */
	uncoveredFiles: number;
	/** Number of files ignored by .intentlayerignore */
	ignoredFiles: number;
	/** Number of unique intent nodes affected */
	affectedNodes: number;
}

/**
 * Special key for files that have no covering intent node.
 */
export const UNCOVERED_KEY = "__uncovered__";

/**
 * Map a single changed file to its covering intent node.
 *
 * @param file - The changed file from a PR diff
 * @param hierarchy - The intent hierarchy to search
 * @param ignore - Optional IntentLayerIgnore instance for excluding files
 * @returns Coverage information for the file
 */
export function mapChangedFileToCoveringNode(
	file: PRChangedFile,
	hierarchy: IntentHierarchy,
	ignore?: IntentLayerIgnore,
): ChangedFileCoverage {
	const filename = file.filename;

	// Check if file is ignored
	const isIgnored = ignore?.ignores(filename) ?? false;

	// Find the covering node (even for ignored files, for completeness)
	const coveringNode = findCoveringNode(filename, hierarchy);

	return {
		file,
		coveringNode,
		isIgnored,
	};
}

/**
 * Map all changed files from a PR diff to their covering intent nodes.
 *
 * This function takes the changed files from a pull request and determines
 * which intent node (AGENTS.md/CLAUDE.md) covers each file. Files are grouped
 * by their covering node for easy processing.
 *
 * @param diff - The PR diff containing changed files
 * @param hierarchy - The intent hierarchy to map against
 * @param ignore - Optional IntentLayerIgnore instance for excluding files
 * @returns Mapping result with files grouped by covering node
 */
export function mapChangedFilesToNodes(
	diff: PRDiff,
	hierarchy: IntentHierarchy,
	ignore?: IntentLayerIgnore,
): ChangedFilesMappingResult {
	const files: ChangedFileCoverage[] = [];
	const byNode = new Map<string, ChangedFileCoverage[]>();

	let coveredCount = 0;
	let uncoveredCount = 0;
	let ignoredCount = 0;

	for (const changedFile of diff.files) {
		const coverage = mapChangedFileToCoveringNode(
			changedFile,
			hierarchy,
			ignore,
		);
		files.push(coverage);

		// Track statistics
		if (coverage.isIgnored) {
			ignoredCount++;
		}

		// Group by covering node
		const nodeKey = coverage.coveringNode?.file.path ?? UNCOVERED_KEY;

		if (!byNode.has(nodeKey)) {
			byNode.set(nodeKey, []);
		}
		byNode.get(nodeKey)!.push(coverage);

		// Count covered vs uncovered (ignoring the ignored status for this count)
		if (coverage.coveringNode) {
			coveredCount++;
		} else {
			uncoveredCount++;
		}
	}

	// Calculate affected nodes (excluding the UNCOVERED_KEY)
	const affectedNodes = Array.from(byNode.keys()).filter(
		(key) => key !== UNCOVERED_KEY,
	).length;

	const summary: ChangedFilesMappingSummary = {
		totalChangedFiles: diff.files.length,
		coveredFiles: coveredCount,
		uncoveredFiles: uncoveredCount,
		ignoredFiles: ignoredCount,
		affectedNodes,
	};

	return {
		files,
		byNode,
		summary,
	};
}

/**
 * Get a list of affected intent nodes from a mapping result.
 *
 * Returns only the nodes that have at least one changed file (covered or not),
 * sorted by path for consistent ordering.
 *
 * @param mapping - The changed files mapping result
 * @returns Array of affected intent nodes
 */
export function getAffectedNodes(
	mapping: ChangedFilesMappingResult,
): IntentNode[] {
	const nodes: IntentNode[] = [];
	const seen = new Set<string>();

	for (const coverage of mapping.files) {
		if (coverage.coveringNode && !seen.has(coverage.coveringNode.file.path)) {
			seen.add(coverage.coveringNode.file.path);
			nodes.push(coverage.coveringNode);
		}
	}

	// Sort by path for consistent ordering
	nodes.sort((a, b) => a.file.path.localeCompare(b.file.path));

	return nodes;
}

/**
 * Get changed files for a specific intent node.
 *
 * @param nodePath - Path to the intent node (e.g., "packages/api/AGENTS.md")
 * @param mapping - The changed files mapping result
 * @returns Array of changed file coverages for the node, or empty array if none
 */
export function getChangedFilesForNode(
	nodePath: string,
	mapping: ChangedFilesMappingResult,
): ChangedFileCoverage[] {
	return mapping.byNode.get(nodePath) ?? [];
}

/**
 * Get uncovered changed files (files not covered by any intent node).
 *
 * @param mapping - The changed files mapping result
 * @returns Array of changed file coverages without covering nodes
 */
export function getUncoveredChangedFiles(
	mapping: ChangedFilesMappingResult,
): ChangedFileCoverage[] {
	return mapping.byNode.get(UNCOVERED_KEY) ?? [];
}

/**
 * Get ignored changed files.
 *
 * @param mapping - The changed files mapping result
 * @returns Array of changed file coverages that were ignored
 */
export function getIgnoredChangedFiles(
	mapping: ChangedFilesMappingResult,
): ChangedFileCoverage[] {
	return mapping.files.filter((f) => f.isIgnored);
}

/**
 * Check if any changed files affect intent nodes.
 *
 * @param mapping - The changed files mapping result
 * @returns True if at least one changed file is covered by an intent node
 */
export function hasAffectedNodes(mapping: ChangedFilesMappingResult): boolean {
	return mapping.summary.affectedNodes > 0;
}

/**
 * Represents a node that has been determined to need an update.
 */
export interface NodeUpdateCandidate {
	/** The intent node that needs updating */
	node: IntentNode;
	/** Changed files that triggered this update (non-ignored files covered by this node) */
	changedFiles: ChangedFileCoverage[];
	/** Summary of changes affecting this node */
	changeSummary: NodeChangeSummary;
}

/**
 * Summary of changes affecting a single intent node.
 */
export interface NodeChangeSummary {
	/** Number of files added in this node's coverage area */
	filesAdded: number;
	/** Number of files modified in this node's coverage area */
	filesModified: number;
	/** Number of files removed from this node's coverage area */
	filesRemoved: number;
	/** Number of files renamed in this node's coverage area */
	filesRenamed: number;
	/** Total lines added across all changed files */
	totalAdditions: number;
	/** Total lines deleted across all changed files */
	totalDeletions: number;
}

/**
 * Result of determining which nodes need updates.
 */
export interface NodesNeedingUpdateResult {
	/** Nodes that need updates (only nearest covering nodes, no parents) */
	candidates: NodeUpdateCandidate[];
	/** Total number of nodes needing updates */
	totalNodes: number;
	/** Whether any nodes need updates */
	hasUpdates: boolean;
}

/**
 * Determine which nodes need updates based on the diff.
 *
 * This function analyzes the changed files mapping and determines which
 * intent nodes should be updated. Only the nearest covering node for each
 * changed file is considered (parent nodes are not included - that's a
 * separate concern handled by reviewParentNodes).
 *
 * A node is considered to need an update if it has at least one non-ignored
 * changed file in its coverage area.
 *
 * @param mapping - The result of mapping changed files to nodes
 * @returns Result containing all nodes that need updates with their change details
 */
export function determineNodesNeedingUpdate(
	mapping: ChangedFilesMappingResult,
): NodesNeedingUpdateResult {
	const candidates: NodeUpdateCandidate[] = [];

	// Get all unique covering nodes (excluding uncovered files)
	const affectedNodes = getAffectedNodes(mapping);

	for (const node of affectedNodes) {
		// Get all changed files for this node
		const nodeFiles = getChangedFilesForNode(node.file.path, mapping);

		// Filter out ignored files - only non-ignored files trigger updates
		const nonIgnoredFiles = nodeFiles.filter((f) => !f.isIgnored);

		// If no non-ignored files, this node doesn't need an update
		if (nonIgnoredFiles.length === 0) {
			continue;
		}

		// Calculate change summary for this node
		const changeSummary = calculateChangeSummary(nonIgnoredFiles);

		candidates.push({
			node,
			changedFiles: nonIgnoredFiles,
			changeSummary,
		});
	}

	// Sort candidates by node path for consistent ordering
	candidates.sort((a, b) => a.node.file.path.localeCompare(b.node.file.path));

	return {
		candidates,
		totalNodes: candidates.length,
		hasUpdates: candidates.length > 0,
	};
}

/**
 * Calculate change summary for a set of changed files.
 *
 * @param files - Array of changed file coverages
 * @returns Summary of the changes
 */
function calculateChangeSummary(
	files: ChangedFileCoverage[],
): NodeChangeSummary {
	let filesAdded = 0;
	let filesModified = 0;
	let filesRemoved = 0;
	let filesRenamed = 0;
	let totalAdditions = 0;
	let totalDeletions = 0;

	for (const coverage of files) {
		const file = coverage.file;
		totalAdditions += file.additions;
		totalDeletions += file.deletions;

		switch (file.status) {
			case "added":
				filesAdded++;
				break;
			case "modified":
				filesModified++;
				break;
			case "removed":
				filesRemoved++;
				break;
			case "renamed":
				filesRenamed++;
				break;
			// "copied" and "changed" are less common but count as modified
			case "copied":
			case "changed":
				filesModified++;
				break;
		}
	}

	return {
		filesAdded,
		filesModified,
		filesRemoved,
		filesRenamed,
		totalAdditions,
		totalDeletions,
	};
}

/**
 * Get nodes that need updates, excluding nodes that only have ignored changes.
 *
 * This is a convenience function that combines filtering ignored files
 * and determining nodes needing updates.
 *
 * @param diff - The PR diff
 * @param hierarchy - The intent hierarchy
 * @param ignore - Optional IntentLayerIgnore instance
 * @returns Result containing nodes that need updates
 */
export function getNodesNeedingUpdate(
	diff: PRDiff,
	hierarchy: IntentHierarchy,
	ignore?: IntentLayerIgnore,
): NodesNeedingUpdateResult {
	const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
	return determineNodesNeedingUpdate(mapping);
}

/**
 * Filter mapping results to only include non-ignored files.
 *
 * Useful when you want to process only the files that matter for
 * intent layer updates.
 *
 * @param mapping - The changed files mapping result
 * @returns New mapping result with ignored files excluded
 */
export function filterIgnoredFiles(
	mapping: ChangedFilesMappingResult,
): ChangedFilesMappingResult {
	const files = mapping.files.filter((f) => !f.isIgnored);

	// Rebuild byNode map
	const byNode = new Map<string, ChangedFileCoverage[]>();
	for (const coverage of files) {
		const nodeKey = coverage.coveringNode?.file.path ?? UNCOVERED_KEY;
		if (!byNode.has(nodeKey)) {
			byNode.set(nodeKey, []);
		}
		byNode.get(nodeKey)!.push(coverage);
	}

	// Recalculate summary
	const coveredCount = files.filter((f) => f.coveringNode).length;
	const uncoveredCount = files.filter((f) => !f.coveringNode).length;
	const affectedNodes = Array.from(byNode.keys()).filter(
		(key) => key !== UNCOVERED_KEY,
	).length;

	return {
		files,
		byNode,
		summary: {
			totalChangedFiles: files.length,
			coveredFiles: coveredCount,
			uncoveredFiles: uncoveredCount,
			ignoredFiles: 0,
			affectedNodes,
		},
	};
}

/**
 * Information about a parent node that may need review due to descendant changes.
 */
export interface ParentNodeReviewCandidate {
	/** The parent intent node that may need review */
	node: IntentNode;
	/** Child nodes that were directly updated (triggered this parent review) */
	updatedChildren: NodeUpdateCandidate[];
	/** Total number of files changed across all updated children */
	totalChangedFilesInChildren: number;
	/** Total additions across all updated children */
	totalAdditionsInChildren: number;
	/** Total deletions across all updated children */
	totalDeletionsInChildren: number;
	/** Whether this parent is recommended for update (conservative default: false) */
	recommendUpdate: boolean;
	/** Reason for the recommendation */
	recommendationReason: string;
}

/**
 * Result of reviewing parent nodes for potential updates.
 */
export interface ParentNodesReviewResult {
	/** Parent nodes that may need review, ordered from deepest to shallowest */
	candidates: ParentNodeReviewCandidate[];
	/** Total number of parent nodes identified for potential review */
	totalParentNodes: number;
	/** Whether any parent nodes are recommended for update */
	hasRecommendedUpdates: boolean;
}

/**
 * Review parent nodes for potential updates based on changes to their descendants.
 *
 * This function examines the parent nodes of all nodes that need direct updates
 * and determines whether those parents should also be reviewed/updated. By design,
 * this function is conservative - it defaults to NOT recommending parent updates
 * unless there's a clear reason to do so.
 *
 * The philosophy is that changes to child nodes typically only affect the local
 * context, and parent nodes (which provide broader context) should usually remain
 * stable unless:
 * - Multiple children are updated (indicates broader changes)
 * - Significant structural changes occurred (many files added/removed)
 *
 * @param directUpdates - The result of determining which nodes need direct updates
 * @returns Information about parent nodes that may need review
 */
export function reviewParentNodes(
	directUpdates: NodesNeedingUpdateResult,
): ParentNodesReviewResult {
	// Collect all unique parent nodes and their associated child updates
	const parentToChildren = new Map<string, NodeUpdateCandidate[]>();

	for (const candidate of directUpdates.candidates) {
		const ancestors = getAncestors(candidate.node);
		for (const ancestor of ancestors) {
			const parentPath = ancestor.file.path;
			if (!parentToChildren.has(parentPath)) {
				parentToChildren.set(parentPath, []);
			}
			parentToChildren.get(parentPath)!.push(candidate);
		}
	}

	// Build parent review candidates
	const candidates: ParentNodeReviewCandidate[] = [];

	for (const [parentPath, children] of parentToChildren) {
		// Get the actual parent node from one of the children's ancestors
		const parentNode = children[0]!.node.parent
			? findParentByPath(children[0]!.node, parentPath)
			: undefined;

		if (!parentNode) {
			continue;
		}

		// Calculate aggregate statistics across children
		let totalChangedFiles = 0;
		let totalAdditions = 0;
		let totalDeletions = 0;
		let structuralChanges = 0; // Files added or removed

		for (const child of children) {
			totalChangedFiles += child.changedFiles.length;
			totalAdditions += child.changeSummary.totalAdditions;
			totalDeletions += child.changeSummary.totalDeletions;
			structuralChanges +=
				child.changeSummary.filesAdded + child.changeSummary.filesRemoved;
		}

		// Determine recommendation (conservative by default)
		const { recommendUpdate, recommendationReason } =
			determineParentRecommendation(
				children,
				totalChangedFiles,
				structuralChanges,
			);

		candidates.push({
			node: parentNode,
			updatedChildren: children,
			totalChangedFilesInChildren: totalChangedFiles,
			totalAdditionsInChildren: totalAdditions,
			totalDeletionsInChildren: totalDeletions,
			recommendUpdate,
			recommendationReason,
		});
	}

	// Sort by depth descending (deepest parents first), then by path
	candidates.sort((a, b) => {
		if (a.node.depth !== b.node.depth) {
			return b.node.depth - a.node.depth;
		}
		return a.node.file.path.localeCompare(b.node.file.path);
	});

	const hasRecommendedUpdates = candidates.some((c) => c.recommendUpdate);

	return {
		candidates,
		totalParentNodes: candidates.length,
		hasRecommendedUpdates,
	};
}

/**
 * Find a parent node by its path by traversing up from a starting node.
 */
function findParentByPath(
	startNode: IntentNode,
	targetPath: string,
): IntentNode | undefined {
	let current = startNode.parent;
	while (current) {
		if (current.file.path === targetPath) {
			return current;
		}
		current = current.parent;
	}
	return undefined;
}

/**
 * Determine whether to recommend updating a parent node.
 *
 * This is intentionally conservative - parent updates should be rare.
 * The LLM will ultimately decide, but we provide a recommendation.
 */
function determineParentRecommendation(
	children: NodeUpdateCandidate[],
	totalChangedFiles: number,
	structuralChanges: number,
): { recommendUpdate: boolean; recommendationReason: string } {
	// Default: no recommendation to update
	const noUpdateReason =
		"Parent nodes typically don't need updates for localized changes";

	// Condition 1: Multiple children updated (indicates cross-cutting change)
	if (children.length >= 3) {
		return {
			recommendUpdate: true,
			recommendationReason: `Multiple child nodes (${children.length}) were updated, indicating potential cross-cutting changes`,
		};
	}

	// Condition 2: Significant structural changes across children
	if (structuralChanges >= 5) {
		return {
			recommendUpdate: true,
			recommendationReason: `Significant structural changes (${structuralChanges} files added/removed) may affect parent context`,
		};
	}

	// Condition 3: Large number of changed files (indicates major refactoring)
	if (totalChangedFiles >= 10) {
		return {
			recommendUpdate: true,
			recommendationReason: `Large number of changed files (${totalChangedFiles}) in child nodes may warrant parent review`,
		};
	}

	return {
		recommendUpdate: false,
		recommendationReason: noUpdateReason,
	};
}
