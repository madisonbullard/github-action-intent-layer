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
