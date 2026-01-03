/**
 * Commit Operations for Intent Layer
 *
 * Provides utilities for creating commits that add, update, or revert
 * intent layer files (AGENTS.md, CLAUDE.md) in a pull request.
 *
 * Commit message conventions:
 * - [INTENT:ADD] path/to/AGENTS.md - Description
 * - [INTENT:UPDATE] path/to/AGENTS.md - Description
 * - [INTENT:REVERT] path/to/AGENTS.md - Description
 */

import type { IntentUpdate } from "../opencode/output-schema.js";
import type { GitHubClient } from "./client.js";

/**
 * Result of a commit operation.
 */
export interface CommitResult {
	/** SHA of the created commit */
	sha: string;
	/** URL to view the commit on GitHub */
	url: string;
	/** Path of the file that was committed */
	filePath: string;
	/** The commit message used */
	message: string;
}

/**
 * Options for creating an intent commit.
 */
export interface IntentCommitOptions {
	/** Branch to commit to */
	branch: string;
	/** Optional author name (defaults to GitHub Actions bot) */
	authorName?: string;
	/** Optional author email (defaults to GitHub Actions bot email) */
	authorEmail?: string;
}

/**
 * Generate a commit message for an INTENT:ADD operation.
 *
 * @param nodePath - Path to the intent file being created
 * @param reason - Human-readable reason for the change
 * @returns Formatted commit message
 */
export function generateAddCommitMessage(
	nodePath: string,
	reason: string,
): string {
	// Truncate reason if too long (keep commit messages reasonable)
	const truncatedReason =
		reason.length > 100 ? `${reason.substring(0, 97)}...` : reason;
	return `[INTENT:ADD] ${nodePath} - ${truncatedReason}`;
}

/**
 * Generate a commit message for an INTENT:UPDATE operation.
 *
 * @param nodePath - Path to the intent file being updated
 * @param reason - Human-readable reason for the change
 * @returns Formatted commit message
 */
export function generateUpdateCommitMessage(
	nodePath: string,
	reason: string,
): string {
	const truncatedReason =
		reason.length > 100 ? `${reason.substring(0, 97)}...` : reason;
	return `[INTENT:UPDATE] ${nodePath} - ${truncatedReason}`;
}

/**
 * Generate a commit message for an INTENT:REVERT operation.
 *
 * @param nodePath - Path to the intent file being reverted
 * @param reason - Optional reason for the revert
 * @returns Formatted commit message
 */
export function generateRevertCommitMessage(
	nodePath: string,
	reason = "Reverted via checkbox",
): string {
	const truncatedReason =
		reason.length > 100 ? `${reason.substring(0, 97)}...` : reason;
	return `[INTENT:REVERT] ${nodePath} - ${truncatedReason}`;
}

/**
 * Get the current SHA of a file in the repository.
 * Returns undefined if the file doesn't exist.
 *
 * @param client - GitHub client
 * @param filePath - Path to the file
 * @param ref - Git reference (branch/tag/sha)
 * @returns File blob SHA, or undefined if file doesn't exist
 */
export async function getFileSha(
	client: GitHubClient,
	filePath: string,
	ref: string,
): Promise<string | undefined> {
	try {
		const content = await client.getFileContent(filePath, ref);
		// Handle the case where content is an array (directory listing)
		if (Array.isArray(content)) {
			return undefined;
		}
		return content.sha;
	} catch (error) {
		// File doesn't exist
		if (isNotFoundError(error)) {
			return undefined;
		}
		throw error;
	}
}

/**
 * Check if an error is a GitHub 404 Not Found error.
 *
 * @param error - The error to check
 * @returns True if this is a 404 error
 */
function isNotFoundError(error: unknown): boolean {
	if (error && typeof error === "object" && "status" in error) {
		return (error as { status: number }).status === 404;
	}
	return false;
}

/**
 * Create an [INTENT:ADD] commit for a new intent file.
 *
 * This creates a new file in the repository with the suggested content
 * from an intent update. The file must not already exist.
 *
 * @param client - GitHub client for API operations
 * @param update - The intent update with action="create"
 * @param options - Commit options including branch
 * @returns Result of the commit operation
 * @throws Error if the file already exists or update is not a create action
 */
export async function createIntentAddCommit(
	client: GitHubClient,
	update: IntentUpdate,
	options: IntentCommitOptions,
): Promise<CommitResult> {
	// Validate the update is a create action
	if (update.action !== "create") {
		throw new Error(
			`createIntentAddCommit requires action="create", got "${update.action}"`,
		);
	}

	if (!update.suggestedContent) {
		throw new Error("createIntentAddCommit requires suggestedContent");
	}

	// Check if file already exists
	const existingSha = await getFileSha(client, update.nodePath, options.branch);
	if (existingSha) {
		throw new Error(
			`Cannot create ${update.nodePath}: file already exists. Use update action instead.`,
		);
	}

	// Generate commit message
	const commitMessage = generateAddCommitMessage(
		update.nodePath,
		update.reason,
	);

	// Create the file
	const result = await client.createOrUpdateFile(
		update.nodePath,
		update.suggestedContent,
		commitMessage,
		options.branch,
		undefined, // No SHA since file doesn't exist
	);

	// Handle the otherNodePath if both files are being managed
	// For INTENT:ADD, if otherNodePath is specified, we create that file too
	// with the same content (they're kept in sync)
	if (update.otherNodePath) {
		const otherExistingSha = await getFileSha(
			client,
			update.otherNodePath,
			options.branch,
		);
		if (!otherExistingSha) {
			// Create the other file with the same content
			await client.createOrUpdateFile(
				update.otherNodePath,
				update.suggestedContent,
				`[INTENT:ADD] ${update.otherNodePath} - Sync with ${update.nodePath}`,
				options.branch,
				undefined,
			);
		}
	}

	return {
		sha: result.commit.sha ?? "",
		url: result.commit.html_url ?? "",
		filePath: update.nodePath,
		message: commitMessage,
	};
}

/**
 * Determine the commit type prefix based on the intent action.
 *
 * @param action - The intent action type
 * @returns The commit message prefix
 */
export function getCommitPrefix(
	action: IntentUpdate["action"],
): "[INTENT:ADD]" | "[INTENT:UPDATE]" | "[INTENT:REVERT]" {
	switch (action) {
		case "create":
			return "[INTENT:ADD]";
		case "update":
			return "[INTENT:UPDATE]";
		case "delete":
			return "[INTENT:REVERT]";
	}
}

/**
 * Parse a commit message to extract intent layer information.
 *
 * @param message - The commit message to parse
 * @returns Parsed information or null if not an intent commit
 */
export function parseIntentCommitMessage(message: string): {
	type: "ADD" | "UPDATE" | "REVERT";
	nodePath: string;
	reason: string;
} | null {
	const match = message.match(
		/^\[INTENT:(ADD|UPDATE|REVERT)\]\s+([^\s]+)\s+-\s+(.+)$/,
	);
	if (!match) {
		return null;
	}

	return {
		type: match[1] as "ADD" | "UPDATE" | "REVERT",
		nodePath: match[2]!,
		reason: match[3]!,
	};
}

/**
 * Check if a commit message is an intent layer commit.
 *
 * @param message - The commit message to check
 * @returns True if this is an intent layer commit
 */
export function isIntentCommit(message: string): boolean {
	return /^\[INTENT:(ADD|UPDATE|REVERT)\]/.test(message);
}

/**
 * Create an [INTENT:UPDATE] commit for an existing intent file.
 *
 * This updates an existing file in the repository with the suggested content
 * from an intent update. The file must already exist.
 *
 * @param client - GitHub client for API operations
 * @param update - The intent update with action="update"
 * @param options - Commit options including branch
 * @returns Result of the commit operation
 * @throws Error if the file doesn't exist or update is not an update action
 */
export async function createIntentUpdateCommit(
	client: GitHubClient,
	update: IntentUpdate,
	options: IntentCommitOptions,
): Promise<CommitResult> {
	// Validate the update is an update action
	if (update.action !== "update") {
		throw new Error(
			`createIntentUpdateCommit requires action="update", got "${update.action}"`,
		);
	}

	if (!update.suggestedContent) {
		throw new Error("createIntentUpdateCommit requires suggestedContent");
	}

	if (!update.currentContent) {
		throw new Error("createIntentUpdateCommit requires currentContent");
	}

	// Get the existing file SHA (required for updating)
	const existingSha = await getFileSha(client, update.nodePath, options.branch);
	if (!existingSha) {
		throw new Error(
			`Cannot update ${update.nodePath}: file does not exist. Use create action instead.`,
		);
	}

	// Generate commit message
	const commitMessage = generateUpdateCommitMessage(
		update.nodePath,
		update.reason,
	);

	// Update the file
	const result = await client.createOrUpdateFile(
		update.nodePath,
		update.suggestedContent,
		commitMessage,
		options.branch,
		existingSha, // Provide SHA to update existing file
	);

	// Handle the otherNodePath if both files are being managed
	// For INTENT:UPDATE, if otherNodePath is specified, we update that file too
	// with the same content (they're kept in sync)
	if (update.otherNodePath) {
		const otherExistingSha = await getFileSha(
			client,
			update.otherNodePath,
			options.branch,
		);
		if (otherExistingSha) {
			// Update the other file with the same content
			await client.createOrUpdateFile(
				update.otherNodePath,
				update.suggestedContent,
				`[INTENT:UPDATE] ${update.otherNodePath} - Sync with ${update.nodePath}`,
				options.branch,
				otherExistingSha,
			);
		}
	}

	return {
		sha: result.commit.sha ?? "",
		url: result.commit.html_url ?? "",
		filePath: update.nodePath,
		message: commitMessage,
	};
}
