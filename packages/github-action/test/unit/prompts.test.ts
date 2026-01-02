import { describe, expect, test } from "bun:test";
import type { PromptConfig } from "../../src/config/schema";
import {
	calculatePatternSpecificity,
	createPromptResolver,
	PatternMatchedPromptResolver,
	parsePromptsYaml,
} from "../../src/patterns/prompts";

describe("calculatePatternSpecificity", () => {
	test("scores exact paths higher than wildcards", () => {
		const exactPath = calculatePatternSpecificity("packages/api/src/index.ts");
		const wildcardPath = calculatePatternSpecificity("packages/api/src/*.ts");
		const doubleWildcard = calculatePatternSpecificity("packages/api/**/*.ts");

		expect(exactPath).toBeGreaterThan(wildcardPath);
		expect(wildcardPath).toBeGreaterThan(doubleWildcard);
	});

	test("scores deeper paths higher than shallow paths", () => {
		const deep = calculatePatternSpecificity("packages/api/src/handlers/*.ts");
		const shallow = calculatePatternSpecificity("packages/*.ts");

		expect(deep).toBeGreaterThan(shallow);
	});

	test("scores ** patterns lowest", () => {
		const doubleWildcard = calculatePatternSpecificity("**/*");
		const singleWildcard = calculatePatternSpecificity("src/*");
		const exact = calculatePatternSpecificity("src/index.ts");

		expect(exact).toBeGreaterThan(singleWildcard);
		expect(singleWildcard).toBeGreaterThan(doubleWildcard);
	});

	test("scores patterns starting with **/ lower", () => {
		const startsWithDouble = calculatePatternSpecificity("**/test/*.ts");
		const specific = calculatePatternSpecificity("packages/test/*.ts");

		expect(specific).toBeGreaterThan(startsWithDouble);
	});

	test("scores file extension patterns appropriately", () => {
		const withExt = calculatePatternSpecificity("**/*.test.ts");
		const noExt = calculatePatternSpecificity("**/*");

		expect(withExt).toBeGreaterThan(noExt);
	});

	test("handles empty pattern", () => {
		const score = calculatePatternSpecificity("");
		expect(typeof score).toBe("number");
	});

	test("handles single segment patterns", () => {
		const exact = calculatePatternSpecificity("README.md");
		const wildcard = calculatePatternSpecificity("*.md");

		expect(exact).toBeGreaterThan(wildcard);
	});
});

describe("parsePromptsYaml", () => {
	test("parses valid YAML array", () => {
		const yaml = `
- pattern: "**/*"
  prompt: "General guidance"
- pattern: "src/**/*.ts"
  agents_prompt: "TypeScript guidance"
`;
		const result = parsePromptsYaml(yaml);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			pattern: "**/*",
			prompt: "General guidance",
		});
		expect(result[1]).toEqual({
			pattern: "src/**/*.ts",
			agents_prompt: "TypeScript guidance",
		});
	});

	test("parses YAML with prompts key", () => {
		const yaml = `
prompts:
  - pattern: "**/*.ts"
    prompt: "TypeScript files"
`;
		const result = parsePromptsYaml(yaml);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			pattern: "**/*.ts",
			prompt: "TypeScript files",
		});
	});

	test("parses config with all prompt types", () => {
		const yaml = `
- pattern: "packages/api/**"
  prompt: "General API guidance"
  agents_prompt: "AGENTS.md specific"
  claude_prompt: "CLAUDE.md specific"
`;
		const result = parsePromptsYaml(yaml);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			pattern: "packages/api/**",
			prompt: "General API guidance",
			agents_prompt: "AGENTS.md specific",
			claude_prompt: "CLAUDE.md specific",
		});
	});

	test("returns empty array for empty string", () => {
		expect(parsePromptsYaml("")).toEqual([]);
		expect(parsePromptsYaml("   ")).toEqual([]);
		expect(parsePromptsYaml("\n\n")).toEqual([]);
	});

	test("returns empty array for null YAML", () => {
		expect(parsePromptsYaml("null")).toEqual([]);
		expect(parsePromptsYaml("~")).toEqual([]);
	});

	test("throws for missing pattern field", () => {
		const yaml = `
- prompt: "No pattern specified"
`;
		expect(() => parsePromptsYaml(yaml)).toThrow(
			"missing or invalid 'pattern' field",
		);
	});

	test("throws for missing all prompt fields", () => {
		const yaml = `
- pattern: "**/*"
`;
		expect(() => parsePromptsYaml(yaml)).toThrow(
			"must provide at least one of 'prompt', 'agents_prompt', or 'claude_prompt'",
		);
	});

	test("throws for non-string prompt value", () => {
		const yaml = `
- pattern: "**/*"
  prompt: 123
`;
		expect(() => parsePromptsYaml(yaml)).toThrow("'prompt' must be a string");
	});

	test("throws for invalid structure", () => {
		const yaml = "just a string";
		expect(() => parsePromptsYaml(yaml)).toThrow(
			"Invalid prompts configuration",
		);
	});
});

describe("PatternMatchedPromptResolver", () => {
	describe("constructor", () => {
		test("creates empty resolver by default", () => {
			const resolver = new PatternMatchedPromptResolver();
			expect(resolver.hasPatterns()).toBe(false);
			expect(resolver.getPatternCount()).toBe(0);
		});

		test("accepts initial configs", () => {
			const configs: PromptConfig[] = [{ pattern: "**/*", prompt: "General" }];
			const resolver = new PatternMatchedPromptResolver(configs);
			expect(resolver.hasPatterns()).toBe(true);
			expect(resolver.getPatternCount()).toBe(1);
		});
	});

	describe("addConfigs", () => {
		test("adds configs and supports chaining", () => {
			const resolver = new PatternMatchedPromptResolver()
				.addConfigs([{ pattern: "**/*", prompt: "One" }])
				.addConfigs([{ pattern: "src/**", prompt: "Two" }]);

			expect(resolver.getPatternCount()).toBe(2);
		});
	});

	describe("addFromYaml", () => {
		test("parses and adds configs from YAML", () => {
			const yaml = `
- pattern: "**/*"
  prompt: "General"
`;
			const resolver = new PatternMatchedPromptResolver().addFromYaml(yaml);

			expect(resolver.hasPatterns()).toBe(true);
			expect(resolver.getPatternCount()).toBe(1);
		});

		test("supports chaining", () => {
			const resolver = new PatternMatchedPromptResolver()
				.addFromYaml('- pattern: "**/*"\n  prompt: "One"')
				.addFromYaml('- pattern: "src/**"\n  prompt: "Two"');

			expect(resolver.getPatternCount()).toBe(2);
		});
	});

	describe("resolve", () => {
		test("returns null when no patterns configured", () => {
			const resolver = new PatternMatchedPromptResolver();
			expect(resolver.resolve("src/index.ts")).toBeNull();
		});

		test("returns null when no patterns match", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "test/**", prompt: "Test files" },
			]);
			expect(resolver.resolve("src/index.ts")).toBeNull();
		});

		test("returns matching prompt for simple pattern", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "**/*", prompt: "All files" },
			]);
			const result = resolver.resolve("src/index.ts");

			expect(result).not.toBeNull();
			expect(result?.pattern).toBe("**/*");
			expect(result?.prompt).toBe("All files");
		});

		test("selects most specific pattern when multiple match", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "**/*", prompt: "General" },
				{ pattern: "src/**", prompt: "Source files" },
				{ pattern: "src/api/**", prompt: "API source" },
				{ pattern: "src/api/handlers/*.ts", prompt: "API handlers" },
			]);

			const result = resolver.resolve("src/api/handlers/user.ts");

			expect(result).not.toBeNull();
			expect(result?.pattern).toBe("src/api/handlers/*.ts");
			expect(result?.prompt).toBe("API handlers");
		});

		test("prefers exact matches over wildcards", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "**/*.config.ts", prompt: "Config files" },
				{ pattern: "tsconfig.json", prompt: "TypeScript config" },
			]);

			const result = resolver.resolve("tsconfig.json");

			expect(result?.pattern).toBe("tsconfig.json");
			expect(result?.prompt).toBe("TypeScript config");
		});

		test("returns all prompt types when present", () => {
			const resolver = new PatternMatchedPromptResolver([
				{
					pattern: "**/*",
					prompt: "General",
					agents_prompt: "For agents",
					claude_prompt: "For claude",
				},
			]);

			const result = resolver.resolve("any/file.ts");

			expect(result?.prompt).toBe("General");
			expect(result?.agents_prompt).toBe("For agents");
			expect(result?.claude_prompt).toBe("For claude");
		});

		test("matches dotfiles", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "**/*", prompt: "All files" },
			]);

			expect(resolver.resolve(".gitignore")).not.toBeNull();
			expect(resolver.resolve(".env.local")).not.toBeNull();
		});

		test("matches nested paths", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "packages/*/src/**/*.ts", prompt: "Package source" },
			]);

			const result = resolver.resolve("packages/api/src/handlers/user.ts");
			expect(result?.prompt).toBe("Package source");
		});
	});

	describe("getPromptForFile", () => {
		test("returns null when no match", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "test/**", prompt: "Test files" },
			]);

			expect(resolver.getPromptForFile("src/index.ts", "agents")).toBeNull();
		});

		test("returns general prompt when type-specific not provided", () => {
			const resolver = new PatternMatchedPromptResolver([
				{ pattern: "**/*", prompt: "General guidance" },
			]);

			expect(resolver.getPromptForFile("src/index.ts", "agents")).toBe(
				"General guidance",
			);
			expect(resolver.getPromptForFile("src/index.ts", "claude")).toBe(
				"General guidance",
			);
		});

		test("returns type-specific prompt for agents", () => {
			const resolver = new PatternMatchedPromptResolver([
				{
					pattern: "**/*",
					prompt: "General",
					agents_prompt: "Agents specific",
				},
			]);

			expect(resolver.getPromptForFile("src/index.ts", "agents")).toBe(
				"Agents specific",
			);
		});

		test("returns type-specific prompt for claude", () => {
			const resolver = new PatternMatchedPromptResolver([
				{
					pattern: "**/*",
					prompt: "General",
					claude_prompt: "Claude specific",
				},
			]);

			expect(resolver.getPromptForFile("src/index.ts", "claude")).toBe(
				"Claude specific",
			);
		});

		test("falls back to general prompt when type-specific missing", () => {
			const resolver = new PatternMatchedPromptResolver([
				{
					pattern: "**/*",
					prompt: "General",
					agents_prompt: "Agents only",
				},
			]);

			// agents has specific, claude falls back to general
			expect(resolver.getPromptForFile("src/index.ts", "agents")).toBe(
				"Agents only",
			);
			expect(resolver.getPromptForFile("src/index.ts", "claude")).toBe(
				"General",
			);
		});

		test("returns null when only other type-specific prompt exists", () => {
			const resolver = new PatternMatchedPromptResolver([
				{
					pattern: "**/*",
					agents_prompt: "Agents only",
				},
			]);

			expect(resolver.getPromptForFile("src/index.ts", "agents")).toBe(
				"Agents only",
			);
			expect(resolver.getPromptForFile("src/index.ts", "claude")).toBeNull();
		});
	});
});

describe("createPromptResolver", () => {
	test("creates empty resolver for undefined input", () => {
		const resolver = createPromptResolver(undefined);
		expect(resolver.hasPatterns()).toBe(false);
	});

	test("creates resolver from YAML string", () => {
		const yaml = `
- pattern: "**/*"
  prompt: "General"
`;
		const resolver = createPromptResolver(yaml);
		expect(resolver.hasPatterns()).toBe(true);
		expect(resolver.getPatternCount()).toBe(1);
	});

	test("creates resolver from PromptConfig array", () => {
		const configs: PromptConfig[] = [
			{ pattern: "**/*", prompt: "General" },
			{ pattern: "src/**", prompt: "Source" },
		];
		const resolver = createPromptResolver(configs);
		expect(resolver.getPatternCount()).toBe(2);
	});

	test("creates empty resolver for empty string", () => {
		const resolver = createPromptResolver("");
		expect(resolver.hasPatterns()).toBe(false);
	});

	test("creates empty resolver for empty array", () => {
		const resolver = createPromptResolver([]);
		expect(resolver.hasPatterns()).toBe(false);
	});
});

describe("most specific pattern wins (integration)", () => {
	test("PLAN.md example: packages/api/** is more specific than **/*", () => {
		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "**/*", prompt: "General guidance for all files..." },
			{
				pattern: "packages/api/**",
				agents_prompt: "API-specific guidance for AGENTS.md...",
				claude_prompt: "API-specific guidance for CLAUDE.md...",
			},
		]);

		// File in packages/api should get API-specific prompt
		const apiResult = resolver.resolve("packages/api/src/handlers/user.ts");
		expect(apiResult?.pattern).toBe("packages/api/**");
		expect(apiResult?.agents_prompt).toBe(
			"API-specific guidance for AGENTS.md...",
		);

		// File outside packages/api should get general prompt
		const otherResult = resolver.resolve("packages/web/src/App.tsx");
		expect(otherResult?.pattern).toBe("**/*");
		expect(otherResult?.prompt).toBe("General guidance for all files...");
	});

	test("test file pattern example from PLAN.md", () => {
		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "**/*", prompt: "General" },
			{
				pattern: "**/*.test.ts",
				prompt: "Test files should not have their own intent nodes...",
			},
		]);

		const testResult = resolver.resolve("src/utils/helper.test.ts");
		expect(testResult?.pattern).toBe("**/*.test.ts");
		expect(testResult?.prompt).toBe(
			"Test files should not have their own intent nodes...",
		);

		const srcResult = resolver.resolve("src/utils/helper.ts");
		expect(srcResult?.pattern).toBe("**/*");
	});

	test("complex hierarchy: deeper paths win", () => {
		const resolver = new PatternMatchedPromptResolver([
			{ pattern: "**/*", prompt: "L0" },
			{ pattern: "packages/**", prompt: "L1" },
			{ pattern: "packages/api/**", prompt: "L2" },
			{ pattern: "packages/api/src/**", prompt: "L3" },
			{ pattern: "packages/api/src/handlers/**", prompt: "L4" },
		]);

		expect(resolver.resolve("README.md")?.prompt).toBe("L0");
		expect(resolver.resolve("packages/web/index.ts")?.prompt).toBe("L1");
		expect(resolver.resolve("packages/api/README.md")?.prompt).toBe("L2");
		expect(resolver.resolve("packages/api/src/index.ts")?.prompt).toBe("L3");
		expect(resolver.resolve("packages/api/src/handlers/user.ts")?.prompt).toBe(
			"L4",
		);
	});
});
