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
