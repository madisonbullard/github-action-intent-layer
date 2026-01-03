/**
 * LLM Prompts for Intent Layer Analysis
 *
 * This module contains prompt templates and builders for generating prompts
 * that elicit valid structured JSON output from LLMs during intent layer analysis.
 * The prompts guide the LLM to analyze code changes and propose updates to
 * AGENTS.md / CLAUDE.md files in the repository.
 */

import type {
	LinkedIssue,
	PRChangedFile,
	PRCommit,
	PRMetadata,
	PRReviewComment,
} from "../github/context";
import type {
	NodeUpdateCandidate,
	ParentNodeReviewCandidate,
	SemanticBoundaryCandidate,
} from "../intent/analyzer";
import type { IntentNode } from "../intent/hierarchy";

/**
 * The JSON output schema description that is included in prompts
 * to ensure the LLM produces valid, parseable output.
 */
export const OUTPUT_SCHEMA_DESCRIPTION = `You MUST respond with ONLY a valid JSON object matching this exact schema:

{
  "updates": [
    {
      "nodePath": "path/to/AGENTS.md",
      "otherNodePath": "path/to/CLAUDE.md",  // optional, only when managing both files
      "action": "create" | "update" | "delete",
      "reason": "Human-readable explanation of why this change is needed",
      "currentContent": "...",  // required for update/delete, omit for create
      "suggestedContent": "..."  // required for create/update, omit for delete
    }
  ]
}

CRITICAL RULES:
- Output ONLY the JSON object, no markdown code blocks, no explanatory text before or after
- "nodePath" must be a valid file path ending in AGENTS.md or CLAUDE.md
- "action" must be exactly one of: "create", "update", "delete"
- For "create": include "suggestedContent", do NOT include "currentContent"
- For "update": include BOTH "currentContent" (exact current file content) AND "suggestedContent"
- For "delete": include "currentContent", do NOT include "suggestedContent"
- If no updates are needed, return: {"updates": []}
- All string values must be properly JSON-escaped (especially newlines as \\n)
`;

/**
 * The role description for the intent layer analyst.
 */
export const ANALYST_ROLE = `You are an expert Intent Layer Analyst. Your job is to analyze code changes in a pull request and determine what updates (if any) should be made to the repository's intent layer files (AGENTS.md and/or CLAUDE.md).

Intent layer files provide AI agents with high-signal, compressed context about the codebase. They describe:
- What the code in this directory does
- Key patterns and conventions
- Important architectural decisions
- How to work with this part of the codebase

Your analysis should be conservative - only suggest updates when the changes genuinely warrant documentation updates. Don't suggest updates for minor refactoring, typo fixes, or changes that don't affect the documented behavior or patterns.`;

/**
 * Guidelines for writing good intent layer content.
 */
export const CONTENT_GUIDELINES = `When writing intent layer content:
- Be concise but informative
- Focus on the "why" not just the "what"
- Document patterns, conventions, and important decisions
- Mention key dependencies and integrations
- Include guidance for AI agents working in this area
- Use markdown formatting appropriately
- Keep content proportional to the complexity of the covered code
- Avoid duplicating information from parent nodes
`;

/**
 * Configuration for prompt building.
 */
export interface PromptConfig {
	/** Which file type is being managed: 'agents', 'claude', or 'both' */
	fileType: "agents" | "claude" | "both";
	/** Whether new node creation is allowed */
	newNodesAllowed: boolean;
	/** Whether to suggest splitting large nodes */
	splitLargeNodes: boolean;
	/** Custom prompt patterns (pattern-matched prompts from user config) */
	customPrompts?: Map<string, string>;
}

/**
 * Context for the PR being analyzed.
 */
export interface PRContext {
	/** PR metadata */
	metadata: PRMetadata;
	/** Commits in the PR */
	commits: PRCommit[];
	/** Linked issues */
	linkedIssues: LinkedIssue[];
	/** Review comments */
	reviewComments: PRReviewComment[];
	/** Changed files with patches */
	changedFiles: PRChangedFile[];
}

/**
 * Context about existing intent nodes (with content fetched).
 */
export interface IntentContext {
	/** Nodes that need direct updates based on changed files (with current content) */
	nodesToUpdate: NodeUpdateCandidateWithContent[];
	/** Parent nodes that may need review (with current content) */
	parentNodesToReview: ParentNodeReviewCandidateWithContent[];
	/** Potential new semantic boundaries */
	potentialNewNodes: SemanticBoundaryCandidate[];
}

/**
 * Format PR metadata for inclusion in prompt.
 */
export function formatPRMetadata(metadata: PRMetadata): string {
	const lines: string[] = [
		`# Pull Request #${metadata.number}: ${metadata.title}`,
		"",
	];

	if (metadata.description) {
		lines.push("## Description");
		lines.push(metadata.description);
		lines.push("");
	}

	lines.push("## Summary");
	lines.push(`- Branch: ${metadata.headBranch} → ${metadata.baseBranch}`);
	lines.push(`- Files changed: ${metadata.changedFilesCount}`);
	lines.push(`- Lines: +${metadata.additions} / -${metadata.deletions}`);
	lines.push(`- Commits: ${metadata.commitsCount}`);

	if (metadata.labels.length > 0) {
		lines.push(`- Labels: ${metadata.labels.map((l) => l.name).join(", ")}`);
	}

	return lines.join("\n");
}

/**
 * Format commit messages for inclusion in prompt.
 */
export function formatCommits(commits: PRCommit[]): string {
	if (commits.length === 0) {
		return "No commits.";
	}

	const lines: string[] = ["## Commits"];

	for (const commit of commits) {
		// Truncate long commit messages
		const message =
			commit.message.length > 200
				? `${commit.message.substring(0, 200)}...`
				: commit.message;
		lines.push(`- ${commit.sha.substring(0, 7)}: ${message.split("\n")[0]}`);
	}

	return lines.join("\n");
}

/**
 * Format linked issues for inclusion in prompt.
 */
export function formatLinkedIssues(issues: LinkedIssue[]): string {
	if (issues.length === 0) {
		return "";
	}

	const lines: string[] = ["## Linked Issues"];

	for (const issue of issues) {
		const repoRef =
			issue.owner && issue.repo ? `${issue.owner}/${issue.repo}` : "";
		lines.push(`- ${issue.keyword} ${repoRef}#${issue.number}`);
	}

	return lines.join("\n");
}

/**
 * Format changed files with patches for inclusion in prompt.
 * Includes truncation for very large diffs.
 */
export function formatChangedFiles(
	files: PRChangedFile[],
	maxPatchLines = 100,
): string {
	const lines: string[] = ["## Changed Files"];

	for (const file of files) {
		lines.push("");
		lines.push(`### ${file.filename} (${file.status})`);
		lines.push(`+${file.additions} / -${file.deletions}`);

		if (file.previousFilename) {
			lines.push(`Renamed from: ${file.previousFilename}`);
		}

		if (file.patch) {
			const patchLines = file.patch.split("\n");
			if (patchLines.length > maxPatchLines) {
				lines.push("```diff");
				lines.push(patchLines.slice(0, maxPatchLines).join("\n"));
				lines.push(
					`... (${patchLines.length - maxPatchLines} more lines truncated)`,
				);
				lines.push("```");
			} else {
				lines.push("```diff");
				lines.push(file.patch);
				lines.push("```");
			}
		} else {
			lines.push("(patch not available - binary or large file)");
		}
	}

	return lines.join("\n");
}

/**
 * Extended node update candidate with file content.
 * Content must be fetched separately and provided here.
 */
export interface NodeUpdateCandidateWithContent extends NodeUpdateCandidate {
	/** Current content of the intent file */
	currentContent: string;
}

/**
 * Extended parent node review candidate with file content.
 * Content must be fetched separately and provided here.
 */
export interface ParentNodeReviewCandidateWithContent
	extends ParentNodeReviewCandidate {
	/** Current content of the intent file */
	currentContent: string;
}

/**
 * Extended intent node with file content.
 * Content must be fetched separately and provided here.
 */
export interface IntentNodeWithContent {
	/** The intent node */
	node: IntentNode;
	/** Current content of the intent file */
	currentContent: string;
}

/**
 * Format a node update candidate for inclusion in prompt.
 */
export function formatNodeUpdateCandidate(
	candidate: NodeUpdateCandidateWithContent,
): string {
	const lines: string[] = [
		`### ${candidate.node.file.path}`,
		"",
		`**Update Reason:** ${candidate.updateReason}`,
		"",
		"**Current Content:**",
		"```markdown",
		candidate.currentContent || "(empty file)",
		"```",
		"",
		`**Affected Files (${candidate.changedFiles.length}):**`,
	];

	for (const cf of candidate.changedFiles.slice(0, 10)) {
		lines.push(`- ${cf.file.filename} (${cf.file.status})`);
	}

	if (candidate.changedFiles.length > 10) {
		lines.push(`- ... and ${candidate.changedFiles.length - 10} more files`);
	}

	return lines.join("\n");
}

/**
 * Format parent node review candidates for inclusion in prompt.
 */
export function formatParentNodeCandidates(
	candidates: ParentNodeReviewCandidateWithContent[],
): string {
	if (candidates.length === 0) {
		return "";
	}

	const lines: string[] = [
		"## Parent Nodes (Review for Potential Updates)",
		"",
		"The following parent nodes have children being updated. By default, parent nodes should NOT be updated unless there are clear cross-cutting changes. Review conservatively.",
		"",
	];

	for (const candidate of candidates) {
		lines.push(`### ${candidate.node.file.path}`);
		lines.push("");
		lines.push(
			`**Recommendation:** ${candidate.recommendUpdate ? "Consider updating" : "No update needed"}`,
		);
		lines.push(`**Reason:** ${candidate.recommendationReason}`);
		lines.push(
			`**Updated children:** ${candidate.updatedChildren.map((c) => c.node.file.path).join(", ")}`,
		);
		lines.push("");
		lines.push("**Current Content:**");
		lines.push("```markdown");
		lines.push(candidate.currentContent || "(empty file)");
		lines.push("```");
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format semantic boundary candidates for inclusion in prompt.
 */
export function formatSemanticBoundaryCandidates(
	candidates: SemanticBoundaryCandidate[],
	newNodesAllowed: boolean,
): string {
	if (!newNodesAllowed || candidates.length === 0) {
		return "";
	}

	const lines: string[] = [
		"## Potential New Intent Nodes",
		"",
		"The following directories contain uncovered changed files and may benefit from their own intent node. Only suggest creating a new node if the directory represents a clear semantic boundary.",
		"",
	];

	for (const candidate of candidates) {
		lines.push(`### ${candidate.suggestedNodePath}`);
		lines.push("");
		lines.push(`**Directory:** ${candidate.directory || "(root)"}`);
		lines.push(`**Confidence:** ${(candidate.confidence * 100).toFixed(0)}%`);
		lines.push(`**Reason:** ${candidate.reason}`);
		lines.push("");
		lines.push(`**Uncovered Files (${candidate.uncoveredFiles.length}):**`);
		for (const cf of candidate.uncoveredFiles.slice(0, 5)) {
			lines.push(`- ${cf.file.filename}`);
		}
		if (candidate.uncoveredFiles.length > 5) {
			lines.push(`- ... and ${candidate.uncoveredFiles.length - 5} more files`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Build the complete analysis prompt.
 *
 * @param prContext - Context about the pull request
 * @param intentContext - Context about existing intent nodes
 * @param config - Prompt configuration
 * @returns Complete prompt string for LLM analysis
 */
export function buildAnalysisPrompt(
	prContext: PRContext,
	intentContext: IntentContext,
	config: PromptConfig,
): string {
	const sections: string[] = [];

	// Role and schema
	sections.push(ANALYST_ROLE);
	sections.push("");
	sections.push(OUTPUT_SCHEMA_DESCRIPTION);
	sections.push("");
	sections.push(CONTENT_GUIDELINES);
	sections.push("");

	// Configuration context
	const fileTypeDesc =
		config.fileType === "both"
			? "AGENTS.md and CLAUDE.md files"
			: `${config.fileType === "agents" ? "AGENTS.md" : "CLAUDE.md"} files`;

	sections.push("## Configuration");
	sections.push(`- Managing: ${fileTypeDesc}`);
	sections.push(
		`- New node creation: ${config.newNodesAllowed ? "allowed" : "NOT allowed"}`,
	);
	sections.push(
		`- Suggest node splits: ${config.splitLargeNodes ? "yes" : "no"}`,
	);
	sections.push("");

	// PR context
	sections.push(formatPRMetadata(prContext.metadata));
	sections.push("");
	sections.push(formatCommits(prContext.commits));
	sections.push("");

	if (prContext.linkedIssues.length > 0) {
		sections.push(formatLinkedIssues(prContext.linkedIssues));
		sections.push("");
	}

	// Changed files
	sections.push(formatChangedFiles(prContext.changedFiles));
	sections.push("");

	// Intent nodes to update
	if (intentContext.nodesToUpdate.length > 0) {
		sections.push("## Intent Nodes Requiring Update");
		sections.push("");
		sections.push(
			"The following intent nodes cover changed files and should be reviewed for updates:",
		);
		sections.push("");

		for (const candidate of intentContext.nodesToUpdate) {
			sections.push(formatNodeUpdateCandidate(candidate));
			sections.push("");
		}
	} else {
		sections.push("## Intent Nodes");
		sections.push("");
		sections.push(
			"No existing intent nodes directly cover the changed files. Consider whether new nodes are needed (if allowed).",
		);
		sections.push("");
	}

	// Parent nodes
	sections.push(formatParentNodeCandidates(intentContext.parentNodesToReview));

	// Potential new nodes
	sections.push(
		formatSemanticBoundaryCandidates(
			intentContext.potentialNewNodes,
			config.newNodesAllowed,
		),
	);

	// Final instructions
	sections.push("## Your Task");
	sections.push("");
	sections.push(
		"Analyze the changes above and determine what updates (if any) should be made to the intent layer files.",
	);
	sections.push("");
	sections.push("Remember:");
	sections.push("- Be conservative - only update when genuinely needed");
	sections.push(
		"- Focus on the nearest covering node; parent nodes rarely need updates",
	);
	sections.push(
		"- For updates, you MUST include the exact current content in currentContent",
	);
	sections.push("- Write concise, high-signal documentation");
	if (!config.newNodesAllowed) {
		sections.push("- New node creation is NOT allowed for this repository");
	}
	sections.push("");
	sections.push("Respond with ONLY the JSON object. No other text.");

	return sections.join("\n");
}

/**
 * Build a prompt for updating a single node.
 * This is a simpler prompt for targeted single-node updates.
 *
 * @param nodeWithContent - The intent node with its current content
 * @param changedFiles - Files that changed in this node's coverage area
 * @param updateReason - Why this node needs updating
 * @param prMetadata - PR metadata for context
 * @param fileType - Which file type is being managed
 * @returns Prompt string for single-node update
 */
export function buildSingleNodeUpdatePrompt(
	nodeWithContent: IntentNodeWithContent,
	changedFiles: PRChangedFile[],
	updateReason: string,
	prMetadata: PRMetadata,
	fileType: "agents" | "claude",
): string {
	const sections: string[] = [];
	const { node, currentContent } = nodeWithContent;

	sections.push(ANALYST_ROLE);
	sections.push("");
	sections.push(OUTPUT_SCHEMA_DESCRIPTION);
	sections.push("");
	sections.push(CONTENT_GUIDELINES);
	sections.push("");

	sections.push("## Task: Update Single Intent Node");
	sections.push("");
	sections.push(
		`Update the ${node.file.path} file based on the following changes.`,
	);
	sections.push("");
	sections.push(`**Update Reason:** ${updateReason}`);
	sections.push("");

	// PR context (brief)
	sections.push(`## PR: ${prMetadata.title}`);
	sections.push(prMetadata.description || "(no description)");
	sections.push("");

	// Current content
	sections.push("## Current Content");
	sections.push("```markdown");
	sections.push(currentContent || "(empty file)");
	sections.push("```");
	sections.push("");

	// Changed files
	sections.push(`## Changed Files (${changedFiles.length})`);
	for (const file of changedFiles.slice(0, 20)) {
		sections.push(
			`- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`,
		);
	}
	if (changedFiles.length > 20) {
		sections.push(`- ... and ${changedFiles.length - 20} more files`);
	}
	sections.push("");

	// File patches (truncated)
	sections.push("## File Patches");
	for (const file of changedFiles.slice(0, 5)) {
		if (file.patch) {
			sections.push(`### ${file.filename}`);
			const patchLines = file.patch.split("\n");
			if (patchLines.length > 50) {
				sections.push("```diff");
				sections.push(patchLines.slice(0, 50).join("\n"));
				sections.push("... (truncated)");
				sections.push("```");
			} else {
				sections.push("```diff");
				sections.push(file.patch);
				sections.push("```");
			}
		}
	}
	sections.push("");

	sections.push("Respond with ONLY the JSON object. No other text.");

	return sections.join("\n");
}

/**
 * Build a prompt for creating a new intent node.
 *
 * @param candidate - The semantic boundary candidate
 * @param prMetadata - PR metadata for context
 * @param fileType - Which file type to create
 * @returns Prompt string for new node creation
 */
export function buildNewNodePrompt(
	candidate: SemanticBoundaryCandidate,
	prMetadata: PRMetadata,
	fileType: "agents" | "claude",
): string {
	const sections: string[] = [];

	sections.push(ANALYST_ROLE);
	sections.push("");
	sections.push(OUTPUT_SCHEMA_DESCRIPTION);
	sections.push("");
	sections.push(CONTENT_GUIDELINES);
	sections.push("");

	sections.push("## Task: Create New Intent Node");
	sections.push("");
	sections.push(
		`Create a new ${candidate.suggestedNodePath} file for the "${candidate.directory || "root"}" directory.`,
	);
	sections.push("");
	sections.push(`**Reason:** ${candidate.reason}`);
	sections.push("");

	// PR context (brief)
	sections.push(`## PR: ${prMetadata.title}`);
	sections.push(prMetadata.description || "(no description)");
	sections.push("");

	// Files that will be covered
	sections.push(
		`## Files in This Directory (${candidate.uncoveredFiles.length})`,
	);
	for (const cf of candidate.uncoveredFiles) {
		sections.push(`- ${cf.file.filename} (${cf.file.status})`);
	}
	sections.push("");

	// File patches
	sections.push("## File Patches");
	for (const cf of candidate.uncoveredFiles.slice(0, 5)) {
		if (cf.file.patch) {
			sections.push(`### ${cf.file.filename}`);
			const patchLines = cf.file.patch.split("\n");
			if (patchLines.length > 50) {
				sections.push("```diff");
				sections.push(patchLines.slice(0, 50).join("\n"));
				sections.push("... (truncated)");
				sections.push("```");
			} else {
				sections.push("```diff");
				sections.push(cf.file.patch);
				sections.push("```");
			}
		}
	}
	sections.push("");

	sections.push(
		"Create content that documents what this directory contains and how AI agents should work with it.",
	);
	sections.push("");
	sections.push("Respond with ONLY the JSON object. No other text.");

	return sections.join("\n");
}

/**
 * Build a prompt for suggesting intent layer initialization.
 * Used when no intent layer exists in the repository.
 *
 * @param prMetadata - PR metadata for context
 * @param changedFiles - Files changed in the PR
 * @param fileType - Which file type to initialize
 * @returns Prompt string for initialization
 */
export function buildInitializationPrompt(
	prMetadata: PRMetadata,
	changedFiles: PRChangedFile[],
	fileType: "agents" | "claude",
): string {
	const sections: string[] = [];
	const fileName = fileType === "agents" ? "AGENTS.md" : "CLAUDE.md";

	sections.push(ANALYST_ROLE);
	sections.push("");
	sections.push(OUTPUT_SCHEMA_DESCRIPTION);
	sections.push("");
	sections.push(CONTENT_GUIDELINES);
	sections.push("");

	sections.push("## Task: Initialize Intent Layer");
	sections.push("");
	sections.push(
		`This repository does not have an intent layer yet. Create a root ${fileName} file that provides high-level context about the repository.`,
	);
	sections.push("");
	sections.push("For initial creation, focus on:");
	sections.push("- What the repository/project is about");
	sections.push("- Key technologies and patterns used");
	sections.push("- How the codebase is organized");
	sections.push("- Important conventions for AI agents to follow");
	sections.push("");

	// PR context
	sections.push(`## Current PR: ${prMetadata.title}`);
	sections.push(prMetadata.description || "(no description)");
	sections.push("");

	// Changed files (to understand repo structure)
	sections.push(`## Changed Files (${changedFiles.length})`);
	for (const file of changedFiles.slice(0, 30)) {
		sections.push(`- ${file.filename}`);
	}
	if (changedFiles.length > 30) {
		sections.push(`- ... and ${changedFiles.length - 30} more files`);
	}
	sections.push("");

	sections.push("Respond with ONLY the JSON object. No other text.");

	return sections.join("\n");
}
