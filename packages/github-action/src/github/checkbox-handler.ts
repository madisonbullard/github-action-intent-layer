/**
 * Checkbox Handler for Intent Layer Comments
 *
 * Handles checkbox toggle events in PR comments for the intent layer action.
 * Implements debounce mechanism to handle rapid checkbox state changes and
 * ensure stable state before processing.
 */

import type { SymlinkSource } from "../config/schema.js";
import type { IntentUpdate } from "../opencode/output-schema.js";
import type { GitHubClient } from "./client.js";
import {
	addCommittedStatus,
	addRevertedStatus,
	type CommentMarkerData,
	clearCommentMarkerAppliedCommit,
	isCheckboxChecked,
	markCommentAsResolved,
	parseCommentMarker,
	updateCommentMarkerWithCommit,
} from "./comments.js";
import {
	type CommitResult,
	createIntentAddCommit,
	createIntentRevertCommit,
	createIntentUpdateCommit,
	getFileSha,
	type IntentCommitOptions,
	type RevertCommitOptions,
} from "./commits.js";

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

/**
 * Options for handling a checked checkbox.
 */
export interface HandleCheckedCheckboxOptions {
	/** Branch to commit to (typically the PR branch) */
	branch: string;
	/** Whether to create symlinks between AGENTS.md and CLAUDE.md */
	symlink?: boolean;
	/** Which file is the source of truth when symlinking */
	symlinkSource?: SymlinkSource;
}

/**
 * Result of handling a checked checkbox.
 */
export interface HandleCheckedCheckboxResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** The commit result if successful */
	commitResult?: CommitResult;
	/** Whether the comment was marked as resolved (stale) */
	markedAsResolved?: boolean;
	/** Error message if the operation failed */
	error?: string;
}

/**
 * Reconstruct an IntentUpdate from the comment body.
 *
 * When handling checkbox approval, we need to reconstruct the IntentUpdate
 * from the comment. The comment contains the suggested content in a diff
 * code block, which we extract here.
 *
 * @param commentBody - The full comment body
 * @param markerData - Parsed marker data with node paths
 * @param action - The action type (create or update)
 * @returns Reconstructed IntentUpdate
 */
export function reconstructIntentUpdateFromComment(
	commentBody: string,
	markerData: CommentMarkerData,
	action: "create" | "update",
): IntentUpdate {
	// Extract suggested content from the comment diff block.
	// The diff format shows additions with + prefix. We need to extract the actual content.
	// The comment format includes a markdown code block with the diff.

	// Look for content between ```diff and ``` or ```markdown and ```
	// First try to find a "Suggested Content" section with markdown code block
	const suggestedMatch = commentBody.match(
		/### Suggested Content[\s\S]*?```(?:markdown|md)?\n([\s\S]*?)```/,
	);

	let suggestedContent = "";
	if (suggestedMatch?.[1]) {
		suggestedContent = suggestedMatch[1];
	} else {
		// Fallback: try to extract from diff block (lines starting with +, removing the +)
		const diffMatch = commentBody.match(/```diff\n([\s\S]*?)```/);
		if (diffMatch?.[1]) {
			// Extract only the added lines (starting with +) and remove the + prefix
			const lines = diffMatch[1].split("\n");
			const addedLines = lines
				.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
				.map((line) => line.substring(1));
			suggestedContent = addedLines.join("\n");
		}
	}

	// Extract current content if this is an update
	let currentContent: string | undefined;
	if (action === "update") {
		const currentMatch = commentBody.match(
			/### Current Content[\s\S]*?```(?:markdown|md)?\n([\s\S]*?)```/,
		);
		if (currentMatch?.[1]) {
			currentContent = currentMatch[1];
		} else {
			// Fallback: extract removed lines from diff
			const diffMatch = commentBody.match(/```diff\n([\s\S]*?)```/);
			if (diffMatch?.[1]) {
				const lines = diffMatch[1].split("\n");
				const removedLines = lines
					.filter((line) => line.startsWith("-") && !line.startsWith("---"))
					.map((line) => line.substring(1));
				currentContent = removedLines.join("\n");
			}
		}
	}

	// Extract reason from comment (typically in a "Reason" section or after the diff)
	const reasonMatch = commentBody.match(/(?:Reason|Why)[:\s]*([^\n]+)/i);
	const reason = reasonMatch?.[1]?.trim() || "Approved via checkbox";

	const update: IntentUpdate = {
		nodePath: markerData.nodePath,
		otherNodePath: markerData.otherNodePath,
		action,
		reason,
		suggestedContent: suggestedContent || "",
	};

	if (currentContent) {
		update.currentContent = currentContent;
	}

	return update;
}

/**
 * Handle a checked checkbox in an intent layer comment.
 *
 * This function:
 * 1. Verifies the current PR headSha matches the marker's headSha
 * 2. If not matching, marks the comment as RESOLVED (stale)
 * 3. If matching, determines whether to create ADD or UPDATE commit
 * 4. Creates the commit
 * 5. Updates the comment marker with the appliedCommit SHA
 *
 * @param client - GitHub client for API operations
 * @param commentId - ID of the comment being processed
 * @param commentBody - Current body of the comment
 * @param markerData - Parsed marker data from the comment
 * @param currentHeadSha - Current PR head SHA
 * @param options - Commit options (branch, symlink settings)
 * @returns Result of the operation
 */
export async function handleCheckedCheckbox(
	client: GitHubClient,
	commentId: number,
	commentBody: string,
	markerData: CommentMarkerData,
	currentHeadSha: string,
	options: HandleCheckedCheckboxOptions,
): Promise<HandleCheckedCheckboxResult> {
	// Step 1: Verify headSha matches
	if (markerData.headSha !== currentHeadSha) {
		// PR has been updated since this comment was created
		// Mark the comment as resolved (stale)
		const resolvedBody = markCommentAsResolved(commentBody);
		await client.updateComment(commentId, resolvedBody);

		return {
			success: false,
			markedAsResolved: true,
			error: `PR head has changed (was: ${markerData.headSha}, now: ${currentHeadSha}). Comment marked as resolved.`,
		};
	}

	// Step 2: Determine if this is a create or update action
	// Check if the file already exists on the branch
	const existingSha = await getFileSha(
		client,
		markerData.nodePath,
		options.branch,
	);
	const action = existingSha ? "update" : "create";

	// Step 3: Reconstruct the IntentUpdate from the comment
	const update = reconstructIntentUpdateFromComment(
		commentBody,
		markerData,
		action,
	);

	// For updates, we need to ensure we have currentContent
	if (action === "update" && !update.currentContent) {
		// Fetch current content from the file
		try {
			const content = await client.getFileContent(
				markerData.nodePath,
				options.branch,
			);
			if (!Array.isArray(content) && "content" in content && content.content) {
				update.currentContent = Buffer.from(content.content, "base64").toString(
					"utf-8",
				);
			}
		} catch {
			// If we can't get the content, proceed anyway - the commit function will handle it
		}
	}

	// Step 4: Create the commit
	const commitOptions: IntentCommitOptions = {
		branch: options.branch,
		symlink: options.symlink,
		symlinkSource: options.symlinkSource,
	};

	let commitResult: CommitResult;
	try {
		if (action === "create") {
			commitResult = await createIntentAddCommit(client, update, commitOptions);
		} else {
			commitResult = await createIntentUpdateCommit(
				client,
				update,
				commitOptions,
			);
		}
	} catch (error) {
		return {
			success: false,
			error: `Failed to create commit: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	// Step 5: Update the comment marker with appliedCommit and add committed status
	let updatedBody = updateCommentMarkerWithCommit(
		commentBody,
		commitResult.sha,
	);
	updatedBody = addCommittedStatus(updatedBody, commitResult.sha);
	await client.updateComment(commentId, updatedBody);

	return {
		success: true,
		commitResult,
	};
}

/**
 * Options for handling an unchecked checkbox.
 */
export interface HandleUncheckedCheckboxOptions {
	/** Branch to commit to (typically the PR branch) */
	branch: string;
	/** Whether symlinks are enabled */
	symlink?: boolean;
	/** Which file is the source of truth when symlinking */
	symlinkSource?: SymlinkSource;
}

/**
 * Result of handling an unchecked checkbox.
 */
export interface HandleUncheckedCheckboxResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** The commit result if a revert was performed */
	commitResult?: CommitResult;
	/** Whether the operation was skipped (no appliedCommit to revert) */
	skipped?: boolean;
	/** Error message if the operation failed */
	error?: string;
}

/**
 * Handle an unchecked checkbox in an intent layer comment.
 *
 * This function:
 * 1. If no appliedCommit exists, does nothing (nothing to revert)
 * 2. If appliedCommit exists, performs a file-level revert to restore the file
 *    to its pre-commit state (before the intent change was applied)
 * 3. Updates the comment marker to clear the appliedCommit
 *
 * @param client - GitHub client for API operations
 * @param commentId - ID of the comment being processed
 * @param commentBody - Current body of the comment
 * @param markerData - Parsed marker data from the comment
 * @param options - Revert options (branch, symlink settings)
 * @returns Result of the operation
 */
export async function handleUncheckedCheckbox(
	client: GitHubClient,
	commentId: number,
	commentBody: string,
	markerData: CommentMarkerData,
	options: HandleUncheckedCheckboxOptions,
): Promise<HandleUncheckedCheckboxResult> {
	// Step 1: Check if there's an appliedCommit to revert
	if (!markerData.appliedCommit) {
		// No commit was ever applied - nothing to revert
		return {
			success: true,
			skipped: true,
		};
	}

	// Step 2: Perform the file-level revert
	const revertOptions: RevertCommitOptions = {
		branch: options.branch,
		appliedCommit: markerData.appliedCommit,
		nodePath: markerData.nodePath,
		otherNodePath: markerData.otherNodePath,
		reason: "Reverted via checkbox",
		symlink: options.symlink,
		symlinkSource: options.symlinkSource,
	};

	let commitResult: CommitResult;
	try {
		commitResult = await createIntentRevertCommit(client, revertOptions);
	} catch (error) {
		return {
			success: false,
			error: `Failed to create revert commit: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	// Step 3: Update the comment marker to clear the appliedCommit and add reverted status
	let updatedBody = clearCommentMarkerAppliedCommit(commentBody);
	updatedBody = addRevertedStatus(updatedBody, commitResult.sha);
	await client.updateComment(commentId, updatedBody);

	return {
		success: true,
		commitResult,
	};
}
