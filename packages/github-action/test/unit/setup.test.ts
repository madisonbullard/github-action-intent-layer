import { describe, expect, test } from "bun:test";

describe("test setup", () => {
	test("bun test runner is configured correctly", () => {
		expect(true).toBe(true);
	});

	test("can perform basic assertions", () => {
		expect(2 + 2).toBe(4);
		expect("hello").toContain("ell");
		expect([1, 2, 3]).toHaveLength(3);
	});

	test("can handle async operations", async () => {
		const result = await Promise.resolve(42);
		expect(result).toBe(42);
	});
});
