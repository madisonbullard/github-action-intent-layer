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
