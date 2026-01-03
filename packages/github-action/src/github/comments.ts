/**
 * PR Comment Management
 *
 * Provides utilities for creating, parsing, and managing PR comments
 * for the intent layer action. Each comment includes a hidden marker
 * for identification and tracking of applied changes.
 */

import type { IntentUpdate } from "../opencode/output-schema.js";
import {
	type DiffOptions,
	formatDiffForComment,
	generateDiffForUpdate,
} from "../utils/diff.js";

/**
 * Hidden marker format for identifying intent layer comments.
 * This marker is embedded in comments to enable:
 * - Finding existing comments on subsequent runs
 * - Parsing node path in checkbox handler
 * - Tracking whether changes have been applied
 */
export const INTENT_LAYER_MARKER_PREFIX = "<!-- INTENT_LAYER";
export const INTENT_LAYER_MARKER_SUFFIX = "-->";

/**
 * Parsed data from an intent layer comment marker.
 */
export interface CommentMarkerData {
	/** Path to the primary intent file (e.g., "packages/api/AGENTS.md") */
	nodePath: string;
	/** Path to the corresponding other intent file (when both AGENTS.md and CLAUDE.md are managed) */
	otherNodePath?: string;
	/** SHA of the commit where this change was applied (empty if not yet applied) */
	appliedCommit?: string;
	/** SHA of the PR head when this comment was created */
	headSha: string;
}

/**
 * Options for generating a comment.
 */
export interface CommentOptions {
	/** Options for diff generation */
	diffOptions?: DiffOptions;
	/** Whether to include the approval checkbox (default: true) */
	includeCheckbox?: boolean;
}

const DEFAULT_COMMENT_OPTIONS: Required<CommentOptions> = {
	diffOptions: {},
	includeCheckbox: true,
};

/**
 * Generate the hidden marker string for an intent layer comment.
 *
 * @param data - The marker data to encode
 * @returns Hidden HTML comment marker string
 */
export function generateCommentMarker(data: CommentMarkerData): string {
	const parts = [`node=${escapeMarkerValue(data.nodePath)}`];

	if (data.otherNodePath) {
		parts.push(`otherNode=${escapeMarkerValue(data.otherNodePath)}`);
	}

	// appliedCommit is empty string when not yet applied
	parts.push(`appliedCommit=${data.appliedCommit ?? ""}`);
	parts.push(`headSha=${data.headSha}`);

	return `${INTENT_LAYER_MARKER_PREFIX} ${parts.join(" ")} ${INTENT_LAYER_MARKER_SUFFIX}`;
}

/**
 * Parse a hidden marker from a comment body.
 *
 * @param commentBody - The full comment body to parse
 * @returns Parsed marker data, or null if no valid marker found
 */
export function parseCommentMarker(
	commentBody: string,
): CommentMarkerData | null {
	// Find the marker in the comment
	const markerRegex = new RegExp(
		`${escapeRegex(INTENT_LAYER_MARKER_PREFIX)}\\s+(.+?)\\s+${escapeRegex(INTENT_LAYER_MARKER_SUFFIX)}`,
	);
	const match = commentBody.match(markerRegex);

	if (!match || !match[1]) {
		return null;
	}

	const markerContent = match[1];

	// Parse key=value pairs
	const nodeMatch = markerContent.match(/node=([^\s]+)/);
	const otherNodeMatch = markerContent.match(/otherNode=([^\s]+)/);
	const appliedCommitMatch = markerContent.match(/appliedCommit=([^\s]*)/);
	const headShaMatch = markerContent.match(/headSha=([^\s]+)/);

	if (!nodeMatch?.[1] || !headShaMatch?.[1]) {
		return null;
	}

	return {
		nodePath: unescapeMarkerValue(nodeMatch[1]),
		otherNodePath: otherNodeMatch?.[1]
			? unescapeMarkerValue(otherNodeMatch[1])
			: undefined,
		appliedCommit: appliedCommitMatch?.[1] || undefined,
		headSha: headShaMatch[1],
	};
}

/**
 * Check if a comment body contains an intent layer marker.
 *
 * @param commentBody - The comment body to check
 * @returns True if the comment contains an intent layer marker
 */
export function hasIntentLayerMarker(commentBody: string): boolean {
	return commentBody.includes(INTENT_LAYER_MARKER_PREFIX);
}

/**
 * Generate a full PR comment for an intent update.
 *
 * The comment includes:
 * - Hidden marker for identification
 * - Formatted diff showing the proposed changes
 * - Approval checkbox (if enabled)
 *
 * @param update - The intent update to create a comment for
 * @param headSha - Current PR head SHA
 * @param options - Optional comment generation options
 * @returns Complete comment body string
 */
export function generateComment(
	update: IntentUpdate,
	headSha: string,
	options: CommentOptions = {},
): string {
	const opts = { ...DEFAULT_COMMENT_OPTIONS, ...options };

	// Generate the marker data
	const markerData: CommentMarkerData = {
		nodePath: update.nodePath,
		otherNodePath: update.otherNodePath,
		headSha,
	};

	// Generate the diff for display
	const diffResult = generateDiffForUpdate(update, opts.diffOptions);
	const formattedDiff = formatDiffForComment(diffResult, update);

	// Build the comment
	const lines: string[] = [];

	// Hidden marker (must be first for easy detection)
	lines.push(generateCommentMarker(markerData));
	lines.push("");

	// Diff content
	lines.push(formattedDiff);
	lines.push("");

	// Approval checkbox
	if (opts.includeCheckbox) {
		lines.push("---");
		lines.push("");
		lines.push("- [ ] Apply this change");
	}

	return lines.join("\n");
}

/**
 * Update a comment marker with new applied commit information.
 *
 * @param commentBody - The existing comment body
 * @param appliedCommit - The SHA of the commit where the change was applied
 * @returns Updated comment body with new marker
 */
export function updateCommentMarkerWithCommit(
	commentBody: string,
	appliedCommit: string,
): string {
	const existingMarker = parseCommentMarker(commentBody);
	if (!existingMarker) {
		return commentBody;
	}

	const newMarker = generateCommentMarker({
		...existingMarker,
		appliedCommit,
	});

	// Replace the old marker with the new one
	const markerRegex = new RegExp(
		`${escapeRegex(INTENT_LAYER_MARKER_PREFIX)}\\s+.+?\\s+${escapeRegex(INTENT_LAYER_MARKER_SUFFIX)}`,
	);

	return commentBody.replace(markerRegex, newMarker);
}

/**
 * Clear the applied commit from a comment marker (for reverts).
 *
 * @param commentBody - The existing comment body
 * @returns Updated comment body with appliedCommit cleared
 */
export function clearCommentMarkerAppliedCommit(commentBody: string): string {
	const existingMarker = parseCommentMarker(commentBody);
	if (!existingMarker) {
		return commentBody;
	}

	const newMarker = generateCommentMarker({
		...existingMarker,
		appliedCommit: undefined,
	});

	// Replace the old marker with the new one
	const markerRegex = new RegExp(
		`${escapeRegex(INTENT_LAYER_MARKER_PREFIX)}\\s+.+?\\s+${escapeRegex(INTENT_LAYER_MARKER_SUFFIX)}`,
	);

	return commentBody.replace(markerRegex, newMarker);
}

/**
 * Check if the checkbox in a comment is checked.
 *
 * @param commentBody - The comment body to check
 * @returns True if the checkbox is checked, false if unchecked or not found
 */
export function isCheckboxChecked(commentBody: string): boolean {
	return commentBody.includes("- [x] Apply this change");
}

/**
 * Update the checkbox state in a comment.
 *
 * @param commentBody - The existing comment body
 * @param checked - Whether the checkbox should be checked
 * @returns Updated comment body with new checkbox state
 */
export function updateCheckboxState(
	commentBody: string,
	checked: boolean,
): string {
	if (checked) {
		return commentBody.replace(
			/- \[ \] Apply this change/,
			"- [x] Apply this change",
		);
	}
	return commentBody.replace(
		/- \[x\] Apply this change/,
		"- [ ] Apply this change",
	);
}

/**
 * Mark a comment as resolved (stale).
 *
 * This is used when PR head changes and the suggestion is no longer valid.
 *
 * @param commentBody - The existing comment body
 * @returns Updated comment body marked as resolved
 */
export function markCommentAsResolved(commentBody: string): string {
	// Don't double-mark
	if (commentBody.includes("**RESOLVED**")) {
		return commentBody;
	}

	// Add resolved marker after the hidden marker
	const markerRegex = new RegExp(
		`(${escapeRegex(INTENT_LAYER_MARKER_PREFIX)}\\s+.+?\\s+${escapeRegex(INTENT_LAYER_MARKER_SUFFIX)})`,
	);

	return commentBody.replace(
		markerRegex,
		"$1\n\n**RESOLVED** - This suggestion is no longer applicable (PR has been updated).\n",
	);
}

/**
 * Check if a comment is marked as resolved.
 *
 * @param commentBody - The comment body to check
 * @returns True if the comment is marked as resolved
 */
export function isCommentResolved(commentBody: string): boolean {
	return commentBody.includes("**RESOLVED**");
}

/**
 * Find all intent layer comments in a list of comments.
 *
 * @param comments - Array of comment objects with body property
 * @returns Array of comments that contain intent layer markers
 */
export function findIntentLayerComments<
	T extends { body?: string | null; id: number },
>(comments: T[]): T[] {
	return comments.filter((comment) => {
		if (!comment.body) return false;
		return hasIntentLayerMarker(comment.body);
	});
}

/**
 * Find a comment for a specific node path.
 *
 * @param comments - Array of comment objects with body property
 * @param nodePath - The node path to find
 * @returns The matching comment, or undefined if not found
 */
export function findCommentForNode<
	T extends { body?: string | null; id: number },
>(comments: T[], nodePath: string): T | undefined {
	return comments.find((comment) => {
		if (!comment.body) return false;
		const marker = parseCommentMarker(comment.body);
		return marker?.nodePath === nodePath;
	});
}

/**
 * Escape special characters in a marker value.
 * Spaces are replaced with %20 to ensure proper parsing.
 *
 * @param value - Value to escape
 * @returns Escaped value
 */
function escapeMarkerValue(value: string): string {
	return encodeURIComponent(value);
}

/**
 * Unescape a marker value.
 *
 * @param value - Escaped value
 * @returns Original value
 */
function unescapeMarkerValue(value: string): string {
	return decodeURIComponent(value);
}

/**
 * Escape special regex characters in a string.
 *
 * @param str - String to escape
 * @returns Escaped string safe for use in RegExp
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
