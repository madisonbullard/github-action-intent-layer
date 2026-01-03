/**
 * Diff Formatting Utilities
 *
 * Provides utilities for generating human-readable diffs between
 * intent layer content (before/after) for PR comments.
 */

import { createPatch, diffLines } from "diff";
import type { IntentUpdate } from "../opencode/output-schema.js";

/**
 * Result of a diff generation operation.
 */
export interface DiffResult {
	/** The unified diff string */
	unifiedDiff: string;
	/** Summary statistics about the diff */
	stats: DiffStats;
	/** Whether there are actual changes */
	hasChanges: boolean;
}

/**
 * Statistics about a diff.
 */
export interface DiffStats {
	/** Number of lines added */
	additions: number;
	/** Number of lines removed */
	deletions: number;
	/** Total number of lines changed (additions + deletions) */
	totalChanges: number;
}

/**
 * Options for diff generation.
 */
export interface DiffOptions {
	/** Number of context lines to include around changes (default: 3) */
	contextLines?: number;
	/** Header to show for old content (default: "Current") */
	oldHeader?: string;
	/** Header to show for new content (default: "Proposed") */
	newHeader?: string;
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
	contextLines: 3,
	oldHeader: "Current",
	newHeader: "Proposed",
};

/**
 * Generate a unified diff between two strings.
 *
 * @param oldContent - The original content (before)
 * @param newContent - The new content (after)
 * @param fileName - The file name to display in the diff header
 * @param options - Optional diff generation options
 * @returns DiffResult containing the unified diff and statistics
 */
export function generateDiff(
	oldContent: string,
	newContent: string,
	fileName: string,
	options: DiffOptions = {},
): DiffResult {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	// Normalize line endings for consistent diffing
	const normalizedOld = normalizeLineEndings(oldContent);
	const normalizedNew = normalizeLineEndings(newContent);

	// Generate the unified diff
	const unifiedDiff = createPatch(
		fileName,
		normalizedOld,
		normalizedNew,
		opts.oldHeader,
		opts.newHeader,
		{ context: opts.contextLines },
	);

	// Calculate statistics
	const stats = calculateDiffStats(normalizedOld, normalizedNew);

	return {
		unifiedDiff,
		stats,
		hasChanges: stats.totalChanges > 0,
	};
}

/**
 * Generate a diff for an IntentUpdate.
 *
 * Handles all action types (create, update, delete) appropriately:
 * - create: Shows the new content being added
 * - update: Shows the diff between current and suggested content
 * - delete: Shows the content being removed
 *
 * @param update - The intent update to generate a diff for
 * @param options - Optional diff generation options
 * @returns DiffResult for the update
 */
export function generateDiffForUpdate(
	update: IntentUpdate,
	options: DiffOptions = {},
): DiffResult {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	switch (update.action) {
		case "create":
			return generateDiff("", update.suggestedContent ?? "", update.nodePath, {
				...opts,
				oldHeader: "(new file)",
				newHeader: opts.newHeader,
			});

		case "update":
			return generateDiff(
				update.currentContent ?? "",
				update.suggestedContent ?? "",
				update.nodePath,
				opts,
			);

		case "delete":
			return generateDiff(update.currentContent ?? "", "", update.nodePath, {
				...opts,
				oldHeader: opts.oldHeader,
				newHeader: "(deleted)",
			});
	}
}

/**
 * Format a diff for display in a PR comment.
 *
 * Wraps the diff in a collapsible details block with appropriate
 * markdown formatting for GitHub.
 *
 * @param diffResult - The diff result to format
 * @param update - The intent update for context
 * @returns Formatted markdown string for PR comment
 */
export function formatDiffForComment(
	diffResult: DiffResult,
	update: IntentUpdate,
): string {
	const { unifiedDiff, stats, hasChanges } = diffResult;

	if (!hasChanges && update.action === "update") {
		return `**${update.nodePath}**\n\nNo changes detected.`;
	}

	const actionLabel = getActionLabel(update.action);
	const statsLine = formatStatsLine(stats, update.action);

	// Build the markdown output
	const lines: string[] = [];

	lines.push(`### ${actionLabel}: \`${update.nodePath}\``);
	lines.push("");
	lines.push(`**Reason:** ${update.reason}`);
	lines.push("");
	lines.push(statsLine);
	lines.push("");
	lines.push("<details>");
	lines.push("<summary>View diff</summary>");
	lines.push("");
	lines.push("```diff");
	lines.push(stripDiffHeader(unifiedDiff));
	lines.push("```");
	lines.push("</details>");

	return lines.join("\n");
}

/**
 * Format a simple before/after view for PR comments.
 *
 * Shows the full content before and after, useful for smaller files
 * or when unified diff format is not preferred.
 *
 * @param update - The intent update to format
 * @returns Formatted markdown string showing before/after
 */
export function formatBeforeAfterForComment(update: IntentUpdate): string {
	const actionLabel = getActionLabel(update.action);
	const lines: string[] = [];

	lines.push(`### ${actionLabel}: \`${update.nodePath}\``);
	lines.push("");
	lines.push(`**Reason:** ${update.reason}`);
	lines.push("");

	if (update.action === "create") {
		lines.push("<details>");
		lines.push("<summary>View proposed content</summary>");
		lines.push("");
		lines.push("```markdown");
		lines.push(update.suggestedContent ?? "");
		lines.push("```");
		lines.push("</details>");
	} else if (update.action === "delete") {
		lines.push("<details>");
		lines.push("<summary>View content to be removed</summary>");
		lines.push("");
		lines.push("```markdown");
		lines.push(update.currentContent ?? "");
		lines.push("```");
		lines.push("</details>");
	} else {
		// update action - show both
		lines.push("<details>");
		lines.push("<summary>View current content</summary>");
		lines.push("");
		lines.push("```markdown");
		lines.push(update.currentContent ?? "");
		lines.push("```");
		lines.push("</details>");
		lines.push("");
		lines.push("<details>");
		lines.push("<summary>View proposed content</summary>");
		lines.push("");
		lines.push("```markdown");
		lines.push(update.suggestedContent ?? "");
		lines.push("```");
		lines.push("</details>");
	}

	return lines.join("\n");
}

/**
 * Normalize line endings to Unix-style (LF).
 *
 * @param content - Content with potentially mixed line endings
 * @returns Content with normalized line endings
 */
export function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Calculate diff statistics between two strings.
 *
 * @param oldContent - Original content
 * @param newContent - New content
 * @returns DiffStats with additions, deletions, and total changes
 */
export function calculateDiffStats(
	oldContent: string,
	newContent: string,
): DiffStats {
	const changes = diffLines(oldContent, newContent);

	let additions = 0;
	let deletions = 0;

	for (const change of changes) {
		const lineCount = (change.value.match(/\n/g) || []).length;
		// Account for content without trailing newline
		const effectiveLines =
			change.value.endsWith("\n") || change.value === ""
				? lineCount
				: lineCount + 1;

		if (change.added) {
			additions += effectiveLines;
		} else if (change.removed) {
			deletions += effectiveLines;
		}
	}

	return {
		additions,
		deletions,
		totalChanges: additions + deletions,
	};
}

/**
 * Get a human-readable label for an action type.
 *
 * @param action - The action type
 * @returns Human-readable label
 */
function getActionLabel(action: "create" | "update" | "delete"): string {
	switch (action) {
		case "create":
			return "Create";
		case "update":
			return "Update";
		case "delete":
			return "Delete";
	}
}

/**
 * Format a stats line for the diff summary.
 *
 * @param stats - The diff statistics
 * @param action - The action type for context
 * @returns Formatted stats line
 */
function formatStatsLine(
	stats: DiffStats,
	action: "create" | "update" | "delete",
): string {
	if (action === "create") {
		return `**+${stats.additions} lines**`;
	}

	if (action === "delete") {
		return `**-${stats.deletions} lines**`;
	}

	// update action
	const parts: string[] = [];
	if (stats.additions > 0) {
		parts.push(`+${stats.additions}`);
	}
	if (stats.deletions > 0) {
		parts.push(`-${stats.deletions}`);
	}

	if (parts.length === 0) {
		return "**No changes**";
	}

	return `**${parts.join(", ")} lines**`;
}

/**
 * Strip the diff header lines, keeping only the hunks.
 *
 * The createPatch function adds headers like:
 * Index: filename
 * ===================================================================
 * --- filename	header
 * +++ filename	header
 *
 * For PR comments, we often just want the @@ hunks.
 *
 * @param diff - Full unified diff string
 * @returns Diff with header stripped
 */
function stripDiffHeader(diff: string): string {
	const lines = diff.split("\n");
	const hunkStartIndex = lines.findIndex((line) => line.startsWith("@@"));

	if (hunkStartIndex === -1) {
		// No hunks found, return original (might be no changes)
		return diff;
	}

	return lines.slice(hunkStartIndex).join("\n");
}
