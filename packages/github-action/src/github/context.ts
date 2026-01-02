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

/**
 * Represents a linked issue reference parsed from PR/commit text
 */
export interface LinkedIssue {
	/** Issue number */
	number: number;
	/** Repository owner (null if same repo) */
	owner: string | null;
	/** Repository name (null if same repo) */
	repo: string | null;
	/** The keyword used to link (e.g., "fixes", "closes", "resolves") */
	keyword: string;
	/** The raw matched text */
	rawMatch: string;
}

/**
 * Keywords that link a PR to an issue for auto-closing
 * These are case-insensitive and may be followed by optional colons
 * Reference: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
 */
const LINKING_KEYWORDS = [
	"close",
	"closes",
	"closed",
	"fix",
	"fixes",
	"fixed",
	"resolve",
	"resolves",
	"resolved",
] as const;

/**
 * Regex pattern for parsing linked issues from text
 * Matches patterns like:
 * - "Fixes #123"
 * - "closes: #456"
 * - "RESOLVES owner/repo#789"
 * - "fix octo-org/octo-repo#100"
 */
const LINKED_ISSUE_PATTERN = new RegExp(
	`\\b(${LINKING_KEYWORDS.join("|")}):?\\s+(?:([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+))?#(\\d+)`,
	"gi",
);

/**
 * Parse linked issues from text content (PR description, commit messages, etc.)
 *
 * @param text - Text to parse for linked issue references
 * @returns Array of linked issue references found in the text
 */
export function parseLinkedIssues(text: string): LinkedIssue[] {
	if (!text) {
		return [];
	}

	const linkedIssues: LinkedIssue[] = [];

	// Use matchAll to avoid stateful regex iteration issues
	const matches = text.matchAll(LINKED_ISSUE_PATTERN);

	for (const match of matches) {
		const [rawMatch, keyword, owner, repo, issueNumber] = match;
		linkedIssues.push({
			number: Number.parseInt(issueNumber!, 10),
			owner: owner || null,
			repo: repo || null,
			keyword: keyword!.toLowerCase(),
			rawMatch: rawMatch!,
		});
	}

	return linkedIssues;
}

/**
 * Extract linked issues from a PR's description and commit messages
 *
 * @param client - GitHub API client
 * @param pullNumber - PR number to extract linked issues from
 * @returns Array of unique linked issues (deduplicated by issue number + repo)
 */
export async function extractLinkedIssues(
	client: GitHubClient,
	pullNumber: number,
): Promise<LinkedIssue[]> {
	// Fetch PR metadata and commits
	const [prMetadata, commits] = await Promise.all([
		extractPRMetadata(client, pullNumber),
		extractPRCommits(client, pullNumber),
	]);

	const allLinkedIssues: LinkedIssue[] = [];

	// Parse from PR description
	if (prMetadata.description) {
		allLinkedIssues.push(...parseLinkedIssues(prMetadata.description));
	}

	// Parse from commit messages
	for (const commit of commits) {
		allLinkedIssues.push(...parseLinkedIssues(commit.message));
	}

	// Deduplicate by issue number + owner + repo
	const seen = new Set<string>();
	const uniqueLinkedIssues: LinkedIssue[] = [];

	for (const issue of allLinkedIssues) {
		const key = `${issue.owner ?? ""}/${issue.repo ?? ""}#${issue.number}`;
		if (!seen.has(key)) {
			seen.add(key);
			uniqueLinkedIssues.push(issue);
		}
	}

	return uniqueLinkedIssues;
}

/**
 * Extract linked issues from the current PR context
 *
 * @param client - GitHub API client
 * @returns Array of linked issues or null if not in a PR context
 */
export async function extractLinkedIssuesFromContext(
	client: GitHubClient,
): Promise<LinkedIssue[] | null> {
	const pullNumber = client.pullRequestNumber;
	if (!pullNumber) {
		return null;
	}
	return extractLinkedIssues(client, pullNumber);
}

/**
 * Represents the author of a review comment
 */
export interface ReviewCommentAuthor {
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
 * Represents a review comment on a pull request
 * These are comments made on specific lines of code in the diff
 */
export interface PRReviewComment {
	/** Comment ID */
	id: number;
	/** ID of the review this comment belongs to (may be null for standalone comments) */
	pullRequestReviewId: number | null;
	/** Comment body/content */
	body: string;
	/** The diff hunk where the comment is located */
	diffHunk: string;
	/** Path to the file being commented on */
	path: string;
	/** Line number in the diff (may be null for outdated comments) */
	position: number | null;
	/** Original position in the diff */
	originalPosition: number | null;
	/** SHA of the commit the comment references */
	commitId: string;
	/** SHA of the original commit */
	originalCommitId: string;
	/** If this is a reply, the ID of the comment being replied to */
	inReplyToId: number | null;
	/** Author of the comment */
	author: ReviewCommentAuthor;
	/** How the author is associated with the repository */
	authorAssociation: string;
	/** URL to view the comment on GitHub */
	url: string;
	/** Creation timestamp (ISO 8601) */
	createdAt: string;
	/** Last update timestamp (ISO 8601) */
	updatedAt: string;
	/** Starting line of a multi-line comment (null for single-line) */
	startLine: number | null;
	/** Original starting line of a multi-line comment */
	originalStartLine: number | null;
	/** Side of the diff where the comment starts (LEFT or RIGHT) */
	startSide: "LEFT" | "RIGHT" | null;
	/** Line number where the comment ends */
	line: number | null;
	/** Original line number where the comment ends */
	originalLine: number | null;
	/** Side of the diff (LEFT for deletions, RIGHT for additions) */
	side: "LEFT" | "RIGHT" | null;
}

/**
 * Extract all review comments from a pull request
 * Review comments are comments made on specific lines of code in the diff,
 * distinct from regular issue comments on the PR.
 *
 * @param client - GitHub API client
 * @param pullNumber - PR number to fetch review comments for
 * @returns Array of review comment objects
 */
export async function extractPRReviewComments(
	client: GitHubClient,
	pullNumber: number,
): Promise<PRReviewComment[]> {
	const comments = await client.getPullRequestReviewComments(pullNumber);

	return comments.map((comment) => ({
		id: comment.id,
		pullRequestReviewId: comment.pull_request_review_id ?? null,
		body: comment.body,
		diffHunk: comment.diff_hunk,
		path: comment.path,
		position: comment.position ?? null,
		originalPosition: comment.original_position ?? null,
		commitId: comment.commit_id,
		originalCommitId: comment.original_commit_id,
		inReplyToId: comment.in_reply_to_id ?? null,
		author: {
			login: comment.user?.login ?? "unknown",
			id: comment.user?.id ?? 0,
			avatarUrl: comment.user?.avatar_url ?? "",
			isBot: comment.user?.type === "Bot",
		},
		authorAssociation: comment.author_association,
		url: comment.html_url,
		createdAt: comment.created_at,
		updatedAt: comment.updated_at,
		startLine: comment.start_line ?? null,
		originalStartLine: comment.original_start_line ?? null,
		startSide: (comment.start_side as "LEFT" | "RIGHT" | null) ?? null,
		line: comment.line ?? null,
		originalLine: comment.original_line ?? null,
		side: (comment.side as "LEFT" | "RIGHT" | null) ?? null,
	}));
}

/**
 * Extract review comments from the current PR context
 *
 * @param client - GitHub API client
 * @returns Array of review comments or null if not in a PR context
 */
export async function extractPRReviewCommentsFromContext(
	client: GitHubClient,
): Promise<PRReviewComment[] | null> {
	const pullNumber = client.pullRequestNumber;
	if (!pullNumber) {
		return null;
	}
	return extractPRReviewComments(client, pullNumber);
}
