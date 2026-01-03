/**
 * OpenCode SDK Client
 *
 * This module provides the OpenCode SDK client initialization and management.
 * It spawns the OpenCode server, creates a client connected to it, and handles
 * authentication via user-provided API keys.
 *
 * The client is used for programmatic LLM session control to analyze code changes
 * and generate intent layer updates.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";

/**
 * Configuration for creating an OpenCode client.
 */
export interface OpenCodeClientConfig {
	/** API key for authentication (ANTHROPIC_API_KEY or OPENROUTER_API_KEY) */
	apiKey: string;
	/** Provider ID for authentication (e.g., "anthropic", "openrouter") */
	providerId: string;
	/** Server hostname (default: "127.0.0.1") */
	hostname?: string;
	/** Server port (default: 4096) */
	port?: number;
	/** Connection timeout in ms (default: 30000) */
	timeout?: number;
	/** Connection retry interval in ms (default: 300) */
	retryInterval?: number;
	/** Maximum number of connection retries (default: 100) */
	maxRetries?: number;
}

/**
 * Result of creating an OpenCode client.
 */
export interface OpenCodeClientResult {
	/** The OpenCode API client */
	client: OpencodeClient;
	/** Server management functions */
	server: {
		/** Server URL */
		url: string;
		/** Close the server process */
		close: () => void;
	};
}

/**
 * Error thrown when OpenCode client initialization fails.
 */
export class OpenCodeClientError extends Error {
	public readonly originalCause?: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "OpenCodeClientError";
		this.originalCause = cause;
	}
}

/**
 * Determine the provider ID from the model string.
 *
 * @param model - Model string in format "provider/model" or "openrouter/provider/model"
 * @returns The provider ID for authentication
 * @throws {OpenCodeClientError} If the model string is empty or invalid
 */
export function getProviderIdFromModel(model: string): string {
	const parts = model.split("/");
	const firstPart = parts[0];

	if (!firstPart) {
		throw new OpenCodeClientError(
			`Invalid model format: "${model}". Expected "provider/model" format.`,
		);
	}

	// Handle openrouter format: "openrouter/anthropic/claude-..." -> "openrouter"
	if (firstPart === "openrouter") {
		return "openrouter";
	}

	// Handle standard format: "anthropic/claude-..." -> "anthropic"
	return firstPart;
}

/**
 * Get the appropriate API key from environment variables based on the provider.
 *
 * @param providerId - The provider ID (e.g., "anthropic", "openrouter")
 * @returns The API key for the provider
 * @throws {OpenCodeClientError} If no API key is found for the provider
 */
export function getApiKeyForProvider(providerId: string): string {
	if (providerId === "openrouter") {
		const key = process.env.OPENROUTER_API_KEY;
		if (!key) {
			throw new OpenCodeClientError(
				"OPENROUTER_API_KEY environment variable is required for OpenRouter models",
			);
		}
		return key;
	}

	if (providerId === "anthropic") {
		const key = process.env.ANTHROPIC_API_KEY;
		if (!key) {
			throw new OpenCodeClientError(
				"ANTHROPIC_API_KEY environment variable is required for Anthropic models",
			);
		}
		return key;
	}

	// For other providers, try the generic pattern PROVIDER_API_KEY
	const envVarName = `${providerId.toUpperCase()}_API_KEY`;
	const key = process.env[envVarName];
	if (key) {
		return key;
	}

	throw new OpenCodeClientError(
		`${envVarName} environment variable is required for ${providerId} models`,
	);
}

/**
 * Spawn the OpenCode server process.
 *
 * @param hostname - Server hostname
 * @param port - Server port
 * @returns The spawned child process
 */
function spawnOpenCodeServer(hostname: string, port: number): ChildProcess {
	return spawn(
		"opencode",
		["serve", `--hostname=${hostname}`, `--port=${port}`],
		{
			stdio: "pipe",
		},
	);
}

/**
 * Wait for the OpenCode server to be ready and connected.
 *
 * @param client - The OpenCode client
 * @param maxRetries - Maximum number of connection retries
 * @param retryInterval - Time between retries in ms
 * @throws {OpenCodeClientError} If connection fails after all retries
 */
async function waitForServerReady(
	client: OpencodeClient,
	maxRetries: number,
	retryInterval: number,
): Promise<void> {
	let retries = 0;
	let lastError: unknown;

	while (retries < maxRetries) {
		try {
			// Use the app.log endpoint to verify server is ready
			// This is the pattern used in the OpenCode GitHub App reference implementation
			await client.app.log({
				body: {
					service: "intent-layer-action",
					level: "info",
					message: "Checking server readiness",
				},
			});
			return;
		} catch (error) {
			lastError = error;
		}

		await sleep(retryInterval);
		retries++;
	}

	throw new OpenCodeClientError(
		`Failed to connect to OpenCode server after ${maxRetries} retries`,
		lastError,
	);
}

/**
 * Set up authentication with the OpenCode server.
 *
 * @param client - The OpenCode client
 * @param providerId - Provider ID for authentication
 * @param apiKey - API key for authentication
 * @throws {OpenCodeClientError} If authentication setup fails
 */
async function setupAuthentication(
	client: OpencodeClient,
	providerId: string,
	apiKey: string,
): Promise<void> {
	try {
		await client.auth.set({
			path: { id: providerId },
			body: { type: "api", key: apiKey },
		});
	} catch (error) {
		throw new OpenCodeClientError(
			`Failed to set up authentication for provider "${providerId}"`,
			error,
		);
	}
}

/**
 * Simple sleep utility.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create and initialize an OpenCode client with the server.
 *
 * This function:
 * 1. Spawns the OpenCode server process
 * 2. Creates a client connected to the server
 * 3. Waits for the server to be ready
 * 4. Sets up authentication with the provided API key
 *
 * @param config - Client configuration
 * @returns The initialized client and server management functions
 * @throws {OpenCodeClientError} If initialization fails
 *
 * @example
 * ```ts
 * const { client, server } = await createOpenCodeClient({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   providerId: "anthropic",
 * });
 *
 * try {
 *   // Use the client for LLM operations
 *   const session = await client.session.create({ body: { title: "Analysis" } });
 *   // ...
 * } finally {
 *   // Always close the server when done
 *   server.close();
 * }
 * ```
 */
export async function createOpenCodeClientWithServer(
	config: OpenCodeClientConfig,
): Promise<OpenCodeClientResult> {
	const {
		apiKey,
		providerId,
		hostname = "127.0.0.1",
		port = 4096,
		timeout = 30000,
		retryInterval = 300,
		maxRetries = Math.floor(timeout / retryInterval),
	} = config;

	if (!apiKey) {
		throw new OpenCodeClientError("API key is required");
	}

	if (!providerId) {
		throw new OpenCodeClientError("Provider ID is required");
	}

	const serverUrl = `http://${hostname}:${port}`;

	// Spawn the server process
	const serverProcess = spawnOpenCodeServer(hostname, port);

	// Create the client
	const client = createOpencodeClient({ baseUrl: serverUrl });

	try {
		// Wait for server to be ready
		await waitForServerReady(client, maxRetries, retryInterval);

		// Set up authentication
		await setupAuthentication(client, providerId, apiKey);

		return {
			client,
			server: {
				url: serverUrl,
				close: () => serverProcess.kill(),
			},
		};
	} catch (error) {
		// Clean up on failure
		serverProcess.kill();

		if (error instanceof OpenCodeClientError) {
			throw error;
		}

		throw new OpenCodeClientError(
			"Failed to initialize OpenCode client",
			error,
		);
	}
}

/**
 * Create an OpenCode client from a model string.
 *
 * This is a convenience function that extracts the provider ID from the model
 * string and retrieves the appropriate API key from environment variables.
 *
 * @param model - Model string in format "provider/model" (e.g., "anthropic/claude-sonnet-4-20250514")
 * @param options - Additional client options
 * @returns The initialized client and server management functions
 * @throws {OpenCodeClientError} If initialization fails or API key is missing
 *
 * @example
 * ```ts
 * const { client, server } = await createOpenCodeClientFromModel(
 *   "anthropic/claude-sonnet-4-20250514"
 * );
 * ```
 */
export async function createOpenCodeClientFromModel(
	model: string,
	options?: Omit<OpenCodeClientConfig, "apiKey" | "providerId">,
): Promise<OpenCodeClientResult> {
	const providerId = getProviderIdFromModel(model);
	const apiKey = getApiKeyForProvider(providerId);

	return createOpenCodeClientWithServer({
		...options,
		apiKey,
		providerId,
	});
}
