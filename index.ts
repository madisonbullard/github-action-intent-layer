/**
 * Intent Layer GitHub Action
 *
 * Main entry point for the GitHub Action. Orchestrates intent layer analysis
 * and checkbox handling based on the configured mode.
 *
 * Modes:
 * - analyze: Analyze PR changes and propose intent layer updates
 * - checkbox-handler: Handle checkbox toggles in PR comments
 */

import * as core from "@actions/core";
import { type ActionInputs, parseActionInputs } from "./src/config/schema";
import {
	debounceCheckboxToggle,
	handleCheckedCheckbox,
	handleUncheckedCheckbox,
	validateAndFailOnInsufficientHistory,
	validateCheckboxEvent,
} from "./src/github/checkbox-handler";
import { createGitHubClient, type GitHubClient } from "./src/github/client";
import {
	hasIntentLayerMarker,
	postIntentLayerLinkComment,
	resolveAndPostComments,
} from "./src/github/comments";
import {
	applyUpdatesToBranch,
	createIntentLayerBranch,
	openIntentLayerPullRequest,
} from "./src/github/commits";
import {
	extractLinkedIssues,
	extractPRCommits,
	extractPRDiff,
	extractPRMetadata,
	extractPRReviewComments,
	isPRTooLarge,
	type PRMetadata,
} from "./src/github/context";
import {
	determineNodesNeedingUpdate,
	filterSemanticBoundariesForInitialization,
	identifySemanticBoundaries,
	mapChangedFilesToNodes,
	type NodeUpdateCandidate,
	reviewParentNodes,
} from "./src/intent/analyzer";
import {
	detectIntentLayer,
	hasIntentLayer,
	validateSymlinkConfig,
} from "./src/intent/detector";
import { buildHierarchy } from "./src/intent/hierarchy";
import {
	createOpenCodeClientFromModel,
	type OpenCodeClientResult,
} from "./src/opencode/client";
import type { IntentUpdate, LLMOutput } from "./src/opencode/output-schema";
import {
	buildAnalysisPrompt,
	buildInitializationPrompt,
	type IntentContext,
	type NodeUpdateCandidateWithContent,
	type ParentNodeReviewCandidateWithContent,
	type PRContext,
	type PromptConfig,
} from "./src/opencode/prompts";
import {
	buildSessionTitle,
	checkAndHandleModelAccessError,
	createSessionFromModelString,
} from "./src/opencode/session";
import {
	type IntentLayerIgnore,
	parseIntentLayerIgnore,
} from "./src/patterns/ignore";
import { createPromptResolver } from "./src/patterns/prompts";

/**
 * Get action inputs from GitHub Actions environment.
 */
function getActionInputs(): Record<string, string | undefined> {
	return {
		mode: core.getInput("mode") || undefined,
		model: core.getInput("model") || undefined,
		files: core.getInput("files") || undefined,
		symlink: core.getInput("symlink") || undefined,
		symlink_source: core.getInput("symlink_source") || undefined,
		output: core.getInput("output") || undefined,
		new_nodes: core.getInput("new_nodes") || undefined,
		split_large_nodes: core.getInput("split_large_nodes") || undefined,
		token_budget_percent: core.getInput("token_budget_percent") || undefined,
		skip_binary_files: core.getInput("skip_binary_files") || undefined,
		file_max_lines: core.getInput("file_max_lines") || undefined,
		prompts: core.getInput("prompts") || undefined,
	};
}

/**
 * Fetch content for intent nodes that need updating.
 */
async function fetchNodeContents(
	client: GitHubClient,
	candidates: NodeUpdateCandidate[],
	ref: string,
): Promise<NodeUpdateCandidateWithContent[]> {
	const results: NodeUpdateCandidateWithContent[] = [];

	for (const candidate of candidates) {
		let currentContent = "";
		try {
			const fileData = await client.getFileContent(
				candidate.node.file.path,
				ref,
			);
			if (
				!Array.isArray(fileData) &&
				"content" in fileData &&
				fileData.content
			) {
				currentContent = Buffer.from(fileData.content, "base64").toString(
					"utf-8",
				);
			}
		} catch {
			// File might not exist, leave content empty
		}

		results.push({
			...candidate,
			currentContent,
		});
	}

	return results;
}

/**
 * Fetch content for parent nodes that might need review.
 */
async function fetchParentNodeContents(
	client: GitHubClient,
	candidates: ReturnType<typeof reviewParentNodes>["candidates"],
	ref: string,
): Promise<ParentNodeReviewCandidateWithContent[]> {
	const results: ParentNodeReviewCandidateWithContent[] = [];

	for (const candidate of candidates) {
		let currentContent = "";
		try {
			const fileData = await client.getFileContent(
				candidate.node.file.path,
				ref,
			);
			if (
				!Array.isArray(fileData) &&
				"content" in fileData &&
				fileData.content
			) {
				currentContent = Buffer.from(fileData.content, "base64").toString(
					"utf-8",
				);
			}
		} catch {
			// File might not exist, leave content empty
		}

		results.push({
			...candidate,
			currentContent,
		});
	}

	return results;
}

/**
 * Run the analyze mode to analyze PR changes and propose intent layer updates.
 */
async function runAnalyzeMode(
	client: GitHubClient,
	config: ActionInputs,
): Promise<void> {
	const pullNumber = client.pullRequestNumber;
	if (!pullNumber) {
		core.setFailed("Analyze mode requires a pull request context");
		return;
	}

	core.info(`Analyzing PR #${pullNumber} for intent layer updates`);

	// Step 1: Extract PR metadata and check size
	const prMetadata = await extractPRMetadata(client, pullNumber);
	const sizeCheck = isPRTooLarge(prMetadata);

	if (sizeCheck.isTooLarge) {
		core.info(sizeCheck.message);
		core.info("Skipping intent layer analysis for this large PR.");
		return;
	}

	// Step 2: Detect existing intent layer structure
	const ref = prMetadata.headBranch;
	const detectionResult = await detectIntentLayer(client, ref);
	const intentLayerExists = hasIntentLayer(detectionResult);

	core.info(
		intentLayerExists
			? `Found existing intent layer: ${detectionResult.agentsFiles.length} AGENTS.md, ${detectionResult.claudeFiles.length} CLAUDE.md files`
			: "No existing intent layer found in repository",
	);

	// Step 3: Validate symlink configuration
	if (config.symlink) {
		const symlinkValidation = validateSymlinkConfig(
			detectionResult,
			config.symlink,
		);
		if (!symlinkValidation.valid) {
			core.setFailed(symlinkValidation.error ?? "Symlink validation failed");
			return;
		}
	}

	// Step 4: Load ignore patterns
	let ignore: IntentLayerIgnore | undefined;
	try {
		const ignoreContent = await client.getFileContent(
			".intentlayerignore",
			ref,
		);
		if (
			!Array.isArray(ignoreContent) &&
			"content" in ignoreContent &&
			ignoreContent.content
		) {
			const ignoreText = Buffer.from(ignoreContent.content, "base64").toString(
				"utf-8",
			);
			ignore = parseIntentLayerIgnore(ignoreText);
		}
	} catch {
		// No .intentlayerignore file, use default (no ignores)
	}

	// Step 5: Extract PR context
	const [commits, linkedIssues, reviewComments, diff] = await Promise.all([
		extractPRCommits(client, pullNumber),
		extractLinkedIssues(client, pullNumber),
		extractPRReviewComments(client, pullNumber),
		extractPRDiff(client, pullNumber, { includeRawDiff: false }),
	]);

	// Step 6: Build hierarchy and analyze changes
	const fileType = config.files === "claude" ? "claude" : "agents";
	const files =
		fileType === "agents"
			? detectionResult.agentsFiles
			: detectionResult.claudeFiles;
	const hierarchy = buildHierarchy(files, fileType);

	const mapping = mapChangedFilesToNodes(diff, hierarchy, ignore);
	const directUpdates = determineNodesNeedingUpdate(mapping);
	const parentReview = reviewParentNodes(directUpdates);
	let semanticBoundaries = identifySemanticBoundaries(
		mapping,
		config.new_nodes,
		fileType,
	);

	// Filter semantic boundaries for initialization (only suggest root node)
	if (!intentLayerExists && semanticBoundaries.hasCandidates) {
		semanticBoundaries = filterSemanticBoundariesForInitialization(
			semanticBoundaries,
			fileType,
		);
	}

	// Step 7: If no updates needed and no new nodes suggested, we're done
	if (
		!directUpdates.hasUpdates &&
		!parentReview.hasRecommendedUpdates &&
		!semanticBoundaries.hasCandidates
	) {
		core.info("No intent layer updates needed for this PR.");
		return;
	}

	core.info(
		`Found ${directUpdates.totalNodes} nodes to update, ${parentReview.totalParentNodes} parent nodes to review, ${semanticBoundaries.totalCandidates} potential new nodes`,
	);

	// Step 8: Initialize OpenCode client
	let opencodeResult: OpenCodeClientResult;
	try {
		opencodeResult = await createOpenCodeClientFromModel(config.model);
	} catch (error) {
		checkAndHandleModelAccessError(error);
		throw error;
	}

	try {
		// Step 9: Create analysis session and build prompt
		const session = await createSessionFromModelString(
			opencodeResult.client,
			buildSessionTitle(pullNumber, client.repo.repo),
			config.model,
		);

		// Fetch content for nodes
		const nodesToUpdateWithContent = await fetchNodeContents(
			client,
			directUpdates.candidates,
			ref,
		);
		const parentNodesToReviewWithContent = await fetchParentNodeContents(
			client,
			parentReview.candidates,
			ref,
		);

		// Build prompt resolver from config
		const promptResolver = config.prompts
			? createPromptResolver(
					typeof config.prompts === "string" ? config.prompts : config.prompts,
				)
			: undefined;

		const prContext: PRContext = {
			metadata: prMetadata,
			commits,
			linkedIssues,
			reviewComments,
			changedFiles: diff.files,
		};

		const intentContext: IntentContext = {
			nodesToUpdate: nodesToUpdateWithContent,
			parentNodesToReview: parentNodesToReviewWithContent,
			potentialNewNodes: semanticBoundaries.candidates,
		};

		const promptConfig: PromptConfig = {
			fileType: config.files === "both" ? "both" : fileType,
			newNodesAllowed: config.new_nodes,
			splitLargeNodes: config.split_large_nodes,
			promptResolver,
		};

		// Build and send the analysis prompt
		let prompt: string;
		if (!intentLayerExists) {
			// No existing intent layer - use initialization prompt
			prompt = buildInitializationPrompt(
				prMetadata,
				diff.files,
				fileType,
				promptResolver,
			);
		} else {
			// Existing intent layer - use full analysis prompt
			prompt = buildAnalysisPrompt(prContext, intentContext, promptConfig);
		}

		// Step 10: Get LLM analysis
		let llmOutput: LLMOutput;
		try {
			core.info(
				`Sending prompt to LLM (prompt length: ${prompt.length} chars)...`,
			);
			const result = await session.prompt({ prompt });
			core.info(
				`LLM response received (raw length: ${result.rawResponse.length} chars)`,
			);
			core.debug(`Raw LLM response: ${result.rawResponse.substring(0, 500)}`);
			if (result.parsedOutput) {
				llmOutput = result.parsedOutput;
			} else {
				core.error(
					`LLM response parsing failed. Raw response (first 2000 chars): ${result.rawResponse.substring(0, 2000)}`,
				);
				throw new Error(
					`Invalid LLM output: ${result.parseError ?? "Unknown parse error"}`,
				);
			}
		} catch (error) {
			checkAndHandleModelAccessError(error);
			throw error;
		}

		// Clean up session
		await session.delete();

		// Step 11: Process LLM output
		const updates = llmOutput.updates;

		if (updates.length === 0) {
			core.info("LLM analysis complete: No updates suggested.");
			return;
		}

		core.info(`LLM suggested ${updates.length} intent layer updates`);

		// Add otherNodePath if managing both files
		const processedUpdates =
			config.files === "both"
				? updates.map((update) => ({
						...update,
						otherNodePath: update.nodePath.includes("AGENTS.md")
							? update.nodePath.replace("AGENTS.md", "CLAUDE.md")
							: update.nodePath.replace("CLAUDE.md", "AGENTS.md"),
					}))
				: updates;

		// Step 12: Output based on mode
		await handleOutput(client, processedUpdates, prMetadata, config);
	} finally {
		// Always close the OpenCode server
		opencodeResult.server.close();
	}
}

/**
 * Handle the output based on the configured output mode.
 */
async function handleOutput(
	client: GitHubClient,
	updates: IntentUpdate[],
	prMetadata: PRMetadata,
	config: ActionInputs,
): Promise<void> {
	const pullNumber = prMetadata.number;
	const headSha = prMetadata.headSha;
	const headBranch = prMetadata.headBranch;

	switch (config.output) {
		case "pr_comments": {
			// Post one comment per update with approval checkbox
			const result = await resolveAndPostComments(
				client,
				pullNumber,
				updates,
				headSha,
			);
			core.info(
				`Posted ${result.postedComments.length} comments, resolved ${result.resolvedComments.length} stale comments`,
			);
			break;
		}

		case "pr_commit": {
			// Apply all changes directly to the PR branch
			const commitResult = await applyUpdatesToBranch(client, updates, {
				branch: headBranch,
				symlink: config.symlink,
				symlinkSource: config.symlink_source,
			});

			if (commitResult.errors.length > 0) {
				core.warning(
					`Applied ${commitResult.appliedCount}/${commitResult.totalCount} updates. Errors:\n${commitResult.errors.map((e) => `  - ${e.update.nodePath}: ${e.error}`).join("\n")}`,
				);
			} else {
				core.info(
					`Applied all ${commitResult.appliedCount} intent layer updates to branch ${headBranch}`,
				);
			}
			break;
		}

		case "new_pr": {
			// Create a new branch and PR for intent layer updates
			const branchResult = await createIntentLayerBranch(
				client,
				pullNumber,
				headSha,
			);
			core.info(`Created branch ${branchResult.branchName}`);

			// Apply updates to the new branch
			const commitResult = await applyUpdatesToBranch(client, updates, {
				branch: branchResult.branchName,
				symlink: config.symlink,
				symlinkSource: config.symlink_source,
			});

			if (commitResult.appliedCount === 0) {
				core.warning("No updates were applied to the intent layer branch");
				return;
			}

			// Open a PR targeting the original PR's head branch
			const prResult = await openIntentLayerPullRequest(client, {
				originalPrNumber: pullNumber,
				originalPrHeadBranch: headBranch,
			});
			core.info(`Created intent layer PR #${prResult.number}: ${prResult.url}`);

			// Post a link comment on the original PR
			await postIntentLayerLinkComment(
				client,
				pullNumber,
				prResult.number,
				prResult.url,
				commitResult.appliedCount,
			);
			break;
		}
	}
}

/**
 * Run the checkbox-handler mode to process checkbox toggles in PR comments.
 */
async function runCheckboxHandlerMode(
	client: GitHubClient,
	config: ActionInputs,
): Promise<void> {
	// Validate git history for potential reverts
	await validateAndFailOnInsufficientHistory();

	// Validate event context
	const eventPayload = client.context.payload as Record<string, unknown>;
	const checkboxContext = validateCheckboxEvent(eventPayload);

	if (!checkboxContext) {
		core.info("Event is not a valid checkbox event, skipping");
		return;
	}

	if (!checkboxContext.isPullRequest) {
		core.info("Comment is not on a pull request, skipping");
		return;
	}

	// Check if this is an intent layer comment
	if (!hasIntentLayerMarker(checkboxContext.commentBody)) {
		core.info("Comment does not contain intent layer marker, skipping");
		return;
	}

	core.info(
		`Processing checkbox event for comment ${checkboxContext.commentId} on PR #${checkboxContext.issueNumber}`,
	);

	// Debounce to ensure stable state
	const debounceResult = await debounceCheckboxToggle(
		client,
		checkboxContext.commentId,
		checkboxContext.commentBody,
	);

	if (!debounceResult.stable) {
		core.info(`Checkbox state not stable: ${debounceResult.reason}`);
		return;
	}

	// Get current PR info for validation
	const prMetadata = await extractPRMetadata(
		client,
		checkboxContext.issueNumber,
	);

	if (!debounceResult.markerData || !debounceResult.commentBody) {
		core.setFailed("Failed to parse comment marker data or comment body");
		return;
	}

	// Handle based on checkbox state
	if (debounceResult.isChecked) {
		core.info(
			`Checkbox checked, applying change for ${debounceResult.markerData.nodePath}`,
		);
		const result = await handleCheckedCheckbox(
			client,
			checkboxContext.commentId,
			debounceResult.commentBody,
			debounceResult.markerData,
			prMetadata.headSha,
			{
				branch: prMetadata.headBranch,
				symlink: config.symlink,
				symlinkSource: config.symlink_source,
			},
		);

		if (result.success) {
			core.info(`Successfully applied change: ${result.commitResult?.sha}`);
		} else if (result.markedAsResolved) {
			core.info(`Comment marked as resolved: ${result.error}`);
		} else {
			core.setFailed(`Failed to apply change: ${result.error}`);
		}
	} else {
		core.info(
			`Checkbox unchecked, reverting change for ${debounceResult.markerData.nodePath}`,
		);
		const result = await handleUncheckedCheckbox(
			client,
			checkboxContext.commentId,
			debounceResult.commentBody,
			debounceResult.markerData,
			{
				branch: prMetadata.headBranch,
				symlink: config.symlink,
				symlinkSource: config.symlink_source,
			},
		);

		if (result.success) {
			if (result.skipped) {
				core.info("No prior commit to revert, skipping");
			} else {
				core.info(`Successfully reverted change: ${result.commitResult?.sha}`);
			}
		} else {
			core.setFailed(`Failed to revert change: ${result.error}`);
		}
	}
}

/**
 * Main entry point for the GitHub Action.
 */
async function run(): Promise<void> {
	try {
		// Parse and validate inputs
		const rawInputs = getActionInputs();
		const config = parseActionInputs(rawInputs);

		core.info(`Running Intent Layer Action in ${config.mode} mode`);
		core.debug(`Configuration: ${JSON.stringify(config, null, 2)}`);

		// Create GitHub client
		const client = createGitHubClient();

		// Route based on mode
		switch (config.mode) {
			case "analyze":
				await runAnalyzeMode(client, config);
				break;

			case "checkbox-handler":
				await runCheckboxHandlerMode(client, config);
				break;

			default:
				core.setFailed(`Unknown mode: ${config.mode}`);
		}
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(error.message);
			if (error.stack) {
				core.debug(error.stack);
			}
		} else {
			core.setFailed(String(error));
		}
	}
}

// Run the action
run();
