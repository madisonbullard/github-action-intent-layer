/**
 * Token Budget & Counting
 *
 * Provides approximate token counting using a simple heuristic (chars / 4).
 * This is not model-specific and serves as a rough estimate for budget enforcement.
 */

/** Default character-to-token ratio */
const DEFAULT_CHARS_PER_TOKEN = 4;

/**
 * Count approximate tokens in a string.
 *
 * Uses a simple heuristic of dividing character count by 4, which provides
 * a reasonable approximation across most LLM tokenizers.
 *
 * @param content - The text content to count tokens for
 * @returns Approximate token count
 */
export function countTokens(content: string): number {
	if (!content) {
		return 0;
	}
	return Math.ceil(content.length / DEFAULT_CHARS_PER_TOKEN);
}

/**
 * Count approximate tokens across multiple strings.
 *
 * @param contents - Array of text contents to count tokens for
 * @returns Total approximate token count
 */
export function countTokensMultiple(contents: string[]): number {
	return contents.reduce((total, content) => total + countTokens(content), 0);
}

/**
 * Result of token budget calculation
 */
export interface TokenBudgetResult {
	/** Approximate token count of the intent node content */
	nodeTokens: number;
	/** Approximate token count of all covered code */
	coveredCodeTokens: number;
	/** Current budget usage as a percentage (0-100+) */
	budgetPercent: number;
	/** Whether the node exceeds the specified budget threshold */
	exceedsBudget: boolean;
}

/**
 * Calculate token budget usage for an intent node.
 *
 * Budget percentage is calculated as:
 *   (node_tokens / covered_code_tokens) * 100
 *
 * @param nodeContent - Content of the intent node (AGENTS.md or CLAUDE.md)
 * @param coveredCodeContents - Array of source file contents covered by this node
 * @param budgetThresholdPercent - Maximum allowed budget percentage (default 5%)
 * @returns Token budget calculation result
 */
export function calculateTokenBudget(
	nodeContent: string,
	coveredCodeContents: string[],
	budgetThresholdPercent = 5,
): TokenBudgetResult {
	const nodeTokens = countTokens(nodeContent);
	const coveredCodeTokens = countTokensMultiple(coveredCodeContents);

	// Avoid division by zero
	const budgetPercent =
		coveredCodeTokens > 0 ? (nodeTokens / coveredCodeTokens) * 100 : 0;

	return {
		nodeTokens,
		coveredCodeTokens,
		budgetPercent,
		exceedsBudget: budgetPercent > budgetThresholdPercent,
	};
}

/**
 * Check if content is likely a binary file.
 *
 * Uses a simple heuristic: if the content contains null bytes,
 * it's likely binary. This is not foolproof but catches most cases.
 *
 * @param content - File content to check
 * @returns True if content appears to be binary
 */
export function isBinaryContent(content: string): boolean {
	// Check for null bytes which are common in binary files
	return content.includes("\0");
}

/**
 * Count lines in content.
 *
 * @param content - Text content
 * @returns Number of lines
 */
export function countLines(content: string): number {
	if (!content) {
		return 0;
	}
	// Count newlines and add 1 for the last line (if content doesn't end with newline)
	const newlineCount = (content.match(/\n/g) || []).length;
	// If content is non-empty, there's at least 1 line
	// If content ends with newline, don't add extra line
	return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

/**
 * Options for filtering content for token counting
 */
export interface TokenCountOptions {
	/** Skip binary files (default true) */
	skipBinaryFiles?: boolean;
	/** Maximum lines before skipping file (default 8000) */
	fileMaxLines?: number;
}

/**
 * Result of counting tokens with potential skip
 */
export interface TokenCountResult {
	/** Approximate token count (0 if skipped) */
	tokens: number;
	/** Whether the file was skipped */
	skipped: boolean;
	/** Reason for skipping, if applicable */
	skipReason?: "binary" | "too_large";
}

/**
 * Count tokens with optional filtering for binary and large files.
 *
 * @param content - File content to count tokens for
 * @param options - Options for filtering
 * @returns Token count result with skip information
 */
export function countTokensWithOptions(
	content: string,
	options: TokenCountOptions = {},
): TokenCountResult {
	const { skipBinaryFiles = true, fileMaxLines = 8000 } = options;

	// Check for binary content
	if (skipBinaryFiles && isBinaryContent(content)) {
		return {
			tokens: 0,
			skipped: true,
			skipReason: "binary",
		};
	}

	// Check for large files
	if (fileMaxLines > 0 && countLines(content) > fileMaxLines) {
		return {
			tokens: 0,
			skipped: true,
			skipReason: "too_large",
		};
	}

	return {
		tokens: countTokens(content),
		skipped: false,
	};
}

/**
 * Result of calculating token count for covered code files
 */
export interface CoveredCodeTokenResult {
	/** Total tokens across all counted files */
	totalTokens: number;
	/** Number of files that were counted */
	filesCounted: number;
	/** Number of files that were skipped (binary or too large) */
	filesSkipped: number;
	/** Details for each file */
	fileDetails: Array<{
		/** File path */
		path: string;
		/** Token count (0 if skipped) */
		tokens: number;
		/** Whether the file was skipped */
		skipped: boolean;
		/** Reason for skipping, if applicable */
		skipReason?: "binary" | "too_large";
	}>;
}

/**
 * Calculate token count for covered code files.
 *
 * Takes a list of file paths and a map of file contents, counts tokens
 * for each file while respecting skip options for binary and large files.
 *
 * @param coveredFilePaths - Array of file paths covered by an intent node
 * @param fileContents - Map of file path to file content
 * @param options - Options for filtering binary/large files
 * @returns Aggregate token count result with per-file details
 */
export function calculateCoveredCodeTokens(
	coveredFilePaths: string[],
	fileContents: Map<string, string>,
	options: TokenCountOptions = {},
): CoveredCodeTokenResult {
	let totalTokens = 0;
	let filesCounted = 0;
	let filesSkipped = 0;
	const fileDetails: CoveredCodeTokenResult["fileDetails"] = [];

	for (const filePath of coveredFilePaths) {
		const content = fileContents.get(filePath);

		// If content not found, skip the file
		if (content === undefined) {
			continue;
		}

		const result = countTokensWithOptions(content, options);

		if (result.skipped) {
			filesSkipped++;
		} else {
			totalTokens += result.tokens;
			filesCounted++;
		}

		fileDetails.push({
			path: filePath,
			tokens: result.tokens,
			skipped: result.skipped,
			skipReason: result.skipReason,
		});
	}

	return {
		totalTokens,
		filesCounted,
		filesSkipped,
		fileDetails,
	};
}

/**
 * Result of calculating token budget usage for a single intent node.
 */
export interface NodeTokenBudgetResult {
	/** Path to the intent node file */
	nodePath: string;
	/** Approximate token count of the intent node content */
	nodeTokens: number;
	/** Approximate token count of all covered code */
	coveredCodeTokens: number;
	/** Current budget usage as a percentage (0-100+) */
	budgetPercent: number;
	/** Whether the node exceeds the specified budget threshold */
	exceedsBudget: boolean;
	/** Number of files counted in coverage calculation */
	filesCounted: number;
	/** Number of files skipped (binary or too large) */
	filesSkipped: number;
}

/**
 * Calculate token budget usage for a specific intent node.
 *
 * Combines the covered files result from hierarchy with file contents
 * to calculate complete token budget metrics for a node.
 *
 * @param nodePath - Path to the intent node file
 * @param nodeContent - Content of the intent node (AGENTS.md or CLAUDE.md)
 * @param coveredFilePaths - Array of file paths covered by this node
 * @param fileContents - Map of file path to file content
 * @param budgetThresholdPercent - Maximum allowed budget percentage (default 5%)
 * @param options - Options for filtering binary/large files
 * @returns Complete token budget calculation for the node
 */
export function calculateNodeTokenBudget(
	nodePath: string,
	nodeContent: string,
	coveredFilePaths: string[],
	fileContents: Map<string, string>,
	budgetThresholdPercent = 5,
	options: TokenCountOptions = {},
): NodeTokenBudgetResult {
	// Calculate covered code tokens with skip options
	const coveredResult = calculateCoveredCodeTokens(
		coveredFilePaths,
		fileContents,
		options,
	);

	// Calculate node tokens
	const nodeTokens = countTokens(nodeContent);

	// Calculate budget percentage
	const budgetPercent =
		coveredResult.totalTokens > 0
			? (nodeTokens / coveredResult.totalTokens) * 100
			: 0;

	return {
		nodePath,
		nodeTokens,
		coveredCodeTokens: coveredResult.totalTokens,
		budgetPercent,
		exceedsBudget: budgetPercent > budgetThresholdPercent,
		filesCounted: coveredResult.filesCounted,
		filesSkipped: coveredResult.filesSkipped,
	};
}

/**
 * Result of calculating token budget usage for all nodes in a hierarchy.
 */
export interface HierarchyTokenBudgetResult {
	/** Token budget results for each node, keyed by node path */
	nodeResults: Map<string, NodeTokenBudgetResult>;
	/** Nodes that exceed the budget threshold */
	nodesExceedingBudget: NodeTokenBudgetResult[];
	/** Total nodes analyzed */
	totalNodes: number;
	/** Count of nodes exceeding budget */
	exceedingCount: number;
}

/**
 * A suggested split for a node that exceeds the budget threshold.
 */
export interface SplitSuggestion {
	/** The directory path where a new intent node should be created */
	suggestedDirectory: string;
	/** Full path for the new intent file (e.g., "src/utils/AGENTS.md") */
	suggestedNodePath: string;
	/** Files that would be covered by the new node */
	coveredFiles: string[];
	/** Approximate token count of the files that would be covered */
	coveredTokens: number;
	/** Percentage of parent node's coverage this would absorb */
	coveragePercent: number;
}

/**
 * Result of analyzing a node for potential splits.
 */
export interface NodeSplitAnalysis {
	/** Path to the intent node being analyzed */
	nodePath: string;
	/** Whether the node exceeds budget and should be split */
	shouldSplit: boolean;
	/** Current budget percentage */
	budgetPercent: number;
	/** Suggested directories to create new intent nodes */
	suggestions: SplitSuggestion[];
}

/**
 * Calculate token budget usage for all nodes in a hierarchy.
 *
 * @param coveredFilesMap - Map of node path to covered files (from getCoveredFilesForHierarchy)
 * @param nodeContents - Map of node path to node content
 * @param fileContents - Map of all file paths to their contents
 * @param budgetThresholdPercent - Maximum allowed budget percentage (default 5%)
 * @param options - Options for filtering binary/large files
 * @returns Complete token budget analysis for all nodes
 */
export function calculateHierarchyTokenBudget(
	coveredFilesMap: Map<string, { coveredFiles: string[] }>,
	nodeContents: Map<string, string>,
	fileContents: Map<string, string>,
	budgetThresholdPercent = 5,
	options: TokenCountOptions = {},
): HierarchyTokenBudgetResult {
	const nodeResults = new Map<string, NodeTokenBudgetResult>();
	const nodesExceedingBudget: NodeTokenBudgetResult[] = [];

	for (const [nodePath, { coveredFiles }] of coveredFilesMap) {
		const nodeContent = nodeContents.get(nodePath);

		// Skip if node content not found
		if (nodeContent === undefined) {
			continue;
		}

		const result = calculateNodeTokenBudget(
			nodePath,
			nodeContent,
			coveredFiles,
			fileContents,
			budgetThresholdPercent,
			options,
		);

		nodeResults.set(nodePath, result);

		if (result.exceedsBudget) {
			nodesExceedingBudget.push(result);
		}
	}

	return {
		nodeResults,
		nodesExceedingBudget,
		totalNodes: nodeResults.size,
		exceedingCount: nodesExceedingBudget.length,
	};
}

/**
 * Get the directory portion of a file path.
 *
 * @param filePath - Full file path
 * @returns Directory path (empty string for root-level files)
 */
function getDirectory(filePath: string): string {
	const lastSlash = filePath.lastIndexOf("/");
	return lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
}

/**
 * Get the immediate subdirectory relative to a parent directory.
 *
 * @param filePath - Full file path
 * @param parentDir - Parent directory path
 * @returns Immediate subdirectory name, or undefined if file is directly in parent
 */
function getImmediateSubdirectory(
	filePath: string,
	parentDir: string,
): string | undefined {
	const fileDir = getDirectory(filePath);

	// If file is directly in parent directory, no subdirectory
	if (fileDir === parentDir) {
		return undefined;
	}

	// Get the relative path from parent
	const relativePath =
		parentDir === "" ? fileDir : fileDir.substring(parentDir.length + 1);

	// Extract the first path segment
	const firstSlash = relativePath.indexOf("/");
	if (firstSlash === -1) {
		return relativePath;
	}
	return relativePath.substring(0, firstSlash);
}

/**
 * Minimum files in a subdirectory to suggest splitting.
 * Subdirectories with fewer files are not worth splitting into separate nodes.
 */
const MIN_FILES_FOR_SPLIT = 3;

/**
 * Minimum percentage of coverage a subdirectory must have to suggest splitting.
 * Avoids suggesting splits for very small subdirectories.
 */
const MIN_COVERAGE_PERCENT_FOR_SPLIT = 10;

/**
 * Analyze a node's covered files and suggest potential splits.
 *
 * A split is suggested when:
 * 1. The node exceeds the budget threshold
 * 2. There are subdirectories with substantial code coverage
 * 3. The subdirectory doesn't already have an intent node
 *
 * @param nodePath - Path to the intent node
 * @param nodeDirectory - Directory the node covers
 * @param coveredFilePaths - Files covered by this node
 * @param fileContents - Map of file path to content
 * @param budgetPercent - Current budget percentage for the node
 * @param budgetThresholdPercent - Budget threshold to determine if split is needed
 * @param existingNodeDirectories - Set of directories that already have intent nodes
 * @param options - Token counting options
 * @param intentFileName - Name of intent files (default "AGENTS.md")
 * @returns Analysis with split suggestions
 */
export function analyzeNodeForSplit(
	nodePath: string,
	nodeDirectory: string,
	coveredFilePaths: string[],
	fileContents: Map<string, string>,
	budgetPercent: number,
	budgetThresholdPercent = 5,
	existingNodeDirectories: Set<string> = new Set(),
	options: TokenCountOptions = {},
	intentFileName = "AGENTS.md",
): NodeSplitAnalysis {
	const shouldSplit = budgetPercent > budgetThresholdPercent;

	if (!shouldSplit) {
		return {
			nodePath,
			shouldSplit: false,
			budgetPercent,
			suggestions: [],
		};
	}

	// Group files by immediate subdirectory
	const subdirFiles = new Map<string, string[]>();

	for (const filePath of coveredFilePaths) {
		const subdir = getImmediateSubdirectory(filePath, nodeDirectory);
		if (subdir === undefined) {
			// File is directly in node's directory, not in a subdirectory
			continue;
		}

		const fullSubdirPath =
			nodeDirectory === "" ? subdir : `${nodeDirectory}/${subdir}`;

		// Skip if this subdirectory already has an intent node
		if (existingNodeDirectories.has(fullSubdirPath)) {
			continue;
		}

		const files = subdirFiles.get(fullSubdirPath) || [];
		files.push(filePath);
		subdirFiles.set(fullSubdirPath, files);
	}

	// Calculate total covered tokens for percentage calculation
	const totalCoveredResult = calculateCoveredCodeTokens(
		coveredFilePaths,
		fileContents,
		options,
	);

	// Analyze each subdirectory for potential split
	const suggestions: SplitSuggestion[] = [];

	for (const [subdirPath, files] of subdirFiles) {
		// Skip subdirectories with too few files
		if (files.length < MIN_FILES_FOR_SPLIT) {
			continue;
		}

		// Calculate tokens for this subdirectory
		const subdirResult = calculateCoveredCodeTokens(
			files,
			fileContents,
			options,
		);

		// Calculate coverage percentage
		const coveragePercent =
			totalCoveredResult.totalTokens > 0
				? (subdirResult.totalTokens / totalCoveredResult.totalTokens) * 100
				: 0;

		// Skip if coverage is too small
		if (coveragePercent < MIN_COVERAGE_PERCENT_FOR_SPLIT) {
			continue;
		}

		suggestions.push({
			suggestedDirectory: subdirPath,
			suggestedNodePath: `${subdirPath}/${intentFileName}`,
			coveredFiles: files,
			coveredTokens: subdirResult.totalTokens,
			coveragePercent,
		});
	}

	// Sort suggestions by coverage percentage (highest first)
	suggestions.sort((a, b) => b.coveragePercent - a.coveragePercent);

	return {
		nodePath,
		shouldSplit,
		budgetPercent,
		suggestions,
	};
}

/**
 * Result of analyzing all nodes in a hierarchy for potential splits.
 */
export interface HierarchySplitAnalysis {
	/** Split analysis for each node that exceeds budget */
	nodeAnalyses: NodeSplitAnalysis[];
	/** Total number of split suggestions across all nodes */
	totalSuggestions: number;
	/** Nodes that should be split */
	nodesToSplit: string[];
}

/**
 * Analyze all nodes in a hierarchy for potential splits.
 *
 * @param hierarchyBudgetResult - Result from calculateHierarchyTokenBudget
 * @param coveredFilesMap - Map of node path to covered files
 * @param nodeDirectories - Map of node path to its directory
 * @param fileContents - Map of file path to content
 * @param budgetThresholdPercent - Budget threshold
 * @param existingNodeDirectories - Set of directories that already have intent nodes
 * @param options - Token counting options
 * @param intentFileName - Name of intent files (default "AGENTS.md")
 * @returns Analysis with split suggestions for all nodes
 */
export function analyzeHierarchyForSplits(
	hierarchyBudgetResult: HierarchyTokenBudgetResult,
	coveredFilesMap: Map<string, { coveredFiles: string[] }>,
	nodeDirectories: Map<string, string>,
	fileContents: Map<string, string>,
	budgetThresholdPercent = 5,
	existingNodeDirectories: Set<string> = new Set(),
	options: TokenCountOptions = {},
	intentFileName = "AGENTS.md",
): HierarchySplitAnalysis {
	const nodeAnalyses: NodeSplitAnalysis[] = [];
	const nodesToSplit: string[] = [];
	let totalSuggestions = 0;

	for (const nodeResult of hierarchyBudgetResult.nodesExceedingBudget) {
		const coveredData = coveredFilesMap.get(nodeResult.nodePath);
		const nodeDirectory = nodeDirectories.get(nodeResult.nodePath);

		if (!coveredData || nodeDirectory === undefined) {
			continue;
		}

		const analysis = analyzeNodeForSplit(
			nodeResult.nodePath,
			nodeDirectory,
			coveredData.coveredFiles,
			fileContents,
			nodeResult.budgetPercent,
			budgetThresholdPercent,
			existingNodeDirectories,
			options,
			intentFileName,
		);

		if (analysis.shouldSplit) {
			nodeAnalyses.push(analysis);
			nodesToSplit.push(analysis.nodePath);
			totalSuggestions += analysis.suggestions.length;
		}
	}

	return {
		nodeAnalyses,
		totalSuggestions,
		nodesToSplit,
	};
}
