import { minimatch } from "minimatch";
import YAML from "yaml";
import type { PromptConfig } from "../config/schema";

/**
 * Result of resolving prompts for a file path.
 * Contains the matched prompt(s) for the file, if any.
 */
export interface ResolvedPrompt {
	/** The pattern that matched */
	pattern: string;
	/** General prompt (used for both file types if specific prompts not provided) */
	prompt?: string;
	/** AGENTS.md-specific prompt */
	agents_prompt?: string;
	/** CLAUDE.md-specific prompt */
	claude_prompt?: string;
}

/**
 * Calculate the specificity score of a glob pattern.
 * Higher scores indicate more specific patterns.
 *
 * Specificity is determined by:
 * 1. Path depth (more segments = more specific)
 * 2. Glob narrowness (literal characters vs wildcards)
 * 3. Pattern type (exact match > single wildcard > double wildcard)
 *
 * @param pattern - The glob pattern to score
 * @returns A numeric specificity score (higher = more specific)
 */
export function calculatePatternSpecificity(pattern: string): number {
	let score = 0;

	// Split pattern into segments
	const segments = pattern.split("/").filter((s) => s.length > 0);

	// Path depth: each segment adds to specificity
	score += segments.length * 100;

	for (const segment of segments) {
		if (segment === "**") {
			// Double wildcard is very general
			score -= 50;
		} else if (segment === "*") {
			// Single wildcard for entire segment is general
			score -= 30;
		} else if (segment.includes("**")) {
			// Segment contains double wildcard
			score -= 40;
		} else if (segment.includes("*")) {
			// Segment contains single wildcard but has other chars
			// Count literal characters
			const literals = segment.replace(/\*/g, "").length;
			score += literals * 5;
		} else {
			// Exact match segment (most specific)
			score += segment.length * 10;
		}
	}

	// Patterns starting with ** are very general
	if (pattern.startsWith("**/")) {
		score -= 100;
	}

	// Patterns ending with /** are very general
	if (pattern.endsWith("/**")) {
		score -= 50;
	}

	// File extension patterns are more specific than pure wildcards
	if (pattern.includes("*.")) {
		// Has file extension pattern
		const extMatch = pattern.match(/\*\.(\w+)$/);
		if (extMatch?.[1]) {
			score += extMatch[1].length * 3;
		}
	}

	return score;
}

/**
 * Parse prompts configuration from a YAML string.
 *
 * @param yamlString - Raw YAML string containing prompts configuration
 * @returns Array of parsed PromptConfig objects
 * @throws Error if YAML is invalid or doesn't match expected structure
 */
export function parsePromptsYaml(yamlString: string): PromptConfig[] {
	if (!yamlString.trim()) {
		return [];
	}

	const parsed = YAML.parse(yamlString);

	// Handle various YAML structures
	if (parsed === null || parsed === undefined) {
		return [];
	}

	// If it's already an array, validate and return
	if (Array.isArray(parsed)) {
		return validatePromptConfigs(parsed);
	}

	// If it has a 'prompts' key with an array, use that
	if (parsed.prompts && Array.isArray(parsed.prompts)) {
		return validatePromptConfigs(parsed.prompts);
	}

	throw new Error(
		"Invalid prompts configuration: expected an array of prompt configs or an object with a 'prompts' array",
	);
}

/**
 * Validate an array of prompt config objects.
 *
 * @param configs - Array of parsed objects to validate
 * @returns Array of validated PromptConfig objects
 * @throws Error if any config is invalid
 */
function validatePromptConfigs(
	configs: Record<string, unknown>[],
): PromptConfig[] {
	return configs.map((config, index) => {
		if (!config || typeof config !== "object") {
			throw new Error(`Invalid prompt config at index ${index}: not an object`);
		}

		if (!("pattern" in config) || typeof config.pattern !== "string") {
			throw new Error(
				`Invalid prompt config at index ${index}: missing or invalid 'pattern' field`,
			);
		}

		const result: PromptConfig = {
			pattern: config.pattern,
		};

		if ("prompt" in config) {
			if (typeof config.prompt !== "string") {
				throw new Error(
					`Invalid prompt config at index ${index}: 'prompt' must be a string`,
				);
			}
			result.prompt = config.prompt;
		}

		if ("agents_prompt" in config) {
			if (typeof config.agents_prompt !== "string") {
				throw new Error(
					`Invalid prompt config at index ${index}: 'agents_prompt' must be a string`,
				);
			}
			result.agents_prompt = config.agents_prompt;
		}

		if ("claude_prompt" in config) {
			if (typeof config.claude_prompt !== "string") {
				throw new Error(
					`Invalid prompt config at index ${index}: 'claude_prompt' must be a string`,
				);
			}
			result.claude_prompt = config.claude_prompt;
		}

		// At least one prompt type should be provided
		if (!result.prompt && !result.agents_prompt && !result.claude_prompt) {
			throw new Error(
				`Invalid prompt config at index ${index}: must provide at least one of 'prompt', 'agents_prompt', or 'claude_prompt'`,
			);
		}

		return result;
	});
}

/**
 * PatternMatchedPromptResolver resolves the most specific prompt
 * configuration for a given file path.
 *
 * When multiple patterns match a file, the most specific pattern wins.
 * Specificity is determined by path depth and glob narrowness.
 * There is no merging of prompts from multiple patterns.
 */
export class PatternMatchedPromptResolver {
	private configs: PromptConfig[];

	constructor(configs: PromptConfig[] = []) {
		this.configs = configs;
	}

	/**
	 * Add prompt configurations from an array
	 *
	 * @param configs - Array of PromptConfig objects
	 * @returns this instance for chaining
	 */
	addConfigs(configs: PromptConfig[]): this {
		this.configs.push(...configs);
		return this;
	}

	/**
	 * Add prompt configurations from a YAML string
	 *
	 * @param yamlString - Raw YAML string containing prompts configuration
	 * @returns this instance for chaining
	 */
	addFromYaml(yamlString: string): this {
		const parsed = parsePromptsYaml(yamlString);
		return this.addConfigs(parsed);
	}

	/**
	 * Resolve the most specific prompt configuration for a file path.
	 *
	 * @param filePath - Relative file path to resolve prompts for (forward slashes, no leading slash)
	 * @returns The most specific matching prompt config, or null if no patterns match
	 */
	resolve(filePath: string): ResolvedPrompt | null {
		// Find all matching configs with their specificity scores
		const matches: Array<{ config: PromptConfig; specificity: number }> = [];

		for (const config of this.configs) {
			if (minimatch(filePath, config.pattern, { dot: true })) {
				matches.push({
					config,
					specificity: calculatePatternSpecificity(config.pattern),
				});
			}
		}

		if (matches.length === 0) {
			return null;
		}

		// Sort by specificity (highest first) and take the most specific
		matches.sort((a, b) => b.specificity - a.specificity);
		const topMatch = matches[0];
		if (!topMatch) {
			return null;
		}
		const winner = topMatch.config;

		return {
			pattern: winner.pattern,
			prompt: winner.prompt,
			agents_prompt: winner.agents_prompt,
			claude_prompt: winner.claude_prompt,
		};
	}

	/**
	 * Get the prompt text for a specific file type.
	 * Falls back to the general 'prompt' if a type-specific prompt is not provided.
	 *
	 * @param filePath - Relative file path to resolve prompts for
	 * @param fileType - Which file type: 'agents' or 'claude'
	 * @returns The prompt text for the file type, or null if no matching prompt
	 */
	getPromptForFile(
		filePath: string,
		fileType: "agents" | "claude",
	): string | null {
		const resolved = this.resolve(filePath);
		if (!resolved) {
			return null;
		}

		if (fileType === "agents") {
			return resolved.agents_prompt ?? resolved.prompt ?? null;
		}
		return resolved.claude_prompt ?? resolved.prompt ?? null;
	}

	/**
	 * Check if any patterns are configured
	 *
	 * @returns true if at least one pattern is configured
	 */
	hasPatterns(): boolean {
		return this.configs.length > 0;
	}

	/**
	 * Get the number of configured patterns
	 *
	 * @returns The count of configured patterns
	 */
	getPatternCount(): number {
		return this.configs.length;
	}
}

/**
 * Create a PatternMatchedPromptResolver from the action inputs prompts value.
 * Handles both pre-parsed arrays and YAML strings.
 *
 * @param prompts - The prompts value from action inputs (string | PromptConfig[] | undefined)
 * @returns Configured PatternMatchedPromptResolver instance
 */
export function createPromptResolver(
	prompts: string | PromptConfig[] | undefined,
): PatternMatchedPromptResolver {
	const resolver = new PatternMatchedPromptResolver();

	if (!prompts) {
		return resolver;
	}

	if (typeof prompts === "string") {
		resolver.addFromYaml(prompts);
	} else {
		resolver.addConfigs(prompts);
	}

	return resolver;
}
