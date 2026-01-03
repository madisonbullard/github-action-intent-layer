/**
 * Checkbox Handler for Intent Layer Comments
 *
 * Handles checkbox toggle events in PR comments for the intent layer action.
 * Implements debounce mechanism to handle rapid checkbox state changes and
 * ensure stable state before processing.
 */

import type { GitHubClient } from "./client.js";
import {
	type CommentMarkerData,
	isCheckboxChecked,
	parseCommentMarker,
} from "./comments.js";

/**
 * Default debounce delay in milliseconds.
 * Prevents processing rapid checkbox toggles.
 */
export const DEFAULT_DEBOUNCE_DELAY_MS = 1500;

/**
 * Result of the debounce check.
 */
export interface DebounceResult {
	/** Whether the checkbox state is stable and processing should continue */
	stable: boolean;
	/** The current checkbox state after debounce (only valid if stable=true) */
	isChecked?: boolean;
	/** The comment body after re-fetching (only valid if stable=true) */
	commentBody?: string;
	/** Parsed marker data including nodePath, appliedCommit, headSha (only valid if stable=true) */
	markerData?: CommentMarkerData;
	/** Reason for instability if stable=false */
	reason?: string;
}

/**
 * Options for the debounce operation.
 */
export interface DebounceOptions {
	/** Delay in milliseconds before re-fetching the comment (default: 1500) */
	delayMs?: number;
}

/**
 * Sleep for a specified number of milliseconds.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Implements debounce for checkbox handler to ensure stable state.
 *
 * This function:
 * 1. Records the initial checkbox state from the comment body
 * 2. Waits for the configured debounce delay (default: 1.5s)
 * 3. Re-fetches the comment from GitHub API
 * 4. Verifies the checkbox state is unchanged
 * 5. Returns whether processing should continue
 *
 * This prevents race conditions when users rapidly toggle checkboxes
 * and ensures we only process the final, stable state.
 *
 * @param client - GitHub client for API operations
 * @param commentId - ID of the comment to check
 * @param initialCommentBody - Initial comment body from the event payload
 * @param options - Optional debounce configuration
 * @returns Debounce result indicating whether to proceed
 */
export async function debounceCheckboxToggle(
	client: GitHubClient,
	commentId: number,
	initialCommentBody: string,
	options: DebounceOptions = {},
): Promise<DebounceResult> {
	const delayMs = options.delayMs ?? DEFAULT_DEBOUNCE_DELAY_MS;

	// Parse the initial state
	const initialMarker = parseCommentMarker(initialCommentBody);
	if (!initialMarker) {
		return {
			stable: false,
			reason: "Comment does not contain a valid intent layer marker",
		};
	}

	const initialCheckboxState = isCheckboxChecked(initialCommentBody);

	// Wait for the debounce delay
	await sleep(delayMs);

	// Re-fetch the comment to check current state
	let currentComment: { body?: string | null };
	try {
		currentComment = await client.getComment(commentId);
	} catch (error) {
		return {
			stable: false,
			reason: `Failed to re-fetch comment: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}

	if (!currentComment.body) {
		return {
			stable: false,
			reason: "Comment body is empty after re-fetch",
		};
	}

	// Verify the marker is still present and valid
	const currentMarker = parseCommentMarker(currentComment.body);
	if (!currentMarker) {
		return {
			stable: false,
			reason: "Comment marker is no longer valid after re-fetch",
		};
	}

	// Check if the checkbox state is the same
	const currentCheckboxState = isCheckboxChecked(currentComment.body);
	if (currentCheckboxState !== initialCheckboxState) {
		return {
			stable: false,
			reason: `Checkbox state changed during debounce period (was: ${initialCheckboxState}, now: ${currentCheckboxState})`,
		};
	}

	// State is stable, return success with parsed marker data
	return {
		stable: true,
		isChecked: currentCheckboxState,
		commentBody: currentComment.body,
		markerData: currentMarker,
	};
}

/**
 * Extracts checkbox handler context from the event payload.
 */
export interface CheckboxHandlerContext {
	/** The ID of the comment that was edited */
	commentId: number;
	/** The body of the comment */
	commentBody: string;
	/** The issue/PR number where the comment was made */
	issueNumber: number;
	/** Whether this is a PR (vs an issue) */
	isPullRequest: boolean;
}

/**
 * Validate that the event payload contains the required information
 * for checkbox handling.
 *
 * @param payload - The GitHub event payload
 * @returns Extracted context if valid, or null if not a valid checkbox event
 */
export function validateCheckboxEvent(
	payload: Record<string, unknown>,
): CheckboxHandlerContext | null {
	// Must have a comment
	const comment = payload.comment as Record<string, unknown> | undefined;
	if (!comment) {
		return null;
	}

	// Comment must have an ID and body
	const commentId = comment.id as number | undefined;
	const commentBody = comment.body as string | undefined;
	if (!commentId || !commentBody) {
		return null;
	}

	// Must be on an issue or PR
	const issue = payload.issue as Record<string, unknown> | undefined;
	if (!issue) {
		return null;
	}

	const issueNumber = issue.number as number | undefined;
	if (!issueNumber) {
		return null;
	}

	// Check if it's a PR (has pull_request property)
	const isPullRequest = "pull_request" in issue;

	return {
		commentId,
		commentBody,
		issueNumber,
		isPullRequest,
	};
}
