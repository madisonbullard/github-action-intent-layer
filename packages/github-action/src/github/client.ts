/**
 * GitHub API client wrapper for the intent-layer action.
 * Uses the repository's GITHUB_TOKEN for authentication.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

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
		const { data } = await this.octokit.rest.pulls.get({
			...this.repo,
			pull_number: pullNumber,
		});
		return data;
	}

	/**
	 * Get pull request diff
	 */
	async getPullRequestDiff(pullNumber: number): Promise<string> {
		const { data } = await this.octokit.rest.pulls.get({
			...this.repo,
			pull_number: pullNumber,
			mediaType: {
				format: "diff",
			},
		});
		// When using diff format, data is returned as a string
		return data as unknown as string;
	}

	/**
	 * Get files changed in a pull request
	 */
	async getPullRequestFiles(pullNumber: number) {
		const { data } = await this.octokit.rest.pulls.listFiles({
			...this.repo,
			pull_number: pullNumber,
			per_page: 100,
		});
		return data;
	}

	/**
	 * Get commits in a pull request
	 */
	async getPullRequestCommits(pullNumber: number) {
		const { data } = await this.octokit.rest.pulls.listCommits({
			...this.repo,
			pull_number: pullNumber,
			per_page: 100,
		});
		return data;
	}

	/**
	 * Get comments on an issue/PR
	 */
	async getIssueComments(issueNumber: number) {
		const { data } = await this.octokit.rest.issues.listComments({
			...this.repo,
			issue_number: issueNumber,
			per_page: 100,
		});
		return data;
	}

	/**
	 * Create a comment on an issue/PR
	 */
	async createComment(issueNumber: number, body: string) {
		const { data } = await this.octokit.rest.issues.createComment({
			...this.repo,
			issue_number: issueNumber,
			body,
		});
		return data;
	}

	/**
	 * Update an existing comment
	 */
	async updateComment(commentId: number, body: string) {
		const { data } = await this.octokit.rest.issues.updateComment({
			...this.repo,
			comment_id: commentId,
			body,
		});
		return data;
	}

	/**
	 * Get a single comment by ID
	 */
	async getComment(commentId: number) {
		const { data } = await this.octokit.rest.issues.getComment({
			...this.repo,
			comment_id: commentId,
		});
		return data;
	}

	/**
	 * Get review comments on a pull request
	 */
	async getPullRequestReviewComments(pullNumber: number) {
		const { data } = await this.octokit.rest.pulls.listReviewComments({
			...this.repo,
			pull_number: pullNumber,
			per_page: 100,
		});
		return data;
	}

	/**
	 * Get file content from the repository
	 */
	async getFileContent(path: string, ref?: string) {
		const { data } = await this.octokit.rest.repos.getContent({
			...this.repo,
			path,
			ref,
		});
		return data;
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
		const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
			...this.repo,
			path,
			message,
			content: Buffer.from(content).toString("base64"),
			branch,
			sha,
		});
		return data;
	}

	/**
	 * Get an issue by number
	 */
	async getIssue(issueNumber: number) {
		const { data } = await this.octokit.rest.issues.get({
			...this.repo,
			issue_number: issueNumber,
		});
		return data;
	}

	/**
	 * Create a new branch
	 */
	async createBranch(branchName: string, sha: string) {
		const { data } = await this.octokit.rest.git.createRef({
			...this.repo,
			ref: `refs/heads/${branchName}`,
			sha,
		});
		return data;
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
		const { data } = await this.octokit.rest.pulls.create({
			...this.repo,
			title,
			body,
			head,
			base,
		});
		return data;
	}

	/**
	 * Get the default branch of the repository
	 */
	async getDefaultBranch(): Promise<string> {
		const { data } = await this.octokit.rest.repos.get({
			...this.repo,
		});
		return data.default_branch;
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
