/**
 * PR context extraction utilities for the intent-layer action.
 * Extracts metadata, commits, issues, and diff information from pull requests.
 */

import type { GitHubClient } from "./client";

/**
 * Represents a label on a PR or issue
 */
export interface PRLabel {
	/** Label name */
	name: string;
	/** Label color (hex without #) */
	color: string;
	/** Label description */
	description: string | null;
}

/**
 * Represents the author of a PR
 */
export interface PRAuthor {
	/** GitHub username */
	login: string;
	/** User ID */
	id: number;
	/** Avatar URL */
	avatarUrl: string;
	/** Whether this is a bot account */
	isBot: boolean;
}

/**
 * PR metadata extracted from GitHub API
 */
export interface PRMetadata {
	/** PR number */
	number: number;
	/** PR title */
	title: string;
	/** PR description/body (may be null if not provided) */
	description: string | null;
	/** Labels attached to the PR */
	labels: PRLabel[];
	/** PR author information */
	author: PRAuthor;
	/** PR state (open, closed) */
	state: "open" | "closed";
	/** Whether the PR is a draft */
	isDraft: boolean;
	/** Whether the PR has been merged */
	merged: boolean;
	/** Base branch name (target branch) */
	baseBranch: string;
	/** Head branch name (source branch) */
	headBranch: string;
	/** Head SHA (latest commit) */
	headSha: string;
	/** Base SHA (merge base) */
	baseSha: string;
	/** PR creation timestamp (ISO 8601) */
	createdAt: string;
	/** PR last update timestamp (ISO 8601) */
	updatedAt: string;
	/** Number of commits in the PR */
	commitsCount: number;
	/** Number of files changed */
	changedFilesCount: number;
	/** Total additions */
	additions: number;
	/** Total deletions */
	deletions: number;
	/** PR URL */
	url: string;
}

/**
 * Extract PR metadata from GitHub API response
 *
 * @param client - GitHub API client
 * @param pullNumber - PR number to fetch
 * @returns PR metadata object
 */
export async function extractPRMetadata(
	client: GitHubClient,
	pullNumber: number,
): Promise<PRMetadata> {
	const pr = await client.getPullRequest(pullNumber);

	return {
		number: pr.number,
		title: pr.title,
		description: pr.body,
		labels: pr.labels.map((label) => {
			// Handle both string and object label formats
			if (typeof label === "string") {
				return {
					name: label,
					color: "",
					description: null,
				};
			}
			return {
				name: label.name ?? "",
				color: label.color ?? "",
				description: label.description ?? null,
			};
		}),
		author: {
			login: pr.user?.login ?? "unknown",
			id: pr.user?.id ?? 0,
			avatarUrl: pr.user?.avatar_url ?? "",
			isBot: pr.user?.type === "Bot",
		},
		state: pr.state as "open" | "closed",
		isDraft: pr.draft ?? false,
		merged: pr.merged ?? false,
		baseBranch: pr.base.ref,
		headBranch: pr.head.ref,
		headSha: pr.head.sha,
		baseSha: pr.base.sha,
		url: pr.html_url,
		createdAt: pr.created_at,
		updatedAt: pr.updated_at,
		commitsCount: pr.commits,
		changedFilesCount: pr.changed_files,
		additions: pr.additions,
		deletions: pr.deletions,
	};
}

/**
 * Extract PR metadata from the current context (for PR events)
 *
 * @param client - GitHub API client
 * @returns PR metadata or null if not in a PR context
 */
export async function extractPRMetadataFromContext(
	client: GitHubClient,
): Promise<PRMetadata | null> {
	const pullNumber = client.pullRequestNumber;
	if (!pullNumber) {
		return null;
	}
	return extractPRMetadata(client, pullNumber);
}

/**
 * Represents the author of a commit (git author info)
 */
export interface CommitAuthor {
	/** Author name from git */
	name: string;
	/** Author email from git */
	email: string;
	/** Commit timestamp (ISO 8601) */
	date: string;
}

/**
 * Represents a GitHub user associated with a commit
 */
export interface CommitUser {
	/** GitHub username */
	login: string;
	/** User ID */
	id: number;
	/** Avatar URL */
	avatarUrl: string;
	/** Whether this is a bot account */
	isBot: boolean;
}

/**
 * Represents a commit in a pull request
 */
export interface PRCommit {
	/** Commit SHA */
	sha: string;
	/** Commit message (full message including body) */
	message: string;
	/** Git author information */
	author: CommitAuthor;
	/** Git committer information */
	committer: CommitAuthor;
	/** GitHub user who authored the commit (may be null if not linked) */
	gitHubAuthor: CommitUser | null;
	/** GitHub user who committed (may be null if not linked) */
	gitHubCommitter: CommitUser | null;
	/** URL to view the commit on GitHub */
	url: string;
	/** Number of comments on the commit */
	commentCount: number;
	/** Parent commit SHAs */
	parentShas: string[];
}

/**
 * Extract all commits from a pull request
 *
 * @param client - GitHub API client
 * @param pullNumber - PR number to fetch commits for
 * @returns Array of commit objects with messages
 */
export async function extractPRCommits(
	client: GitHubClient,
	pullNumber: number,
): Promise<PRCommit[]> {
	const commits = await client.getPullRequestCommits(pullNumber);

	return commits.map((commit) => ({
		sha: commit.sha,
		message: commit.commit.message,
		author: {
			name: commit.commit.author?.name ?? "unknown",
			email: commit.commit.author?.email ?? "",
			date: commit.commit.author?.date ?? "",
		},
		committer: {
			name: commit.commit.committer?.name ?? "unknown",
			email: commit.commit.committer?.email ?? "",
			date: commit.commit.committer?.date ?? "",
		},
		gitHubAuthor: commit.author
			? {
					login: commit.author.login,
					id: commit.author.id,
					avatarUrl: commit.author.avatar_url,
					isBot: commit.author.type === "Bot",
				}
			: null,
		gitHubCommitter: commit.committer
			? {
					login: commit.committer.login,
					id: commit.committer.id,
					avatarUrl: commit.committer.avatar_url,
					isBot: commit.committer.type === "Bot",
				}
			: null,
		url: commit.html_url,
		commentCount: commit.commit.comment_count,
		parentShas: commit.parents.map((parent) => parent.sha),
	}));
}

/**
 * Extract commits from the current PR context
 *
 * @param client - GitHub API client
 * @returns Array of commits or null if not in a PR context
 */
export async function extractPRCommitsFromContext(
	client: GitHubClient,
): Promise<PRCommit[] | null> {
	const pullNumber = client.pullRequestNumber;
	if (!pullNumber) {
		return null;
	}
	return extractPRCommits(client, pullNumber);
}
