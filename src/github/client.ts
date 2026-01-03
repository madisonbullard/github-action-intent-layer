/**
 * GitHub API client wrapper for the intent-layer action.
 * Uses the repository's GITHUB_TOKEN for authentication.
 * Includes automatic retry with exponential backoff for rate limits.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

/**
 * Default retry configuration for API rate limit handling
 */
export interface RetryConfig {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries: number;
	/** Base delay in milliseconds for exponential backoff (default: 1000) */
	baseDelayMs: number;
	/** Maximum delay in milliseconds (default: 60000) */
	maxDelayMs: number;
	/** Jitter factor to randomize delays (0-1, default: 0.1) */
	jitterFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 60000,
	jitterFactor: 0.1,
};

/**
 * HTTP status codes that indicate rate limiting
 */
const RATE_LIMIT_STATUS_CODES = [403, 429];

/**
 * HTTP status codes that should trigger a retry (transient errors)
 */
const RETRYABLE_STATUS_CODES = [500, 502, 503, 504];

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateBackoffDelay(
	attempt: number,
	config: RetryConfig,
	retryAfterSeconds?: number,
): number {
	// If server provides retry-after header, use that (with some buffer)
	if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
		const serverDelay = retryAfterSeconds * 1000;
		// Add small jitter to server-provided delay
		const jitter = serverDelay * config.jitterFactor * Math.random();
		return Math.min(serverDelay + jitter, config.maxDelayMs);
	}

	// Exponential backoff: baseDelay * 2^attempt
	const exponentialDelay = config.baseDelayMs * 2 ** attempt;

	// Add jitter to prevent thundering herd
	const jitter = exponentialDelay * config.jitterFactor * Math.random();

	return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Extract retry-after value from error response
 */
function extractRetryAfter(error: unknown): number | undefined {
	if (
		error &&
		typeof error === "object" &&
		"response" in error &&
		error.response &&
		typeof error.response === "object"
	) {
		const response = error.response as {
			headers?: Record<string, string | number | undefined>;
		};

		// Check for retry-after header (can be in seconds or HTTP date format)
		const retryAfter = response.headers?.["retry-after"];
		if (retryAfter !== undefined) {
			const parsed = Number(retryAfter);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
			// Try parsing as HTTP date
			const date = Date.parse(String(retryAfter));
			if (!Number.isNaN(date)) {
				return Math.max(0, Math.ceil((date - Date.now()) / 1000));
			}
		}

		// Check for x-ratelimit-reset header (Unix timestamp)
		const rateLimitReset = response.headers?.["x-ratelimit-reset"];
		if (rateLimitReset !== undefined) {
			const resetTime = Number(rateLimitReset) * 1000; // Convert to ms
			if (!Number.isNaN(resetTime)) {
				return Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));
			}
		}
	}
	return undefined;
}

/**
 * Check if an error is retryable based on status code
 */
function isRetryableError(error: unknown): boolean {
	if (
		error &&
		typeof error === "object" &&
		"status" in error &&
		typeof error.status === "number"
	) {
		return (
			RATE_LIMIT_STATUS_CODES.includes(error.status) ||
			RETRYABLE_STATUS_CODES.includes(error.status)
		);
	}
	return false;
}

/**
 * Check if an error is specifically a rate limit error
 */
function isRateLimitError(error: unknown): boolean {
	if (
		error &&
		typeof error === "object" &&
		"status" in error &&
		typeof error.status === "number"
	) {
		return RATE_LIMIT_STATUS_CODES.includes(error.status);
	}
	return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic for rate limits and transient errors.
 * Uses exponential backoff with jitter.
 *
 * @param fn - Async function to execute
 * @param operationName - Name of the operation for logging
 * @param config - Retry configuration (uses defaults if not provided)
 * @returns Result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	operationName: string,
	config: Partial<RetryConfig> = {},
): Promise<T> {
	const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
	let lastError: unknown;

	for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry on last attempt
			if (attempt === fullConfig.maxRetries) {
				break;
			}

			// Check if error is retryable
			if (!isRetryableError(error)) {
				throw error;
			}

			// Calculate delay
			const retryAfterSeconds = extractRetryAfter(error);
			const delayMs = calculateBackoffDelay(
				attempt,
				fullConfig,
				retryAfterSeconds,
			);

			// Log retry attempt
			const errorType = isRateLimitError(error) ? "rate limit" : "transient";
			core.warning(
				`${operationName} failed with ${errorType} error (attempt ${attempt + 1}/${fullConfig.maxRetries + 1}). ` +
					`Retrying in ${Math.round(delayMs / 1000)}s...`,
			);

			await sleep(delayMs);
		}
	}

	throw lastError;
}

/** Type for the authenticated Octokit client */
export type OctokitClient = ReturnType<typeof github.getOctokit>;

/** GitHub context from the action environment */
export type GitHubContext = typeof github.context;

/**
 * Configuration for creating a GitHub client
 */
export interface GitHubClientConfig {
	/** GitHub token for authentication (typically GITHUB_TOKEN) */
	token: string;
}

/**
 * Wrapper around the GitHub API client with convenience methods
 * for common operations used by the intent-layer action.
 */
export class GitHubClient {
	private octokit: OctokitClient;
	private _context: GitHubContext;

	constructor(config: GitHubClientConfig) {
		this.octokit = github.getOctokit(config.token);
		this._context = github.context;
	}

	/**
	 * Get the raw Octokit client for direct API access
	 */
	get raw(): OctokitClient {
		return this.octokit;
	}

	/**
	 * Get the GitHub Actions context
	 */
	get context(): GitHubContext {
		return this._context;
	}

	/**
	 * Get repository owner and name from context
	 */
	get repo(): { owner: string; repo: string } {
		return this._context.repo;
	}

	/**
	 * Get the current event name (e.g., 'pull_request', 'issue_comment')
	 */
	get eventName(): string {
		return this._context.eventName;
	}

	/**
	 * Get the current SHA
	 */
	get sha(): string {
		return this._context.sha;
	}

	/**
	 * Get the actor (user) who triggered the action
	 */
	get actor(): string {
		return this._context.actor;
	}

	/**
	 * Get the pull request number from context (if applicable)
	 * Returns undefined if not in a PR context
	 */
	get pullRequestNumber(): number | undefined {
		return this._context.payload.pull_request?.number;
	}

	/**
	 * Get the issue number from context (works for both issues and PRs)
	 * Returns undefined if not in an issue/PR context
	 */
	get issueNumber(): number | undefined {
		return this._context.issue.number;
	}

	/**
	 * Check if the current event is a pull request event
	 */
	isPullRequestEvent(): boolean {
		return this._context.eventName === "pull_request";
	}

	/**
	 * Check if the current event is an issue comment event
	 */
	isIssueCommentEvent(): boolean {
		return this._context.eventName === "issue_comment";
	}

	/**
	 * Get pull request details
	 */
	async getPullRequest(pullNumber: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.pulls.get({
				...this.repo,
				pull_number: pullNumber,
			});
			return data;
		}, `getPullRequest(${pullNumber})`);
	}

	/**
	 * Get pull request diff
	 */
	async getPullRequestDiff(pullNumber: number): Promise<string> {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.pulls.get({
				...this.repo,
				pull_number: pullNumber,
				mediaType: {
					format: "diff",
				},
			});
			// When using diff format, data is returned as a string
			return data as unknown as string;
		}, `getPullRequestDiff(${pullNumber})`);
	}

	/**
	 * Get files changed in a pull request
	 */
	async getPullRequestFiles(pullNumber: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.pulls.listFiles({
				...this.repo,
				pull_number: pullNumber,
				per_page: 100,
			});
			return data;
		}, `getPullRequestFiles(${pullNumber})`);
	}

	/**
	 * Get commits in a pull request
	 */
	async getPullRequestCommits(pullNumber: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.pulls.listCommits({
				...this.repo,
				pull_number: pullNumber,
				per_page: 100,
			});
			return data;
		}, `getPullRequestCommits(${pullNumber})`);
	}

	/**
	 * Get comments on an issue/PR
	 */
	async getIssueComments(issueNumber: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.issues.listComments({
				...this.repo,
				issue_number: issueNumber,
				per_page: 100,
			});
			return data;
		}, `getIssueComments(${issueNumber})`);
	}

	/**
	 * Create a comment on an issue/PR
	 */
	async createComment(issueNumber: number, body: string) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.issues.createComment({
				...this.repo,
				issue_number: issueNumber,
				body,
			});
			return data;
		}, `createComment(${issueNumber})`);
	}

	/**
	 * Update an existing comment
	 */
	async updateComment(commentId: number, body: string) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.issues.updateComment({
				...this.repo,
				comment_id: commentId,
				body,
			});
			return data;
		}, `updateComment(${commentId})`);
	}

	/**
	 * Get a single comment by ID
	 */
	async getComment(commentId: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.issues.getComment({
				...this.repo,
				comment_id: commentId,
			});
			return data;
		}, `getComment(${commentId})`);
	}

	/**
	 * Get review comments on a pull request
	 */
	async getPullRequestReviewComments(pullNumber: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.pulls.listReviewComments({
				...this.repo,
				pull_number: pullNumber,
				per_page: 100,
			});
			return data;
		}, `getPullRequestReviewComments(${pullNumber})`);
	}

	/**
	 * Get file content from the repository
	 */
	async getFileContent(path: string, ref?: string) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.repos.getContent({
				...this.repo,
				path,
				ref,
			});
			return data;
		}, `getFileContent(${path})`);
	}

	/**
	 * Create or update a file in the repository
	 */
	async createOrUpdateFile(
		path: string,
		content: string,
		message: string,
		branch: string,
		sha?: string,
	) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.repos.createOrUpdateFileContents(
				{
					...this.repo,
					path,
					message,
					content: Buffer.from(content).toString("base64"),
					branch,
					sha,
				},
			);
			return data;
		}, `createOrUpdateFile(${path})`);
	}

	/**
	 * Get an issue by number
	 */
	async getIssue(issueNumber: number) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.issues.get({
				...this.repo,
				issue_number: issueNumber,
			});
			return data;
		}, `getIssue(${issueNumber})`);
	}

	/**
	 * Create a new branch
	 */
	async createBranch(branchName: string, sha: string) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.git.createRef({
				...this.repo,
				ref: `refs/heads/${branchName}`,
				sha,
			});
			return data;
		}, `createBranch(${branchName})`);
	}

	/**
	 * Create a pull request
	 */
	async createPullRequest(
		title: string,
		body: string,
		head: string,
		base: string,
	) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.pulls.create({
				...this.repo,
				title,
				body,
				head,
				base,
			});
			return data;
		}, `createPullRequest(${head} -> ${base})`);
	}

	/**
	 * Get the default branch of the repository
	 */
	async getDefaultBranch(): Promise<string> {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.repos.get({
				...this.repo,
			});
			return data.default_branch;
		}, "getDefaultBranch");
	}

	/**
	 * Get a commit by SHA
	 */
	async getCommit(sha: string) {
		return withRetry(
			async () => {
				const { data } = await this.octokit.rest.repos.getCommit({
					...this.repo,
					ref: sha,
				});
				return data;
			},
			`getCommit(${sha.substring(0, 7)})`,
		);
	}

	/**
	 * Delete a file from the repository
	 */
	async deleteFile(path: string, message: string, branch: string, sha: string) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.repos.deleteFile({
				...this.repo,
				path,
				message,
				branch,
				sha,
			});
			return data;
		}, `deleteFile(${path})`);
	}

	/**
	 * Create a blob in the repository
	 */
	async createBlob(content: string, encoding: "utf-8" | "base64" = "utf-8") {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.git.createBlob({
				...this.repo,
				content,
				encoding,
			});
			return data;
		}, "createBlob");
	}

	/**
	 * Create a tree in the repository
	 */
	async createTree(
		tree: Array<{
			path: string;
			mode: "100644" | "100755" | "040000" | "160000" | "120000";
			type: "blob" | "tree" | "commit";
			sha?: string | null;
			content?: string;
		}>,
		baseTree?: string,
	) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.git.createTree({
				...this.repo,
				tree,
				base_tree: baseTree,
			});
			return data;
		}, "createTree");
	}

	/**
	 * Create a commit in the repository
	 */
	async createCommit(
		message: string,
		tree: string,
		parents: string[],
		author?: { name: string; email: string },
	) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.git.createCommit({
				...this.repo,
				message,
				tree,
				parents,
				author,
			});
			return data;
		}, "createCommit");
	}

	/**
	 * Update a reference (branch) in the repository
	 */
	async updateRef(ref: string, sha: string, force = false) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.git.updateRef({
				...this.repo,
				ref,
				sha,
				force,
			});
			return data;
		}, `updateRef(${ref})`);
	}

	/**
	 * Get a reference (branch) from the repository
	 */
	async getRef(ref: string) {
		return withRetry(async () => {
			const { data } = await this.octokit.rest.git.getRef({
				...this.repo,
				ref,
			});
			return data;
		}, `getRef(${ref})`);
	}

	/**
	 * Create multiple files including symlinks in a single commit.
	 *
	 * This uses the Git Tree API to create symlinks (mode 120000)
	 * which cannot be done with the standard file contents API.
	 *
	 * @param files - Array of files to create/update
	 * @param message - Commit message
	 * @param branch - Branch to commit to
	 * @returns Commit result with SHA and URL
	 */
	async createFilesWithSymlinks(
		files: Array<{
			path: string;
			content: string;
			isSymlink: boolean;
		}>,
		message: string,
		branch: string,
	): Promise<{ sha: string; url: string }> {
		const { owner, repo } = this.repo;

		// Get the current commit SHA for the branch
		const refData = await this.getRef(`heads/${branch}`);
		const currentCommitSha = refData.object.sha;

		// Get the current commit to find the tree SHA
		const commitData = await withRetry(
			async () => {
				const { data } = await this.octokit.rest.git.getCommit({
					owner,
					repo,
					commit_sha: currentCommitSha,
				});
				return data;
			},
			`getCommit(${currentCommitSha.substring(0, 7)})`,
		);
		const baseTreeSha = commitData.tree.sha;

		// Create tree entries for each file
		const treeEntries: Array<{
			path: string;
			mode: "100644" | "100755" | "040000" | "160000" | "120000";
			type: "blob" | "tree" | "commit";
			sha?: string;
			content?: string;
		}> = [];

		for (const file of files) {
			if (file.isSymlink) {
				// For symlinks, create a blob with the target path and use mode 120000
				const blob = await this.createBlob(file.content, "utf-8");
				treeEntries.push({
					path: file.path,
					mode: "120000", // Symlink mode
					type: "blob",
					sha: blob.sha,
				});
			} else {
				// For regular files, we can include the content directly
				treeEntries.push({
					path: file.path,
					mode: "100644",
					type: "blob",
					content: file.content,
				});
			}
		}

		// Create the new tree based on the current tree
		const newTree = await this.createTree(treeEntries, baseTreeSha);

		// Create the commit
		const newCommit = await this.createCommit(message, newTree.sha, [
			currentCommitSha,
		]);

		// Update the branch to point to the new commit
		await this.updateRef(`heads/${branch}`, newCommit.sha);

		return {
			sha: newCommit.sha,
			url: newCommit.html_url,
		};
	}
}

/**
 * Create a GitHub client from the action environment.
 * Reads the token from the 'github-token' input or GITHUB_TOKEN env var.
 */
export function createGitHubClient(): GitHubClient {
	// Try to get token from action input first, then fall back to env var
	let token: string;
	try {
		token = core.getInput("github-token", { required: false });
	} catch {
		token = "";
	}

	if (!token) {
		token = process.env.GITHUB_TOKEN || "";
	}

	if (!token) {
		throw new Error(
			"GitHub token not found. Please provide it via 'github-token' input or GITHUB_TOKEN environment variable.",
		);
	}

	return new GitHubClient({ token });
}

/**
 * Export the context directly for convenience
 */
export const context = github.context;
