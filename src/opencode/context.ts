/**
 * Context Payload Builder for Intent Layer Analysis
 *
 * This module builds the complete context payload that combines all information
 * needed for intent layer analysis:
 * - PR metadata (title, description, labels)
 * - Commits in the PR
 * - Linked issues
 * - Review comments
 * - Changed files with patches
 * - Existing intent nodes with their current content
 *
 * The context payload is used to generate prompts for the LLM analysis.
 */

import type { GitHubClient } from "../github/client";
import {
	extractLinkedIssues,
	extractPRCommits,
	extractPRDiff,
	extractPRMetadata,
	extractPRReviewComments,
} from "../github/context";
import {
	type ChangedFilesMappingResult,
	determineNodesNeedingUpdate,
	filterSemanticBoundariesForInitialization,
	identifySemanticBoundaries,
	mapChangedFilesToNodes,
	type NodesNeedingUpdateResult,
	type ParentNodesReviewResult,
	reviewParentNodes,
	type SemanticBoundaryResult,
} from "../intent/analyzer";
import type { IntentLayerDetectionResult } from "../intent/detector";
import { buildHierarchies, type IntentHierarchy } from "../intent/hierarchy";
import type { IntentLayerIgnore } from "../patterns/ignore";
import type {
	IntentContext,
	NodeUpdateCandidateWithContent,
	ParentNodeReviewCandidateWithContent,
	PRContext,
} from "./prompts";

// Re-export PRContext for convenience
export type { PRContext };

/**
 * Error thrown when context building fails.
 */
export class ContextBuildError extends Error {
	public readonly originalCause?: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "ContextBuildError";
		this.originalCause = cause;
	}
}

/**
 * Configuration for building the context payload.
 */
export interface ContextBuildConfig {
	/** Which file type to manage: 'agents', 'claude', or 'both' */
	fileType: "agents" | "claude" | "both";
	/** Whether new node creation is allowed */
	newNodesAllowed: boolean;
	/** Optional IntentLayerIgnore instance for filtering files */
	ignore?: IntentLayerIgnore;
}

/**
 * Complete context payload for intent layer analysis.
 * This is the master data structure containing everything needed for LLM analysis.
 */
export interface AnalysisContextPayload {
	/** PR context (metadata, commits, issues, comments, changed files) */
	prContext: PRContext;
	/** Intent context (nodes to update, parent nodes, potential new nodes) */
	intentContext: IntentContext;
	/** The intent hierarchy for agents files */
	agentsHierarchy: IntentHierarchy;
	/** The intent hierarchy for claude files */
	claudeHierarchy: IntentHierarchy;
	/** Result of mapping changed files to nodes */
	changedFilesMapping: ChangedFilesMappingResult;
	/** Result of determining which nodes need updates */
	nodesNeedingUpdate: NodesNeedingUpdateResult;
	/** Result of reviewing parent nodes */
	parentNodesReview: ParentNodesReviewResult;
	/** Result of identifying potential new semantic boundaries */
	semanticBoundaries: SemanticBoundaryResult;
	/** Summary statistics for the analysis */
	summary: ContextSummary;
}

/**
 * Summary statistics for the context payload.
 */
export interface ContextSummary {
	/** Total number of files changed in the PR */
	totalChangedFiles: number;
	/** Total lines added */
	totalAdditions: number;
	/** Total lines deleted */
	totalDeletions: number;
	/** Number of commits in the PR */
	commitsCount: number;
	/** Number of linked issues */
	linkedIssuesCount: number;
	/** Number of review comments */
	reviewCommentsCount: number;
	/** Number of existing intent nodes (agents) */
	existingAgentsNodesCount: number;
	/** Number of existing intent nodes (claude) */
	existingClaudeNodesCount: number;
	/** Number of nodes that need updates */
	nodesNeedingUpdateCount: number;
	/** Number of parent nodes to review */
	parentNodesToReviewCount: number;
	/** Number of potential new semantic boundaries */
	potentialNewNodesCount: number;
	/** Whether the intent layer exists */
	intentLayerExists: boolean;
	/** Whether this is an initialization scenario (no intent layer) */
	isInitialization: boolean;
}

/**
 * File content reader function type.
 * This abstracts the file reading mechanism to allow for different implementations
 * (e.g., GitHub API, local filesystem, etc.)
 */
export type FileContentReader = (filePath: string) => Promise<string>;

/**
 * Build the complete context payload for intent layer analysis.
 *
 * This function orchestrates the collection of all information needed for
 * intent layer analysis, including PR context, existing intent nodes with
 * their content, and analysis results.
 *
 * @param client - GitHub API client
 * @param pullNumber - PR number to analyze
 * @param detectionResult - Result of intent layer detection
 * @param readFileContent - Function to read file content
 * @param config - Context building configuration
 * @returns Complete analysis context payload
 * @throws {ContextBuildError} If context building fails
 */
export async function buildAnalysisContextPayload(
	client: GitHubClient,
	pullNumber: number,
	detectionResult: IntentLayerDetectionResult,
	readFileContent: FileContentReader,
	config: ContextBuildConfig,
): Promise<AnalysisContextPayload> {
	try {
		// Build PR context
		const prContext = await buildPRContext(client, pullNumber);

		// Build intent hierarchies
		const { agents: agentsHierarchy, claude: claudeHierarchy } =
			buildHierarchies(detectionResult);

		// Determine which hierarchy to use based on config
		const primaryHierarchy =
			config.fileType === "claude" ? claudeHierarchy : agentsHierarchy;
		const primaryFileType: "agents" | "claude" =
			config.fileType === "both" ? "agents" : config.fileType;

		// Map changed files to intent nodes
		const prDiff = await extractPRDiff(client, pullNumber);
		const changedFilesMapping = mapChangedFilesToNodes(
			prDiff,
			primaryHierarchy,
			config.ignore,
		);

		// Determine which nodes need updates
		const nodesNeedingUpdate = determineNodesNeedingUpdate(changedFilesMapping);

		// Review parent nodes
		const parentNodesReview = reviewParentNodes(nodesNeedingUpdate);

		// Identify potential new semantic boundaries
		let semanticBoundaries = identifySemanticBoundaries(
			changedFilesMapping,
			config.newNodesAllowed,
			primaryFileType,
		);

		// Check if this is an initialization scenario (no intent layer exists)
		const intentLayerExists =
			agentsHierarchy.nodesByPath.size > 0 ||
			claudeHierarchy.nodesByPath.size > 0;

		// For initialization, filter to only suggest root AGENTS.md/CLAUDE.md
		// Per PLAN.md: "When no intent layer exists: Only suggest creating root AGENTS.md"
		if (!intentLayerExists) {
			semanticBoundaries = filterSemanticBoundariesForInitialization(
				semanticBoundaries,
				primaryFileType,
			);
		}

		// Build intent context with file content
		const intentContext = await buildIntentContext(
			nodesNeedingUpdate,
			parentNodesReview,
			semanticBoundaries,
			readFileContent,
		);

		// Calculate summary
		const summary = calculateContextSummary(
			prContext,
			agentsHierarchy,
			claudeHierarchy,
			nodesNeedingUpdate,
			parentNodesReview,
			semanticBoundaries,
		);

		return {
			prContext,
			intentContext,
			agentsHierarchy,
			claudeHierarchy,
			changedFilesMapping,
			nodesNeedingUpdate,
			parentNodesReview,
			semanticBoundaries,
			summary,
		};
	} catch (error) {
		if (error instanceof ContextBuildError) {
			throw error;
		}
		throw new ContextBuildError(
			`Failed to build analysis context for PR #${pullNumber}`,
			error,
		);
	}
}

/**
 * Build the PR context from GitHub API.
 *
 * @param client - GitHub API client
 * @param pullNumber - PR number
 * @returns PR context with metadata, commits, issues, comments, and changed files
 */
export async function buildPRContext(
	client: GitHubClient,
	pullNumber: number,
): Promise<PRContext> {
	// Fetch all PR data in parallel for efficiency
	const [metadata, commits, linkedIssues, reviewComments, diff] =
		await Promise.all([
			extractPRMetadata(client, pullNumber),
			extractPRCommits(client, pullNumber),
			extractLinkedIssues(client, pullNumber),
			extractPRReviewComments(client, pullNumber),
			extractPRDiff(client, pullNumber),
		]);

	return {
		metadata,
		commits,
		linkedIssues,
		reviewComments,
		changedFiles: diff.files,
	};
}

/**
 * Build the intent context by fetching file content for nodes needing updates.
 *
 * @param nodesNeedingUpdate - Result of determining which nodes need updates
 * @param parentNodesReview - Result of reviewing parent nodes
 * @param semanticBoundaries - Result of identifying potential new nodes
 * @param readFileContent - Function to read file content
 * @returns Intent context with nodes and their content
 */
export async function buildIntentContext(
	nodesNeedingUpdate: NodesNeedingUpdateResult,
	parentNodesReview: ParentNodesReviewResult,
	semanticBoundaries: SemanticBoundaryResult,
	readFileContent: FileContentReader,
): Promise<IntentContext> {
	// Fetch content for nodes needing updates
	const nodesToUpdate = await Promise.all(
		nodesNeedingUpdate.candidates.map(async (candidate) => {
			const content = await safeReadFileContent(
				candidate.node.file.path,
				readFileContent,
			);
			return {
				...candidate,
				currentContent: content,
			} as NodeUpdateCandidateWithContent;
		}),
	);

	// Fetch content for parent nodes
	const parentNodesToReview = await Promise.all(
		parentNodesReview.candidates.map(async (candidate) => {
			const content = await safeReadFileContent(
				candidate.node.file.path,
				readFileContent,
			);
			return {
				...candidate,
				currentContent: content,
			} as ParentNodeReviewCandidateWithContent;
		}),
	);

	return {
		nodesToUpdate,
		parentNodesToReview,
		potentialNewNodes: semanticBoundaries.candidates,
	};
}

/**
 * Safely read file content, returning empty string on error.
 *
 * @param filePath - Path to the file
 * @param readFileContent - File content reader function
 * @returns File content or empty string
 */
async function safeReadFileContent(
	filePath: string,
	readFileContent: FileContentReader,
): Promise<string> {
	try {
		return await readFileContent(filePath);
	} catch {
		// File may not exist yet or may be inaccessible
		return "";
	}
}

/**
 * Calculate summary statistics for the context payload.
 */
function calculateContextSummary(
	prContext: PRContext,
	agentsHierarchy: IntentHierarchy,
	claudeHierarchy: IntentHierarchy,
	nodesNeedingUpdate: NodesNeedingUpdateResult,
	parentNodesReview: ParentNodesReviewResult,
	semanticBoundaries: SemanticBoundaryResult,
): ContextSummary {
	const totalAdditions = prContext.changedFiles.reduce(
		(sum, f) => sum + f.additions,
		0,
	);
	const totalDeletions = prContext.changedFiles.reduce(
		(sum, f) => sum + f.deletions,
		0,
	);

	const existingAgentsNodesCount = agentsHierarchy.nodesByPath.size;
	const existingClaudeNodesCount = claudeHierarchy.nodesByPath.size;
	const intentLayerExists =
		existingAgentsNodesCount > 0 || existingClaudeNodesCount > 0;

	return {
		totalChangedFiles: prContext.changedFiles.length,
		totalAdditions,
		totalDeletions,
		commitsCount: prContext.commits.length,
		linkedIssuesCount: prContext.linkedIssues.length,
		reviewCommentsCount: prContext.reviewComments.length,
		existingAgentsNodesCount,
		existingClaudeNodesCount,
		nodesNeedingUpdateCount: nodesNeedingUpdate.candidates.length,
		parentNodesToReviewCount: parentNodesReview.candidates.length,
		potentialNewNodesCount: semanticBoundaries.candidates.length,
		intentLayerExists,
		isInitialization: !intentLayerExists,
	};
}

/**
 * Build context payload from an existing PR context.
 * Useful when PR context has already been fetched.
 *
 * @param prContext - Pre-fetched PR context
 * @param detectionResult - Result of intent layer detection
 * @param readFileContent - Function to read file content
 * @param config - Context building configuration
 * @returns Complete analysis context payload
 */
export async function buildAnalysisContextPayloadFromPRContext(
	prContext: PRContext,
	detectionResult: IntentLayerDetectionResult,
	readFileContent: FileContentReader,
	config: ContextBuildConfig,
): Promise<AnalysisContextPayload> {
	// Build intent hierarchies
	const { agents: agentsHierarchy, claude: claudeHierarchy } =
		buildHierarchies(detectionResult);

	// Determine which hierarchy to use based on config
	const primaryHierarchy =
		config.fileType === "claude" ? claudeHierarchy : agentsHierarchy;
	const primaryFileType: "agents" | "claude" =
		config.fileType === "both" ? "agents" : config.fileType;

	// Create PRDiff from changedFiles
	const prDiff = {
		files: prContext.changedFiles,
		summary: {
			totalFiles: prContext.changedFiles.length,
			totalAdditions: prContext.changedFiles.reduce(
				(sum, f) => sum + f.additions,
				0,
			),
			totalDeletions: prContext.changedFiles.reduce(
				(sum, f) => sum + f.deletions,
				0,
			),
			filesAdded: prContext.changedFiles.filter((f) => f.status === "added")
				.length,
			filesRemoved: prContext.changedFiles.filter((f) => f.status === "removed")
				.length,
			filesModified: prContext.changedFiles.filter(
				(f) => f.status === "modified" || f.status === "changed",
			).length,
			filesRenamed: prContext.changedFiles.filter((f) => f.status === "renamed")
				.length,
		},
		rawDiff: null,
	};

	// Map changed files to intent nodes
	const changedFilesMapping = mapChangedFilesToNodes(
		prDiff,
		primaryHierarchy,
		config.ignore,
	);

	// Determine which nodes need updates
	const nodesNeedingUpdate = determineNodesNeedingUpdate(changedFilesMapping);

	// Review parent nodes
	const parentNodesReview = reviewParentNodes(nodesNeedingUpdate);

	// Identify potential new semantic boundaries
	let semanticBoundaries = identifySemanticBoundaries(
		changedFilesMapping,
		config.newNodesAllowed,
		primaryFileType,
	);

	// Check if this is an initialization scenario (no intent layer exists)
	const intentLayerExists =
		agentsHierarchy.nodesByPath.size > 0 ||
		claudeHierarchy.nodesByPath.size > 0;

	// For initialization, filter to only suggest root AGENTS.md/CLAUDE.md
	// Per PLAN.md: "When no intent layer exists: Only suggest creating root AGENTS.md"
	if (!intentLayerExists) {
		semanticBoundaries = filterSemanticBoundariesForInitialization(
			semanticBoundaries,
			primaryFileType,
		);
	}

	// Build intent context with file content
	const intentContext = await buildIntentContext(
		nodesNeedingUpdate,
		parentNodesReview,
		semanticBoundaries,
		readFileContent,
	);

	// Calculate summary
	const summary = calculateContextSummary(
		prContext,
		agentsHierarchy,
		claudeHierarchy,
		nodesNeedingUpdate,
		parentNodesReview,
		semanticBoundaries,
	);

	return {
		prContext,
		intentContext,
		agentsHierarchy,
		claudeHierarchy,
		changedFilesMapping,
		nodesNeedingUpdate,
		parentNodesReview,
		semanticBoundaries,
		summary,
	};
}

/**
 * Check if the context indicates this is an initialization scenario.
 *
 * @param context - Analysis context payload
 * @returns True if no intent layer exists and initialization is needed
 */
export function isInitializationScenario(
	context: AnalysisContextPayload,
): boolean {
	return context.summary.isInitialization;
}

/**
 * Check if there are any updates to propose.
 *
 * @param context - Analysis context payload
 * @returns True if there are nodes to update, parent nodes to review, or new nodes to create
 */
export function hasProposedUpdates(context: AnalysisContextPayload): boolean {
	return (
		context.intentContext.nodesToUpdate.length > 0 ||
		context.intentContext.parentNodesToReview.some((p) => p.recommendUpdate) ||
		context.intentContext.potentialNewNodes.length > 0
	);
}

/**
 * Get all intent nodes with their content from the context.
 * Useful for debugging or logging.
 *
 * @param context - Analysis context payload
 * @returns Array of node paths with their content status
 */
export function getNodeContentStatus(
	context: AnalysisContextPayload,
): Array<{ nodePath: string; hasContent: boolean; contentLength: number }> {
	const status: Array<{
		nodePath: string;
		hasContent: boolean;
		contentLength: number;
	}> = [];

	for (const candidate of context.intentContext.nodesToUpdate) {
		status.push({
			nodePath: candidate.node.file.path,
			hasContent: candidate.currentContent.length > 0,
			contentLength: candidate.currentContent.length,
		});
	}

	for (const candidate of context.intentContext.parentNodesToReview) {
		status.push({
			nodePath: candidate.node.file.path,
			hasContent: candidate.currentContent.length > 0,
			contentLength: candidate.currentContent.length,
		});
	}

	return status;
}
