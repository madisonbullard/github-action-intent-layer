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

/** Represents a symlink relationship between an AGENTS.md and CLAUDE.md file at the same path */
export interface SymlinkRelationship {
	/** Directory path (empty string for root) */
	directory: string;
	/** The source file (the actual file with content) */
	source: IntentFile;
	/** The symlink file (points to source) */
	symlink: IntentFile;
	/** Which file type is the source: 'agents' or 'claude' */
	sourceType: IntentFileType;
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

/**
 * Get the directory of an intent file path.
 *
 * @param path - File path
 * @returns Directory path (empty string for root files)
 */
function getDirectory(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? "" : path.substring(0, lastSlash);
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
 * Check if a symlink target matches a file in the same directory.
 *
 * @param symlinkPath - Path of the symlink file
 * @param symlinkTarget - Target of the symlink (relative or absolute)
 * @param targetFilename - Expected filename of the target (e.g., "AGENTS.md" or "CLAUDE.md")
 * @returns True if the symlink points to the target file in the same directory
 */
function symlinkPointsToFile(
	symlinkPath: string,
	symlinkTarget: string,
	targetFilename: string,
): boolean {
	// Handle simple case: symlink target is just the filename
	if (symlinkTarget === targetFilename) {
		return true;
	}

	// Handle relative path: ./FILENAME
	if (symlinkTarget === `./${targetFilename}`) {
		return true;
	}

	// Handle case where symlink target includes directory path
	const symlinkDir = getDirectory(symlinkPath);
	const targetDir = getDirectory(symlinkTarget);
	const targetFile = getFilename(symlinkTarget);

	// If target filename matches and directories align
	if (targetFile === targetFilename) {
		// Same directory reference
		if (targetDir === "" || targetDir === ".") {
			return true;
		}
		// Full path matches
		if (
			symlinkDir === targetDir ||
			`${symlinkDir}/${targetFilename}` === symlinkTarget
		) {
			return true;
		}
	}

	return false;
}

/** Result of symlink configuration validation */
export interface SymlinkValidationResult {
	/** Whether validation passed */
	valid: boolean;
	/** Error message if validation failed */
	error?: string;
	/** Directories where conflicts were found */
	conflictDirectories?: string[];
}

/**
 * Validate symlink configuration against the actual repository state.
 *
 * When `symlink: true` is configured, this function checks that intent files
 * at the same directory level are properly symlinked. If both AGENTS.md and
 * CLAUDE.md exist in a directory but neither is a symlink to the other,
 * validation fails.
 *
 * @param result - Detection result from detectIntentLayer
 * @param symlinkEnabled - Whether symlink: true is configured
 * @returns Validation result with error details if failed
 */
export function validateSymlinkConfig(
	result: IntentLayerDetectionResult,
	symlinkEnabled: boolean,
): SymlinkValidationResult {
	// If symlink is disabled, validation always passes
	if (!symlinkEnabled) {
		return { valid: true };
	}

	// Build lookup maps by directory
	const agentsByDir = new Map<string, IntentFile>();
	const claudeByDir = new Map<string, IntentFile>();

	for (const file of result.agentsFiles) {
		agentsByDir.set(getDirectory(file.path), file);
	}

	for (const file of result.claudeFiles) {
		claudeByDir.set(getDirectory(file.path), file);
	}

	// Find all directories that have both files
	const conflictDirectories: string[] = [];

	for (const dir of agentsByDir.keys()) {
		const agentsFile = agentsByDir.get(dir);
		const claudeFile = claudeByDir.get(dir);

		// If only one exists, no conflict
		if (!agentsFile || !claudeFile) {
			continue;
		}

		// Both exist - check if at least one is a proper symlink to the other
		const agentsPointsToClaude =
			agentsFile.isSymlink &&
			agentsFile.symlinkTarget &&
			symlinkPointsToFile(
				agentsFile.path,
				agentsFile.symlinkTarget,
				"CLAUDE.md",
			);

		const claudePointsToAgents =
			claudeFile.isSymlink &&
			claudeFile.symlinkTarget &&
			symlinkPointsToFile(
				claudeFile.path,
				claudeFile.symlinkTarget,
				"AGENTS.md",
			);

		// If neither is a symlink to the other, this is a conflict
		if (!agentsPointsToClaude && !claudePointsToAgents) {
			conflictDirectories.push(dir || "(root)");
		}
	}

	if (conflictDirectories.length > 0) {
		const dirList = conflictDirectories.join(", ");
		return {
			valid: false,
			error: `Symlink configuration conflict: 'symlink: true' is set, but both AGENTS.md and CLAUDE.md exist as separate files (not symlinked) in: ${dirList}. Either remove one file, convert one to a symlink, or set 'symlink: false'.`,
			conflictDirectories,
		};
	}

	return { valid: true };
}

/**
 * Detect symlink relationships between AGENTS.md and CLAUDE.md files.
 *
 * Finds pairs of files at the same directory level where one is a symlink
 * pointing to the other. This helps identify the source of truth for each
 * intent layer location.
 *
 * @param result - Detection result from detectIntentLayer
 * @returns Array of symlink relationships found
 */
export function detectSymlinkRelationships(
	result: IntentLayerDetectionResult,
): SymlinkRelationship[] {
	const relationships: SymlinkRelationship[] = [];

	// Build lookup maps by directory
	const agentsByDir = new Map<string, IntentFile>();
	const claudeByDir = new Map<string, IntentFile>();

	for (const file of result.agentsFiles) {
		agentsByDir.set(getDirectory(file.path), file);
	}

	for (const file of result.claudeFiles) {
		claudeByDir.set(getDirectory(file.path), file);
	}

	// Check for relationships in each directory that has both files
	const allDirs = new Set([...agentsByDir.keys(), ...claudeByDir.keys()]);

	for (const dir of allDirs) {
		const agentsFile = agentsByDir.get(dir);
		const claudeFile = claudeByDir.get(dir);

		// Both files must exist in the same directory
		if (!agentsFile || !claudeFile) {
			continue;
		}

		// Check if AGENTS.md is a symlink pointing to CLAUDE.md
		if (
			agentsFile.isSymlink &&
			agentsFile.symlinkTarget &&
			symlinkPointsToFile(
				agentsFile.path,
				agentsFile.symlinkTarget,
				CLAUDE_FILENAME,
			)
		) {
			relationships.push({
				directory: dir,
				source: claudeFile,
				symlink: agentsFile,
				sourceType: "claude",
			});
			continue;
		}

		// Check if CLAUDE.md is a symlink pointing to AGENTS.md
		if (
			claudeFile.isSymlink &&
			claudeFile.symlinkTarget &&
			symlinkPointsToFile(
				claudeFile.path,
				claudeFile.symlinkTarget,
				AGENTS_FILENAME,
			)
		) {
			relationships.push({
				directory: dir,
				source: agentsFile,
				symlink: claudeFile,
				sourceType: "agents",
			});
		}
	}

	// Sort by directory for consistent ordering
	relationships.sort((a, b) => {
		// Root directory (empty string) first
		if (a.directory === "" && b.directory !== "") return -1;
		if (a.directory !== "" && b.directory === "") return 1;
		return a.directory.localeCompare(b.directory);
	});

	return relationships;
}
