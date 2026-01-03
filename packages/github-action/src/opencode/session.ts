/**
 * OpenCode Session Management
 *
 * This module provides session creation and management for intent layer analysis.
 * Sessions are used to interact with the LLM for analyzing code changes and
 * generating intent layer updates.
 *
 * Based on the OpenCode SDK API patterns from the official documentation
 * and the OpenCode GitHub App reference implementation.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import { type LLMOutput, parseRawLLMOutput } from "./output-schema";

/**
 * Error thrown when session operations fail.
 */
export class SessionError extends Error {
	public readonly originalCause?: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "SessionError";
		this.originalCause = cause;
	}
}

/**
 * Model configuration for session prompts.
 */
export interface ModelConfig {
	/** Provider ID (e.g., "anthropic", "openrouter") */
	providerID: string;
	/** Model ID (e.g., "claude-sonnet-4-20250514") */
	modelID: string;
}

/**
 * Parse a model string into provider and model ID.
 *
 * @param model - Model string in format "provider/model" or "openrouter/provider/model"
 * @returns Model configuration object
 * @throws {SessionError} If the model string is invalid
 *
 * @example
 * ```ts
 * parseModelString("anthropic/claude-sonnet-4-20250514")
 * // => { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }
 *
 * parseModelString("openrouter/anthropic/claude-sonnet-4-20250514")
 * // => { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4-20250514" }
 * ```
 */
export function parseModelString(model: string): ModelConfig {
	const parts = model.split("/");

	if (parts.length < 2 || !parts[0]) {
		throw new SessionError(
			`Invalid model format: "${model}". Expected "provider/model" or "openrouter/provider/model" format.`,
		);
	}

	const [firstPart, ...rest] = parts;

	// Handle openrouter format: "openrouter/anthropic/claude-..." -> provider=openrouter, model=anthropic/claude-...
	if (firstPart === "openrouter") {
		if (rest.length < 2) {
			throw new SessionError(
				`Invalid OpenRouter model format: "${model}". Expected "openrouter/provider/model" format.`,
			);
		}
		return {
			providerID: "openrouter",
			modelID: rest.join("/"),
		};
	}

	// Handle standard format: "anthropic/claude-..." -> provider=anthropic, model=claude-...
	return {
		providerID: firstPart,
		modelID: rest.join("/"),
	};
}

/**
 * Session information returned from OpenCode API.
 */
export interface SessionInfo {
	/** Unique session ID */
	id: string;
	/** Session title */
	title: string;
	/** Session version */
	version: string;
}

/**
 * Configuration for creating an intent layer analysis session.
 */
export interface CreateSessionConfig {
	/** Title for the session (e.g., "Intent Layer Analysis for PR #123") */
	title: string;
	/** Model configuration */
	model: ModelConfig;
}

/**
 * Configuration for sending a prompt to the session.
 */
export interface PromptConfig {
	/** The prompt text to send */
	prompt: string;
	/** Model configuration (optional, uses session default if not provided) */
	model?: ModelConfig;
}

/**
 * Result of sending a prompt to the session.
 */
export interface PromptResult {
	/** The raw text response from the LLM */
	rawResponse: string;
	/** Parsed and validated LLM output (if valid JSON) */
	parsedOutput?: LLMOutput;
	/** Error message if parsing failed */
	parseError?: string;
}

/**
 * Intent layer analysis session wrapper.
 *
 * Provides a high-level interface for creating sessions, sending prompts,
 * and handling responses for intent layer analysis.
 */
export class IntentAnalysisSession {
	private readonly client: OpencodeClient;
	private readonly sessionId: string;
	private readonly defaultModel: ModelConfig;

	/**
	 * Create a new IntentAnalysisSession wrapper.
	 *
	 * @param client - OpenCode client instance
	 * @param sessionId - Session ID from OpenCode
	 * @param defaultModel - Default model configuration
	 */
	constructor(
		client: OpencodeClient,
		sessionId: string,
		defaultModel: ModelConfig,
	) {
		this.client = client;
		this.sessionId = sessionId;
		this.defaultModel = defaultModel;
	}

	/**
	 * Get the session ID.
	 */
	get id(): string {
		return this.sessionId;
	}

	/**
	 * Send a prompt to the session and get the response.
	 *
	 * @param config - Prompt configuration
	 * @returns Prompt result with raw and parsed output
	 * @throws {SessionError} If the prompt fails
	 */
	async prompt(config: PromptConfig): Promise<PromptResult> {
		const model = config.model ?? this.defaultModel;

		try {
			const response = await this.client.session.prompt({
				path: { id: this.sessionId },
				body: {
					model: {
						providerID: model.providerID,
						modelID: model.modelID,
					},
					parts: [
						{
							type: "text",
							text: config.prompt,
						},
					],
				},
			});

			// Extract text response from parts
			const rawResponse = this.extractTextFromResponse(response);

			// Try to parse as LLM output
			const parseResult = parseRawLLMOutput(rawResponse);

			if (parseResult.success) {
				return {
					rawResponse,
					parsedOutput: parseResult.data,
				};
			}

			return {
				rawResponse,
				parseError: parseResult.error,
			};
		} catch (error) {
			throw new SessionError(
				`Failed to send prompt to session ${this.sessionId}`,
				error,
			);
		}
	}

	/**
	 * Send a prompt and get parsed LLM output.
	 *
	 * @param config - Prompt configuration
	 * @returns Validated LLM output
	 * @throws {SessionError} If the prompt fails or output is invalid
	 */
	async promptForOutput(config: PromptConfig): Promise<LLMOutput> {
		const result = await this.prompt(config);

		if (result.parsedOutput) {
			return result.parsedOutput;
		}

		throw new SessionError(
			`Invalid LLM output: ${result.parseError ?? "Unknown parse error"}`,
		);
	}

	/**
	 * Inject context into the session without triggering an AI response.
	 *
	 * This is useful for providing background context before the main prompt.
	 *
	 * @param context - Context text to inject
	 * @throws {SessionError} If context injection fails
	 */
	async injectContext(context: string): Promise<void> {
		try {
			await this.client.session.prompt({
				path: { id: this.sessionId },
				body: {
					noReply: true,
					parts: [
						{
							type: "text",
							text: context,
						},
					],
				},
			});
		} catch (error) {
			throw new SessionError(
				`Failed to inject context into session ${this.sessionId}`,
				error,
			);
		}
	}

	/**
	 * Abort the session if it's running.
	 *
	 * @throws {SessionError} If abort fails
	 */
	async abort(): Promise<void> {
		try {
			await this.client.session.abort({
				path: { id: this.sessionId },
			});
		} catch (error) {
			throw new SessionError(
				`Failed to abort session ${this.sessionId}`,
				error,
			);
		}
	}

	/**
	 * Delete the session.
	 *
	 * @throws {SessionError} If deletion fails
	 */
	async delete(): Promise<void> {
		try {
			await this.client.session.delete({
				path: { id: this.sessionId },
			});
		} catch (error) {
			throw new SessionError(
				`Failed to delete session ${this.sessionId}`,
				error,
			);
		}
	}

	/**
	 * Get session messages history.
	 *
	 * @returns Array of messages in the session
	 * @throws {SessionError} If fetching messages fails
	 */
	async getMessages(): Promise<unknown[]> {
		try {
			const response = await this.client.session.messages({
				path: { id: this.sessionId },
			});
			// The response structure varies, return as-is
			return response as unknown as unknown[];
		} catch (error) {
			throw new SessionError(
				`Failed to get messages for session ${this.sessionId}`,
				error,
			);
		}
	}

	/**
	 * Extract text content from a session prompt response.
	 *
	 * @param response - Response from session.prompt API
	 * @returns Extracted text content
	 */
	private extractTextFromResponse(response: unknown): string {
		// Handle various response structures from the SDK
		// The SDK types are dynamic, so we handle this defensively

		if (!response) {
			return "";
		}

		// Try response.data.parts pattern (common SDK response)
		const dataResponse = response as {
			data?: { parts?: Array<{ type: string; text?: string }> };
		};
		if (dataResponse.data?.parts) {
			const textPart = dataResponse.data.parts.find((p) => p.type === "text");
			if (textPart?.text) {
				return textPart.text;
			}
		}

		// Try direct parts pattern
		const partsResponse = response as {
			parts?: Array<{ type: string; text?: string }>;
		};
		if (partsResponse.parts) {
			const textPart = partsResponse.parts.find((p) => p.type === "text");
			if (textPart?.text) {
				return textPart.text;
			}
		}

		// Try direct info.text pattern
		const infoResponse = response as {
			info?: { text?: string };
			data?: { info?: { text?: string } };
		};
		if (infoResponse.data?.info?.text) {
			return infoResponse.data.info.text;
		}
		if (infoResponse.info?.text) {
			return infoResponse.info.text;
		}

		// Fallback: stringify the response
		if (typeof response === "string") {
			return response;
		}

		return JSON.stringify(response);
	}
}

/**
 * Create a new intent layer analysis session.
 *
 * @param client - OpenCode client instance
 * @param config - Session configuration
 * @returns Intent analysis session wrapper
 * @throws {SessionError} If session creation fails
 *
 * @example
 * ```ts
 * const session = await createIntentAnalysisSession(client, {
 *   title: "Intent Layer Analysis for PR #123",
 *   model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
 * });
 *
 * const result = await session.promptForOutput({
 *   prompt: buildAnalysisPrompt(prContext, intentContext, config),
 * });
 *
 * console.log("Updates:", result.updates);
 *
 * await session.delete();
 * ```
 */
export async function createIntentAnalysisSession(
	client: OpencodeClient,
	config: CreateSessionConfig,
): Promise<IntentAnalysisSession> {
	try {
		const response = await client.session.create({
			body: {
				title: config.title,
			},
		});

		// Extract session ID from response
		const sessionId = extractSessionId(response);

		return new IntentAnalysisSession(client, sessionId, config.model);
	} catch (error) {
		throw new SessionError(
			`Failed to create intent analysis session: ${config.title}`,
			error,
		);
	}
}

/**
 * Create a session from a model string.
 *
 * Convenience function that parses the model string and creates a session.
 *
 * @param client - OpenCode client instance
 * @param title - Session title
 * @param model - Model string (e.g., "anthropic/claude-sonnet-4-20250514")
 * @returns Intent analysis session wrapper
 * @throws {SessionError} If model parsing or session creation fails
 */
export async function createSessionFromModelString(
	client: OpencodeClient,
	title: string,
	model: string,
): Promise<IntentAnalysisSession> {
	const modelConfig = parseModelString(model);
	return createIntentAnalysisSession(client, {
		title,
		model: modelConfig,
	});
}

/**
 * Extract session ID from create response.
 *
 * @param response - Response from session.create API
 * @returns Session ID
 * @throws {SessionError} If session ID cannot be extracted
 */
function extractSessionId(response: unknown): string {
	// Handle various response structures
	if (!response) {
		throw new SessionError("Session creation returned empty response");
	}

	// Try response.data.id pattern
	const dataResponse = response as { data?: { id?: string } };
	if (dataResponse.data?.id) {
		return dataResponse.data.id;
	}

	// Try direct id pattern
	const directResponse = response as { id?: string };
	if (directResponse.id) {
		return directResponse.id;
	}

	throw new SessionError(
		`Could not extract session ID from response: ${JSON.stringify(response)}`,
	);
}

/**
 * Build a session title for intent layer analysis.
 *
 * @param prNumber - Pull request number
 * @param repoName - Repository name (optional)
 * @returns Formatted session title
 */
export function buildSessionTitle(prNumber: number, repoName?: string): string {
	const base = `Intent Layer Analysis for PR #${prNumber}`;
	return repoName ? `${base} (${repoName})` : base;
}
