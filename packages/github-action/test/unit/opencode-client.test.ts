/**
 * Unit tests for OpenCode SDK client
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getApiKeyForProvider,
	getProviderIdFromModel,
	OpenCodeClientError,
} from "../../src/opencode/client";

describe("OpenCode Client", () => {
	describe("getProviderIdFromModel", () => {
		test("extracts anthropic from standard model string", () => {
			expect(getProviderIdFromModel("anthropic/claude-sonnet-4-20250514")).toBe(
				"anthropic",
			);
		});

		test("extracts openrouter from openrouter model string", () => {
			expect(
				getProviderIdFromModel("openrouter/anthropic/claude-sonnet-4-20250514"),
			).toBe("openrouter");
		});

		test("extracts provider from various model formats", () => {
			expect(getProviderIdFromModel("openai/gpt-4")).toBe("openai");
			expect(getProviderIdFromModel("google/gemini-pro")).toBe("google");
			expect(getProviderIdFromModel("mistral/mistral-large")).toBe("mistral");
		});

		test("throws on empty model string", () => {
			expect(() => getProviderIdFromModel("")).toThrow(OpenCodeClientError);
		});

		test("throws on model string without provider", () => {
			expect(() => getProviderIdFromModel("/model-name")).toThrow(
				OpenCodeClientError,
			);
		});
	});

	describe("getApiKeyForProvider", () => {
		const originalEnv = { ...process.env };

		beforeEach(() => {
			// Clear relevant env vars before each test
			delete process.env.ANTHROPIC_API_KEY;
			delete process.env.OPENROUTER_API_KEY;
			delete process.env.OPENAI_API_KEY;
		});

		afterEach(() => {
			// Restore original env vars
			process.env = { ...originalEnv };
		});

		test("returns ANTHROPIC_API_KEY for anthropic provider", () => {
			process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
			expect(getApiKeyForProvider("anthropic")).toBe("test-anthropic-key");
		});

		test("returns OPENROUTER_API_KEY for openrouter provider", () => {
			process.env.OPENROUTER_API_KEY = "test-openrouter-key";
			expect(getApiKeyForProvider("openrouter")).toBe("test-openrouter-key");
		});

		test("returns PROVIDER_API_KEY for other providers", () => {
			process.env.OPENAI_API_KEY = "test-openai-key";
			expect(getApiKeyForProvider("openai")).toBe("test-openai-key");
		});

		test("throws when ANTHROPIC_API_KEY is missing", () => {
			expect(() => getApiKeyForProvider("anthropic")).toThrow(
				OpenCodeClientError,
			);
			expect(() => getApiKeyForProvider("anthropic")).toThrow(
				"ANTHROPIC_API_KEY environment variable is required",
			);
		});

		test("throws when OPENROUTER_API_KEY is missing", () => {
			expect(() => getApiKeyForProvider("openrouter")).toThrow(
				OpenCodeClientError,
			);
			expect(() => getApiKeyForProvider("openrouter")).toThrow(
				"OPENROUTER_API_KEY environment variable is required",
			);
		});

		test("throws when generic PROVIDER_API_KEY is missing", () => {
			expect(() => getApiKeyForProvider("mistral")).toThrow(
				OpenCodeClientError,
			);
			expect(() => getApiKeyForProvider("mistral")).toThrow(
				"MISTRAL_API_KEY environment variable is required",
			);
		});
	});

	describe("OpenCodeClientError", () => {
		test("creates error with message", () => {
			const error = new OpenCodeClientError("test message");
			expect(error.message).toBe("test message");
			expect(error.name).toBe("OpenCodeClientError");
			expect(error.originalCause).toBeUndefined();
		});

		test("creates error with message and cause", () => {
			const cause = new Error("underlying error");
			const error = new OpenCodeClientError("test message", cause);
			expect(error.message).toBe("test message");
			expect(error.name).toBe("OpenCodeClientError");
			expect(error.originalCause).toBe(cause);
		});

		test("is instanceof Error", () => {
			const error = new OpenCodeClientError("test");
			expect(error instanceof Error).toBe(true);
			expect(error instanceof OpenCodeClientError).toBe(true);
		});
	});
});
