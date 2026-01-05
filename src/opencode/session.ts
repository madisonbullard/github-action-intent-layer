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

import * as core from "@actions/core";
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
 * Error thrown when model access fails (authentication, rate limiting, model unavailable, etc.).
 * These errors should cause the action to fail with a clear message.
 */
export class ModelAccessError extends Error {
	public readonly originalCause?: unknown;
	public readonly statusCode?: number;
	public readonly errorCode?: string;

	constructor(
		message: string,
		options?: { cause?: unknown; statusCode?: number; errorCode?: string },
	) {
		super(message);
		this.name = "ModelAccessError";
		this.originalCause = options?.cause;
		this.statusCode = options?.statusCode;
		this.errorCode = options?.errorCode;
	}

	/**
	 * Check if this error indicates an authentication failure.
	 */
	isAuthenticationError(): boolean {
		return (
			this.statusCode === 401 ||
			this.errorCode === "authentication_error" ||
			this.errorCode === "invalid_api_key"
		);
	}

	/**
	 * Check if this error indicates rate limiting.
	 */
	isRateLimitError(): boolean {
		return this.statusCode === 429 || this.errorCode === "rate_limit_error";
	}

	/**
	 * Check if this error indicates the model is unavailable.
	 */
	isModelUnavailableError(): boolean {
		return (
			this.statusCode === 404 ||
			this.errorCode === "model_not_found" ||
			this.errorCode === "invalid_model"
		);
	}
}

/**
 * Known error codes from LLM providers that indicate model access issues.
 */
const MODEL_ACCESS_ERROR_CODES = new Set([
	// Authentication errors
	"authentication_error",
	"invalid_api_key",
	"unauthorized",
	// Rate limiting
	"rate_limit_error",
	"rate_limit_exceeded",
	// Model availability
	"model_not_found",
	"invalid_model",
	"model_unavailable",
	// Permission errors
	"permission_denied",
	"access_denied",
	// Quota errors
	"quota_exceeded",
	"insufficient_quota",
]);

/**
 * HTTP status codes that indicate model access issues.
 */
const MODEL_ACCESS_STATUS_CODES = new Set([
	401, // Unauthorized - invalid API key
	403, // Forbidden - permission denied
	404, // Not Found - model doesn't exist
	429, // Too Many Requests - rate limited
	402, // Payment Required - quota exceeded
]);

/**
 * Detect if an error is a model access error and extract details.
 *
 * @param error - The error to analyze
 * @returns Object with isModelAccessError flag and extracted details
 */
export function detectModelAccessError(error: unknown): {
	isModelAccessError: boolean;
	statusCode?: number;
	errorCode?: string;
	message: string;
} {
	if (!error) {
		return { isModelAccessError: false, message: "Unknown error" };
	}

	// Handle standard Error objects
	if (error instanceof Error) {
		const errorAny = error as unknown as Record<string, unknown>;

		// Try to extract status code from various error shapes
		const statusCode =
			typeof errorAny.status === "number"
				? errorAny.status
				: typeof errorAny.statusCode === "number"
					? errorAny.statusCode
					: typeof (errorAny.response as Record<string, unknown>)?.status ===
							"number"
						? ((errorAny.response as Record<string, unknown>).status as number)
						: undefined;

		// Try to extract error code from various error shapes
		const errorCode =
			typeof errorAny.code === "string"
				? errorAny.code
				: typeof errorAny.error_code === "string"
					? errorAny.error_code
					: typeof (errorAny.error as Record<string, unknown>)?.type ===
							"string"
						? ((errorAny.error as Record<string, unknown>).type as string)
						: undefined;

		// Check if it's a model access error
		const isModelAccessError =
			(statusCode !== undefined && MODEL_ACCESS_STATUS_CODES.has(statusCode)) ||
			(errorCode !== undefined && MODEL_ACCESS_ERROR_CODES.has(errorCode));

		return {
			isModelAccessError,
			statusCode,
			errorCode,
			message: error.message,
		};
	}

	// Handle plain objects (e.g., from API responses)
	if (typeof error === "object") {
		const errorObj = error as Record<string, unknown>;
		const statusCode =
			typeof errorObj.status === "number"
				? errorObj.status
				: typeof errorObj.statusCode === "number"
					? errorObj.statusCode
					: undefined;
		const errorCode =
			typeof errorObj.code === "string"
				? errorObj.code
				: typeof errorObj.error_code === "string"
					? errorObj.error_code
					: undefined;
		const message =
			typeof errorObj.message === "string"
				? errorObj.message
				: JSON.stringify(error);

		const isModelAccessError =
			(statusCode !== undefined && MODEL_ACCESS_STATUS_CODES.has(statusCode)) ||
			(errorCode !== undefined && MODEL_ACCESS_ERROR_CODES.has(errorCode));

		return {
			isModelAccessError,
			statusCode,
			errorCode,
			message,
		};
	}

	return {
		isModelAccessError: false,
		message: String(error),
	};
}

/**
 * Create a user-friendly error message for model access errors.
 *
 * @param statusCode - HTTP status code (if available)
 * @param errorCode - Provider error code (if available)
 * @param originalMessage - Original error message
 * @returns User-friendly error message with guidance
 */
export function formatModelAccessErrorMessage(
	statusCode?: number,
	errorCode?: string,
	originalMessage?: string,
): string {
	// Authentication errors
	if (
		statusCode === 401 ||
		errorCode === "authentication_error" ||
		errorCode === "invalid_api_key"
	) {
		return (
			"Model access failed: Invalid API key. " +
			"Please verify that your ANTHROPIC_API_KEY or OPENROUTER_API_KEY secret is correct and not expired. " +
			`(${originalMessage || "authentication_error"})`
		);
	}

	// Permission errors
	if (statusCode === 403 || errorCode === "permission_denied") {
		return (
			"Model access failed: Permission denied. " +
			"Your API key may not have access to this model. " +
			`(${originalMessage || "permission_denied"})`
		);
	}

	// Model not found
	if (
		statusCode === 404 ||
		errorCode === "model_not_found" ||
		errorCode === "invalid_model"
	) {
		return (
			"Model access failed: Model not found. " +
			"Please verify the model name in your workflow configuration. " +
			`(${originalMessage || "model_not_found"})`
		);
	}

	// Rate limiting
	if (statusCode === 429 || errorCode === "rate_limit_error") {
		return (
			"Model access failed: Rate limit exceeded. " +
			"Please wait and try again, or contact your API provider to increase limits. " +
			`(${originalMessage || "rate_limit_error"})`
		);
	}

	// Quota exceeded
	if (
		statusCode === 402 ||
		errorCode === "quota_exceeded" ||
		errorCode === "insufficient_quota"
	) {
		return (
			"Model access failed: API quota exceeded. " +
			"Please check your API account's usage limits and billing status. " +
			`(${originalMessage || "quota_exceeded"})`
		);
	}

	// Generic model access error
	return (
		"Model access failed: " +
		(originalMessage || "Unknown error") +
		". Please verify your API configuration and model settings."
	);
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
			core.info(
				`Sending prompt to session ${this.sessionId} with model ${model.providerID}/${model.modelID}`,
			);
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

			core.info(
				`Full SDK response keys: ${Object.keys(response as object).join(", ")}`,
			);
			core.info(
				`Full SDK response: ${JSON.stringify(response).substring(0, 2000)}`,
			);

			// Check if response has an error
			const responseAny = response as Record<string, unknown>;
			if (responseAny.error) {
				core.error(`SDK returned error: ${JSON.stringify(responseAny.error)}`);
				throw new SessionError(
					`SDK error: ${JSON.stringify(responseAny.error)}`,
				);
			}

			// Check for HTTP response details
			if (responseAny.response) {
				const httpResponse = responseAny.response as {
					status?: number;
					statusText?: string;
				};
				core.info(
					`HTTP response status: ${httpResponse.status} ${httpResponse.statusText || ""}`,
				);
			}

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
			// Check if this is a model access error
			const modelAccessCheck = detectModelAccessError(error);
			if (modelAccessCheck.isModelAccessError) {
				throw new ModelAccessError(
					formatModelAccessErrorMessage(
						modelAccessCheck.statusCode,
						modelAccessCheck.errorCode,
						modelAccessCheck.message,
					),
					{
						cause: error,
						statusCode: modelAccessCheck.statusCode,
						errorCode: modelAccessCheck.errorCode,
					},
				);
			}

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
	 * The SDK returns: { data: { info: AssistantMessage, parts: Part[] }, request, response }
	 * We need to extract text from the parts array.
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

		// The SDK wraps the response in { data, request, response }
		// The actual content is in data.parts array
		const sdkResponse = response as {
			data?: {
				info?: unknown;
				parts?: Array<{ type: string; text?: string }>;
			};
		};

		// Try response.data.parts pattern (SDK response structure)
		if (sdkResponse.data?.parts && Array.isArray(sdkResponse.data.parts)) {
			// Collect all text parts and concatenate them
			const textParts = sdkResponse.data.parts
				.filter((p) => p.type === "text" && p.text)
				.map((p) => p.text);
			if (textParts.length > 0) {
				return textParts.join("");
			}
		}

		// Try direct parts pattern (in case data is unwrapped)
		const partsResponse = response as {
			parts?: Array<{ type: string; text?: string }>;
		};
		if (partsResponse.parts && Array.isArray(partsResponse.parts)) {
			const textParts = partsResponse.parts
				.filter((p) => p.type === "text" && p.text)
				.map((p) => p.text);
			if (textParts.length > 0) {
				return textParts.join("");
			}
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

/**
 * Handle a model access error by failing the GitHub Action with a clear error message.
 *
 * This function should be called when a ModelAccessError is caught during intent layer
 * analysis. It will:
 * 1. Log the error details for debugging
 * 2. Fail the GitHub Action with a user-friendly error message
 * 3. Re-throw the error for programmatic handling
 *
 * Per PLAN.md task 12.5:
 * "Handle model access errors → fail action with clear error message (no PR comment)"
 *
 * @param error - The ModelAccessError that occurred
 * @throws The original ModelAccessError after logging and failing the action
 */
export function handleModelAccessError(error: ModelAccessError): never {
	// Build detailed error message for logging
	const detailedMessage = buildDetailedModelAccessErrorMessage(error);

	// Log the detailed error for debugging
	core.error(detailedMessage);

	// Fail the GitHub Action with clear message
	core.setFailed(detailedMessage);

	// Re-throw the error for programmatic handling
	throw error;
}

/**
 * Build a detailed error message for model access errors.
 *
 * @param error - The ModelAccessError
 * @returns Detailed error message with context and guidance
 */
function buildDetailedModelAccessErrorMessage(error: ModelAccessError): string {
	const lines: string[] = [];

	lines.push("Intent Layer Action Failed: Model Access Error");
	lines.push("");
	lines.push(error.message);
	lines.push("");

	// Add specific guidance based on error type
	if (error.isAuthenticationError()) {
		lines.push("Troubleshooting steps:");
		lines.push(
			"  1. Verify your API key secret is correctly configured in repository settings",
		);
		lines.push(
			"  2. Ensure the secret name matches what's expected (ANTHROPIC_API_KEY or OPENROUTER_API_KEY)",
		);
		lines.push("  3. Check that the API key has not expired or been revoked");
		lines.push(
			"  4. Confirm the API key has access to the model specified in your workflow",
		);
	} else if (error.isRateLimitError()) {
		lines.push("Troubleshooting steps:");
		lines.push("  1. Wait a few minutes and re-run the action");
		lines.push("  2. Check your API provider's rate limit status");
		lines.push("  3. Consider upgrading your API plan for higher limits");
	} else if (error.isModelUnavailableError()) {
		lines.push("Troubleshooting steps:");
		lines.push(
			"  1. Verify the model name in your workflow configuration is correct",
		);
		lines.push(
			"  2. Check if the model is available in your region or account tier",
		);
		lines.push("  3. Try using a different model version or provider");
	} else {
		lines.push("Troubleshooting steps:");
		lines.push("  1. Check your API configuration and credentials");
		lines.push("  2. Review the error message above for specific details");
		lines.push("  3. Consult your API provider's documentation");
	}

	lines.push("");

	// Add error details for debugging
	if (error.statusCode || error.errorCode) {
		lines.push("Error details:");
		if (error.statusCode) {
			lines.push(`  Status code: ${error.statusCode}`);
		}
		if (error.errorCode) {
			lines.push(`  Error code: ${error.errorCode}`);
		}
	}

	return lines.join("\n");
}

/**
 * Check if an error is a ModelAccessError and handle it appropriately.
 *
 * This is a convenience function that combines error detection and handling.
 * If the error is a ModelAccessError, it will fail the action and throw.
 * If not, it returns false so the caller can handle other error types.
 *
 * @param error - Any error that occurred
 * @returns false if the error is not a ModelAccessError (never returns if it is)
 */
export function checkAndHandleModelAccessError(error: unknown): boolean {
	if (error instanceof ModelAccessError) {
		handleModelAccessError(error);
		// handleModelAccessError always throws, so this is unreachable
	}

	// Check if this is an error that should be converted to ModelAccessError
	const detection = detectModelAccessError(error);
	if (detection.isModelAccessError) {
		const modelError = new ModelAccessError(
			formatModelAccessErrorMessage(
				detection.statusCode,
				detection.errorCode,
				detection.message,
			),
			{
				cause: error,
				statusCode: detection.statusCode,
				errorCode: detection.errorCode,
			},
		);
		handleModelAccessError(modelError);
		// handleModelAccessError always throws, so this is unreachable
	}

	return false;
}
