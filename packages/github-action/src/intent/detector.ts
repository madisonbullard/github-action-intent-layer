/**
 * Intent Layer Detection
 *
 * Detects existing AGENTS.md and CLAUDE.md files in a repository
 * to build a map of the current intent layer structure.
 */

import type { GitHubClient } from "../github/client";

/** Intent file types */
export type IntentFileType = "agents" | "claude";

/** Information about a detected intent file */
export interface IntentFile {
	/** File path relative to repository root */
	path: string;
	/** Type of intent file (agents or claude) */
	type: IntentFileType;
	/** Git SHA of the file */
	sha: string;
	/** Whether this file is a symlink */
	isSymlink: boolean;
	/** If symlink, the target path */
	symlinkTarget?: string;
}

/** Result of intent layer detection */
export interface IntentLayerDetectionResult {
	/** All detected AGENTS.md files */
	agentsFiles: IntentFile[];
	/** All detected CLAUDE.md files */
	claudeFiles: IntentFile[];
}

/** File names for intent layer files */
const AGENTS_FILENAME = "AGENTS.md";
const CLAUDE_FILENAME = "CLAUDE.md";

/**
 * Detect all AGENTS.md files in the repository.
 *
 * Uses the GitHub Git Trees API to recursively search for AGENTS.md files
 * at all levels of the repository.
 *
 * @param client - GitHub API client
 * @param ref - Git ref (branch, tag, or commit SHA) to search. Defaults to default branch.
 * @returns Array of detected AGENTS.md intent files
 */
export async function detectAgentsFiles(
	client: GitHubClient,
	ref?: string,
): Promise<IntentFile[]> {
	return detectIntentFiles(client, AGENTS_FILENAME, "agents", ref);
}

/**
 * Detect all CLAUDE.md files in the repository.
 *
 * Uses the GitHub Git Trees API to recursively search for CLAUDE.md files
 * at all levels of the repository.
 *
 * @param client - GitHub API client
 * @param ref - Git ref (branch, tag, or commit SHA) to search. Defaults to default branch.
 * @returns Array of detected CLAUDE.md intent files
 */
export async function detectClaudeFiles(
	client: GitHubClient,
	ref?: string,
): Promise<IntentFile[]> {
	return detectIntentFiles(client, CLAUDE_FILENAME, "claude", ref);
}

/**
 * Detect all intent layer files (both AGENTS.md and CLAUDE.md) in the repository.
 *
 * @param client - GitHub API client
 * @param ref - Git ref (branch, tag, or commit SHA) to search. Defaults to default branch.
 * @returns Detection result containing both agents and claude files
 */
export async function detectIntentLayer(
	client: GitHubClient,
	ref?: string,
): Promise<IntentLayerDetectionResult> {
	// Fetch both in parallel for efficiency
	const [agentsFiles, claudeFiles] = await Promise.all([
		detectAgentsFiles(client, ref),
		detectClaudeFiles(client, ref),
	]);

	return {
		agentsFiles,
		claudeFiles,
	};
}

/**
 * Internal helper to detect intent files of a specific type.
 *
 * @param client - GitHub API client
 * @param filename - File name to search for (e.g., "AGENTS.md")
 * @param type - Intent file type
 * @param ref - Git ref to search
 * @returns Array of detected intent files
 */
async function detectIntentFiles(
	client: GitHubClient,
	filename: string,
	type: IntentFileType,
	ref?: string,
): Promise<IntentFile[]> {
	const targetRef = ref ?? (await client.getDefaultBranch());
	const { owner, repo } = client.repo;

	// Get the tree SHA for the ref
	const { data: refData } = await client.raw.rest.git.getRef({
		owner,
		repo,
		ref: `heads/${targetRef}`,
	});

	const commitSha = refData.object.sha;

	// Get the commit to find the tree SHA
	const { data: commitData } = await client.raw.rest.git.getCommit({
		owner,
		repo,
		commit_sha: commitSha,
	});

	const treeSha = commitData.tree.sha;

	// Get the full tree recursively
	const { data: treeData } = await client.raw.rest.git.getTree({
		owner,
		repo,
		tree_sha: treeSha,
		recursive: "true",
	});

	// Filter for matching files
	const matchingFiles = treeData.tree.filter(
		(item) =>
			item.type === "blob" &&
			item.path !== undefined &&
			(item.path === filename || item.path.endsWith(`/${filename}`)),
	);

	// Convert to IntentFile objects
	const intentFiles: IntentFile[] = [];

	for (const file of matchingFiles) {
		if (!file.path || !file.sha) continue;

		// Check if it's a symlink by looking at the mode
		// Git mode 120000 indicates a symbolic link
		const isSymlink = file.mode === "120000";
		let symlinkTarget: string | undefined;

		if (isSymlink) {
			// For symlinks, we need to fetch the blob content to get the target
			try {
				const { data: blobData } = await client.raw.rest.git.getBlob({
					owner,
					repo,
					file_sha: file.sha,
				});

				// Blob content is base64 encoded
				symlinkTarget = Buffer.from(blobData.content, "base64").toString(
					"utf-8",
				);
			} catch {
				// If we can't read the symlink target, just mark it as unknown
				symlinkTarget = undefined;
			}
		}

		intentFiles.push({
			path: file.path,
			type,
			sha: file.sha,
			isSymlink,
			symlinkTarget,
		});
	}

	// Sort by path depth (root first) then alphabetically
	intentFiles.sort((a, b) => {
		const depthA = a.path.split("/").length;
		const depthB = b.path.split("/").length;
		if (depthA !== depthB) return depthA - depthB;
		return a.path.localeCompare(b.path);
	});

	return intentFiles;
}

/**
 * Check if an intent layer exists in the repository.
 *
 * @param result - Detection result from detectIntentLayer
 * @returns True if at least one AGENTS.md or CLAUDE.md file exists
 */
export function hasIntentLayer(result: IntentLayerDetectionResult): boolean {
	return result.agentsFiles.length > 0 || result.claudeFiles.length > 0;
}

/**
 * Get the root intent file (the one at the repository root level).
 *
 * @param files - Array of intent files
 * @returns The root intent file, or undefined if none exists at root
 */
export function getRootIntentFile(files: IntentFile[]): IntentFile | undefined {
	return files.find((f) => !f.path.includes("/"));
}
