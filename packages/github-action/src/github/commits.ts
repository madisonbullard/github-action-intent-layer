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

import type { SymlinkSource } from "../config/schema.js";
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
	/** Whether to create symlinks between AGENTS.md and CLAUDE.md */
	symlink?: boolean;
	/** Which file is the source of truth when symlinking (agents or claude) */
	symlinkSource?: SymlinkSource;
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
 * Get the filename from a path.
 *
 * @param path - File path
 * @returns Filename
 */
function getFilename(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? path : path.substring(lastSlash + 1);
}

/**
 * Determine the symlink target path for intent files in the same directory.
 * Returns the filename of the target since symlinks are relative.
 *
 * @param symlinkPath - Path of the symlink file
 * @param targetPath - Path of the target file
 * @returns Relative symlink target (just the filename)
 */
function getSymlinkTarget(symlinkPath: string, targetPath: string): string {
	// Since both files are in the same directory, the target is just the filename
	return getFilename(targetPath);
}

/**
 * Create an [INTENT:ADD] commit for a new intent file.
 *
 * This creates a new file in the repository with the suggested content
 * from an intent update. The file must not already exist.
 *
 * When symlink option is enabled and otherNodePath is specified:
 * - The source file (based on symlinkSource) contains the actual content
 * - The other file is created as a symlink pointing to the source
 *
 * @param client - GitHub client for API operations
 * @param update - The intent update with action="create"
 * @param options - Commit options including branch and symlink settings
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

	// Handle symlink creation when both files are being managed
	if (update.otherNodePath && options.symlink) {
		const otherExistingSha = await getFileSha(
			client,
			update.otherNodePath,
			options.branch,
		);
		if (!otherExistingSha) {
			// Create both files with symlink using the Git Tree API
			return createFilesWithSymlink(
				client,
				update.nodePath,
				update.otherNodePath,
				update.suggestedContent,
				commitMessage,
				options.branch,
				options.symlinkSource ?? "agents",
			);
		}
	}

	// Standard file creation without symlink
	const result = await client.createOrUpdateFile(
		update.nodePath,
		update.suggestedContent,
		commitMessage,
		options.branch,
		undefined, // No SHA since file doesn't exist
	);

	// Handle the otherNodePath if both files are being managed (non-symlink mode)
	// For INTENT:ADD, if otherNodePath is specified, we create that file too
	// with the same content (they're kept in sync)
	if (update.otherNodePath && !options.symlink) {
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
 * Create both source file and symlink in a single commit.
 *
 * @param client - GitHub client
 * @param nodePath - Path to the primary intent file
 * @param otherNodePath - Path to the secondary intent file
 * @param content - Content for the source file
 * @param message - Commit message
 * @param branch - Branch to commit to
 * @param symlinkSource - Which file type is the source (agents or claude)
 * @returns Commit result
 */
async function createFilesWithSymlink(
	client: GitHubClient,
	nodePath: string,
	otherNodePath: string,
	content: string,
	message: string,
	branch: string,
	symlinkSource: SymlinkSource,
): Promise<CommitResult> {
	// Determine which file is the source and which is the symlink
	const nodeFilename = getFilename(nodePath);
	const isNodeAgents = nodeFilename === "AGENTS.md";

	let sourcePath: string;
	let symlinkPath: string;

	if (symlinkSource === "agents") {
		// AGENTS.md is source, CLAUDE.md is symlink
		sourcePath = isNodeAgents ? nodePath : otherNodePath;
		symlinkPath = isNodeAgents ? otherNodePath : nodePath;
	} else {
		// CLAUDE.md is source, AGENTS.md is symlink
		sourcePath = isNodeAgents ? otherNodePath : nodePath;
		symlinkPath = isNodeAgents ? nodePath : otherNodePath;
	}

	// Create the symlink target (relative path, just the filename)
	const symlinkTarget = getSymlinkTarget(symlinkPath, sourcePath);

	// Create both files using the Git Tree API
	const result = await client.createFilesWithSymlinks(
		[
			{
				path: sourcePath,
				content: content,
				isSymlink: false,
			},
			{
				path: symlinkPath,
				content: symlinkTarget,
				isSymlink: true,
			},
		],
		message,
		branch,
	);

	return {
		sha: result.sha,
		url: result.url,
		filePath: nodePath,
		message: message,
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
 * Options for creating a revert commit.
 */
export interface RevertCommitOptions {
	/** Branch to commit to */
	branch: string;
	/** SHA of the commit that applied the intent change (to find parent state) */
	appliedCommit: string;
	/** Path to the intent file to revert */
	nodePath: string;
	/** Optional path to the other intent file (e.g., CLAUDE.md if nodePath is AGENTS.md) */
	otherNodePath?: string;
	/** Optional reason for the revert */
	reason?: string;
	/** Whether symlinks are enabled (affects how we handle other file) */
	symlink?: boolean;
	/** Which file is the source of truth when symlinking */
	symlinkSource?: SymlinkSource;
}

/**
 * Create an [INTENT:UPDATE] commit for an existing intent file.
 *
 * This updates an existing file in the repository with the suggested content
 * from an intent update. The file must already exist.
 *
 * When symlink option is enabled and the files are symlinked:
 * - Only the source file content is updated
 * - The symlink automatically reflects the changes
 *
 * @param client - GitHub client for API operations
 * @param update - The intent update with action="update"
 * @param options - Commit options including branch and symlink settings
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

	// When symlink mode is enabled, we only need to update the source file
	// The symlink will automatically point to the updated content
	if (options.symlink && update.otherNodePath) {
		// Determine which file is the source based on symlinkSource
		const nodeFilename = getFilename(update.nodePath);
		const isNodeAgents = nodeFilename === "AGENTS.md";
		const symlinkSource = options.symlinkSource ?? "agents";

		// Check if nodePath is the source file
		const nodeIsSource =
			(symlinkSource === "agents" && isNodeAgents) ||
			(symlinkSource === "claude" && !isNodeAgents);

		if (nodeIsSource) {
			// nodePath is the source, just update it
			const result = await client.createOrUpdateFile(
				update.nodePath,
				update.suggestedContent,
				commitMessage,
				options.branch,
				existingSha,
			);
			return {
				sha: result.commit.sha ?? "",
				url: result.commit.html_url ?? "",
				filePath: update.nodePath,
				message: commitMessage,
			};
		}
		// nodePath is the symlink, update the source (otherNodePath) instead
		const otherExistingSha = await getFileSha(
			client,
			update.otherNodePath,
			options.branch,
		);
		if (otherExistingSha) {
			const result = await client.createOrUpdateFile(
				update.otherNodePath,
				update.suggestedContent,
				commitMessage,
				options.branch,
				otherExistingSha,
			);
			return {
				sha: result.commit.sha ?? "",
				url: result.commit.html_url ?? "",
				filePath: update.nodePath,
				message: commitMessage,
			};
		}
	}

	// Update the file
	const result = await client.createOrUpdateFile(
		update.nodePath,
		update.suggestedContent,
		commitMessage,
		options.branch,
		existingSha, // Provide SHA to update existing file
	);

	// Handle the otherNodePath if both files are being managed (non-symlink mode)
	// For INTENT:UPDATE, if otherNodePath is specified, we update that file too
	// with the same content (they're kept in sync)
	if (update.otherNodePath && !options.symlink) {
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

/**
 * Get the content of a file at a specific commit.
 * Returns undefined if the file didn't exist at that commit.
 *
 * @param client - GitHub client
 * @param filePath - Path to the file
 * @param ref - Git reference (commit SHA)
 * @returns File content as string, or undefined if file didn't exist
 */
async function getFileContentAtCommit(
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
		// Content is base64 encoded
		if ("content" in content && content.content) {
			return Buffer.from(content.content, "base64").toString("utf-8");
		}
		return undefined;
	} catch (error) {
		// File doesn't exist at this commit
		if (isNotFoundError(error)) {
			return undefined;
		}
		throw error;
	}
}

/**
 * Create an [INTENT:REVERT] commit that restores an intent file to its pre-commit state.
 *
 * This performs a file-level revert by:
 * 1. Getting the parent commit of the appliedCommit
 * 2. Fetching the file content from the parent commit
 * 3. Either restoring that content or deleting the file if it didn't exist before
 *
 * @param client - GitHub client for API operations
 * @param options - Revert options including appliedCommit SHA
 * @returns Result of the commit operation
 * @throws Error if the appliedCommit cannot be found or has no parent
 */
/**
 * Result of creating an intent layer branch.
 */
export interface IntentLayerBranchResult {
	/** Name of the created branch */
	branchName: string;
	/** SHA of the commit the branch points to */
	sha: string;
	/** Full ref path (refs/heads/...) */
	ref: string;
}

/**
 * Generate the branch name for an intent layer PR.
 *
 * @param prNumber - The pull request number
 * @returns Branch name in the format `intent-layer/<pr-number>`
 */
export function generateIntentLayerBranchName(prNumber: number): string {
	return `intent-layer/${prNumber}`;
}

/**
 * Create a separate branch for intent layer updates.
 *
 * This is used by `output: new_pr` mode to create a branch
 * that will contain all intent layer changes, which is then
 * used as the head of a new PR targeting the original PR's branch.
 *
 * @param client - GitHub client for API operations
 * @param prNumber - The pull request number (used in branch name)
 * @param baseSha - The SHA to base the new branch on (typically the PR's head SHA)
 * @returns Result containing the branch name and ref info
 * @throws Error if the branch already exists or creation fails
 */
export async function createIntentLayerBranch(
	client: GitHubClient,
	prNumber: number,
	baseSha: string,
): Promise<IntentLayerBranchResult> {
	const branchName = generateIntentLayerBranchName(prNumber);

	const refData = await client.createBranch(branchName, baseSha);

	return {
		branchName,
		sha: refData.object.sha,
		ref: refData.ref,
	};
}

export async function createIntentRevertCommit(
	client: GitHubClient,
	options: RevertCommitOptions,
): Promise<CommitResult> {
	const { branch, appliedCommit, nodePath, otherNodePath, reason } = options;

	// Get the commit to find its parent
	const commit = await client.getCommit(appliedCommit);
	const parents = commit.parents;

	if (!parents || parents.length === 0) {
		throw new Error(
			`Cannot revert: commit ${appliedCommit} has no parent (is it the initial commit?)`,
		);
	}

	// Use the first parent (for merge commits, this is typically the main branch)
	const parentSha = parents[0]!.sha;

	// Get the file content from the parent commit (before the intent change)
	const previousContent = await getFileContentAtCommit(
		client,
		nodePath,
		parentSha,
	);

	// Generate commit message
	const commitMessage = generateRevertCommitMessage(nodePath, reason);

	let result: { commit: { sha?: string; html_url?: string } };

	if (previousContent === undefined) {
		// File didn't exist before the intent commit - delete it
		const currentSha = await getFileSha(client, nodePath, branch);
		if (!currentSha) {
			throw new Error(
				`Cannot revert ${nodePath}: file no longer exists on branch ${branch}`,
			);
		}

		result = await client.deleteFile(
			nodePath,
			commitMessage,
			branch,
			currentSha,
		);
	} else {
		// File existed before - restore its previous content
		const currentSha = await getFileSha(client, nodePath, branch);
		if (!currentSha) {
			throw new Error(
				`Cannot revert ${nodePath}: file no longer exists on branch ${branch}`,
			);
		}

		result = await client.createOrUpdateFile(
			nodePath,
			previousContent,
			commitMessage,
			branch,
			currentSha,
		);
	}

	// Handle the otherNodePath if both files are being managed
	if (otherNodePath) {
		const otherPreviousContent = await getFileContentAtCommit(
			client,
			otherNodePath,
			parentSha,
		);
		const otherCurrentSha = await getFileSha(client, otherNodePath, branch);

		if (otherCurrentSha) {
			const otherCommitMessage = `[INTENT:REVERT] ${otherNodePath} - Sync with ${nodePath}`;

			if (otherPreviousContent === undefined) {
				// Other file didn't exist before - delete it
				await client.deleteFile(
					otherNodePath,
					otherCommitMessage,
					branch,
					otherCurrentSha,
				);
			} else {
				// Other file existed before - restore its previous content
				await client.createOrUpdateFile(
					otherNodePath,
					otherPreviousContent,
					otherCommitMessage,
					branch,
					otherCurrentSha,
				);
			}
		}
	}

	return {
		sha: result.commit.sha ?? "",
		url: result.commit.html_url ?? "",
		filePath: nodePath,
		message: commitMessage,
	};
}

/**
 * Result of applying multiple intent updates to a branch.
 */
export interface ApplyUpdatesResult {
	/** Array of commit results for each successfully applied update */
	commits: CommitResult[];
	/** Number of updates successfully applied */
	appliedCount: number;
	/** Total number of updates attempted */
	totalCount: number;
	/** Any errors that occurred during application */
	errors: Array<{ update: IntentUpdate; error: string }>;
}

/**
 * Options for applying updates to a branch.
 */
export interface ApplyUpdatesOptions extends IntentCommitOptions {
	/**
	 * Whether to stop on first error (default: false).
	 * When false, continues applying remaining updates even if one fails.
	 */
	stopOnError?: boolean;
}

/**
 * Apply all suggested intent layer changes to a branch.
 *
 * This function is used by `output: new_pr` mode to apply all proposed
 * intent layer updates to a branch without requiring approval checkboxes.
 * Each update is applied in sequence, creating individual commits.
 *
 * The function handles:
 * - Create actions: Creates new intent files using `createIntentAddCommit`
 * - Update actions: Updates existing intent files using `createIntentUpdateCommit`
 * - Delete actions: Not yet implemented (rare use case)
 *
 * @param client - GitHub client for API operations
 * @param updates - Array of intent updates to apply
 * @param options - Options including branch name and symlink settings
 * @returns Result containing all commit results and any errors
 */
export async function applyUpdatesToBranch(
	client: GitHubClient,
	updates: IntentUpdate[],
	options: ApplyUpdatesOptions,
): Promise<ApplyUpdatesResult> {
	const commits: CommitResult[] = [];
	const errors: Array<{ update: IntentUpdate; error: string }> = [];
	const stopOnError = options.stopOnError ?? false;

	for (const update of updates) {
		try {
			let result: CommitResult;

			switch (update.action) {
				case "create":
					result = await createIntentAddCommit(client, update, options);
					break;

				case "update":
					result = await createIntentUpdateCommit(client, update, options);
					break;

				case "delete":
					// Delete actions are rare and typically handled via revert
					// For now, skip delete actions in batch apply
					// TODO: Implement delete handling if needed
					continue;

				default:
					// TypeScript exhaustive check
					throw new Error(
						`Unknown action type: ${(update as IntentUpdate).action}`,
					);
			}

			commits.push(result);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			errors.push({ update, error: errorMessage });

			if (stopOnError) {
				break;
			}
		}
	}

	return {
		commits,
		appliedCount: commits.length,
		totalCount: updates.length,
		errors,
	};
}

/**
 * Generate a summary commit message for batch intent layer updates.
 *
 * This is used when `output: pr_commit` mode applies all changes in a single
 * logical operation (though technically still individual commits via API).
 *
 * @returns Standard batch commit message
 */
export function generateBatchCommitMessage(): string {
	return "[INTENT] apply intent layer updates";
}
