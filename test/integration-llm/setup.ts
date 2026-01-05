/**
 * Setup helpers for real LLM integration tests.
 *
 * This module provides utilities for running integration tests against actual
 * LLM APIs (Anthropic, OpenRouter, etc.). These tests should ONLY be run
 * manually or via CI with explicit opt-in.
 *
 * IMPORTANT: These tests make real API calls and incur costs.
 * Always be mindful of API usage limits and billing.
 *
 * Required Environment Variables:
 * - ANTHROPIC_API_KEY: For direct Anthropic API access
 * - OPENROUTER_API_KEY: For OpenRouter API access (optional alternative)
 *
 * Test Strategy:
 * - Use minimal token inputs to reduce cost
 * - Validate output schema conformance
 * - Test error handling (rate limits, invalid keys, etc.)
 * - Test model switching behavior
 *
 * TODO: Implement the following:
 *
 * 1. Client Setup
 *    - createTestOpenCodeClient(options): Promise<OpenCodeClientResult>
 *    - Wrapper that handles server lifecycle for tests
 *
 * 2. Test Fixtures
 *    - generateMinimalPRContext(): PRContext
 *    - generateMinimalIntentLayerContext(): IntentLayerContext
 *    - These should use minimal tokens while still being valid
 *
 * 3. Response Validation
 *    - validateLLMResponse(response): ValidationResult
 *    - verifyOutputSchemaConformance(output): boolean
 *
 * 4. Error Simulation Helpers
 *    - testInvalidApiKey(): Promise<ModelAccessError>
 *    - testRateLimiting(): Promise<ModelAccessError> (may require many calls)
 *
 * 5. Cost Tracking (optional)
 *    - estimateTokenUsage(prompt: string): number
 *    - trackTestCosts(testName: string, tokens: number): void
 *
 * Example usage (future):
 *
 * ```typescript
 * import { describe, test, afterAll } from 'bun:test';
 * import { createTestOpenCodeClient, generateMinimalPRContext } from './setup';
 *
 * describe('Real LLM Integration', () => {
 *   let clientResult: OpenCodeClientResult;
 *
 *   afterAll(() => {
 *     // Always cleanup server
 *     clientResult?.server.close();
 *   });
 *
 *   test('analyzes PR changes with real LLM', async () => {
 *     if (shouldSkipRealTests()) return;
 *
 *     clientResult = await createTestOpenCodeClient();
 *     const session = await createSessionFromModelString(
 *       clientResult.client,
 *       'Test Session',
 *       'anthropic/claude-sonnet-4-20250514'
 *     );
 *
 *     const context = generateMinimalPRContext();
 *     const result = await session.promptForOutput({
 *       prompt: buildAnalysisPrompt(context, minimalIntentContext, config),
 *     });
 *
 *     expect(result.updates).toBeDefined();
 *     // Validate output conforms to schema
 *   });
 * });
 * ```
 */

import type { OpenCodeClientResult } from "../../src/opencode/client";

/**
 * Configuration for real LLM tests.
 */
export interface RealLLMTestConfig {
	/** Anthropic API key (if using direct Anthropic) */
	anthropicApiKey?: string;
	/** OpenRouter API key (if using OpenRouter) */
	openRouterApiKey?: string;
	/** Default model to use for tests */
	defaultModel: string;
	/** Maximum tokens to use per test (cost control) */
	maxTokensPerTest?: number;
}

/**
 * Get test configuration from environment.
 * Throws if no valid API key is found.
 */
export function getTestConfig(): RealLLMTestConfig {
	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
	const openRouterApiKey = process.env.OPENROUTER_API_KEY;

	if (!anthropicApiKey && !openRouterApiKey) {
		throw new Error(
			"Either ANTHROPIC_API_KEY or OPENROUTER_API_KEY environment variable is required for real LLM tests",
		);
	}

	// Prefer Anthropic if available, otherwise use OpenRouter
	const defaultModel = anthropicApiKey
		? "anthropic/claude-sonnet-4-20250514"
		: "openrouter/anthropic/claude-sonnet-4.5";

	return {
		anthropicApiKey,
		openRouterApiKey,
		defaultModel,
		maxTokensPerTest: Number(process.env.TEST_MAX_TOKENS) || 4096,
	};
}

/**
 * Check if we're running in CI environment.
 */
export function isCI(): boolean {
	return process.env.CI === "true";
}

/**
 * Skip test if not explicitly opted in.
 * Real LLM tests should only run when explicitly requested.
 */
export function shouldSkipRealTests(): boolean {
	// In CI, check for explicit opt-in via workflow_dispatch input
	if (isCI()) {
		return process.env.RUN_LLM_TESTS !== "true";
	}

	// Locally, check for explicit opt-in
	return process.env.RUN_REAL_LLM_TESTS !== "true";
}

/**
 * Get a message explaining why tests are being skipped.
 */
export function getSkipReason(): string {
	if (isCI()) {
		return "Real LLM tests are disabled in CI. Enable with RUN_LLM_TESTS=true via workflow_dispatch.";
	}
	return "Real LLM tests are disabled locally. Enable with RUN_REAL_LLM_TESTS=true.";
}

// =============================================================================
// TODO: Implement the functions below
// =============================================================================

/**
 * Create an OpenCode client for testing.
 *
 * TODO: Implement wrapper around createOpenCodeClientFromModel that:
 * 1. Handles server lifecycle
 * 2. Uses test-appropriate timeouts
 * 3. Provides better error messages for test failures
 *
 * @param model - Optional model override
 * @returns OpenCode client result with server management
 */
export async function createTestOpenCodeClient(
	_model?: string,
): Promise<OpenCodeClientResult> {
	throw new Error("Not implemented yet. See TODO comments for implementation.");
}

/**
 * Minimal PR context for cost-effective testing.
 *
 * TODO: Implement minimal fixture that:
 * 1. Uses smallest possible diff
 * 2. Has minimal file list
 * 3. Still triggers valid LLM analysis
 */
export interface MinimalPRContext {
	title: string;
	body: string;
	diff: string;
	files: string[];
}

/**
 * Generate minimal PR context for testing.
 *
 * TODO: Implement with minimal token usage
 */
export function generateMinimalPRContext(): MinimalPRContext {
	throw new Error("Not implemented yet. See TODO comments for implementation.");
}

/**
 * Minimal intent layer context for testing.
 */
export interface MinimalIntentLayerContext {
	rootContent: string;
	existingNodes: Array<{ path: string; content: string }>;
}

/**
 * Generate minimal intent layer context for testing.
 *
 * TODO: Implement with minimal content
 */
export function generateMinimalIntentLayerContext(): MinimalIntentLayerContext {
	throw new Error("Not implemented yet. See TODO comments for implementation.");
}

/**
 * Validation result for LLM responses.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validate an LLM response against expected schema.
 *
 * TODO: Implement validation that:
 * 1. Checks output schema conformance
 * 2. Validates node paths are reasonable
 * 3. Checks for required fields
 *
 * @param response - Raw LLM response
 * @returns Validation result
 */
export function validateLLMResponse(_response: unknown): ValidationResult {
	throw new Error("Not implemented yet. See TODO comments for implementation.");
}

/**
 * Test that invalid API key produces appropriate error.
 *
 * TODO: Implement test helper that:
 * 1. Attempts to create client with invalid key
 * 2. Verifies ModelAccessError is thrown
 * 3. Returns the error for assertion
 */
export async function testInvalidApiKey(): Promise<Error> {
	throw new Error("Not implemented yet. See TODO comments for implementation.");
}

/**
 * Simple token estimation for cost tracking.
 *
 * TODO: Implement rough estimation based on:
 * 1. Character count / 4 (rough GPT tokenization)
 * 2. Or use tiktoken for accurate Claude estimation
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
	// Rough estimation: ~4 characters per token
	return Math.ceil(text.length / 4);
}

/**
 * Track test costs (optional, for monitoring API usage).
 *
 * TODO: Implement cost tracking that:
 * 1. Logs token usage per test
 * 2. Optionally writes to a summary file
 * 3. Warns if approaching budget limits
 */
export function trackTestCost(
	_testName: string,
	_inputTokens: number,
	_outputTokens: number,
): void {
	// No-op for now, will implement if needed
}
