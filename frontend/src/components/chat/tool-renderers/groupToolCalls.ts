import type { ContentBlock } from '@agentscope-ai/agentscope/message';

import type { ToolCallWithResult } from './types';

/**
 * A run of consecutive tool calls, each paired with its matching result.
 * Rendered as one collapsible "Tool calls · N steps" group (or, for a
 * single call, as one bare disclosure row).
 */
export interface ToolCallGroup {
	type: 'tool_call_group';
	/** Deterministic id derived from the first call — stable across renders. */
	id: string;
	calls: ToolCallWithResult[];
}

export type ExtendedContentBlock = ContentBlock | ToolCallGroup;

/** Aggregate status of a group of tool calls. */
export type ToolGroupStatus = 'running' | 'error' | 'interrupted' | 'success';

/**
 * Group consecutive tool_call blocks (paired with their tool_result by id)
 * into `tool_call_group` blocks; non-tool blocks keep their positions and
 * act as group boundaries.
 *
 * Grouping is by *adjacency only*, not by tool name: when the agent issues
 * concurrent calls (e.g. Glob + Grep), the content layout is
 * `[call_Glob, call_Grep, result_Glob, result_Grep]` and both calls belong
 * to the same activity group. Results are matched to calls by id
 * beforehand, so interleaved call/result layouts pair correctly.
 *
 * Orphan results (no matching call — e.g. history edge cases) are appended
 * as synthetic single-call groups with a `finished` placeholder call.
 */
export function groupToolCalls(content: ContentBlock[]): ExtendedContentBlock[] {
	// Pass 1: pair calls ↔ results by id, track ordering.
	const callMap = new Map<string, ToolCallWithResult>();
	const orphanResults: ToolCallWithResult[] = [];
	const ordering: Array<{ type: 'tool'; id: string } | { type: 'other'; block: ContentBlock }> =
		[];

	for (const block of content) {
		if (block.type === 'tool_call') {
			const entry: ToolCallWithResult = { call: block };
			callMap.set(block.id, entry);
			ordering.push({ type: 'tool', id: block.id });
		} else if (block.type === 'tool_result') {
			const matching = callMap.get(block.id);
			if (matching) {
				matching.result = block;
			} else {
				orphanResults.push({
					call: {
						type: 'tool_call',
						id: block.id,
						name: block.name,
						input: '',
						state: 'finished',
					},
					result: block,
				});
			}
		} else {
			ordering.push({ type: 'other', block });
		}
	}

	// Pass 2: walk the ordering, coalescing adjacent tool entries.
	const result: ExtendedContentBlock[] = [];
	let currentGroup: ToolCallWithResult[] = [];

	const flush = () => {
		if (currentGroup.length > 0) {
			result.push({
				type: 'tool_call_group',
				id: `group-${currentGroup[0].call.id}`,
				calls: currentGroup,
			});
			currentGroup = [];
		}
	};

	for (const item of ordering) {
		if (item.type === 'other') {
			flush();
			result.push(item.block);
		} else {
			const entry = callMap.get(item.id);
			if (entry) currentGroup.push(entry);
		}
	}
	flush();

	// Orphan results keep their relative order, appended at the end (their
	// original position is unknowable once the call is lost).
	for (const orphan of orphanResults) {
		result.push({
			type: 'tool_call_group',
			id: `group-orphan-${orphan.call.id}`,
			calls: [orphan],
		});
	}

	return result;
}

/** True while any call in the group is still awaiting its result. */
export function isGroupRunning(calls: ToolCallWithResult[]): boolean {
	// 与 callStatus 同理：只以结果状态为准，调用侧的
	// pending/allowed/submitted 在 TOOL_CALL_END 后不会被库更新。
	return calls.some(({ result }) => !result || result.state === 'running');
}

/**
 * Aggregate status for the group header glyph:
 * running > error > interrupted > success. A call still in `asking` state
 * counts as running (it blocks the pipeline on user input).
 */
export function groupStatus(calls: ToolCallWithResult[]): ToolGroupStatus {
	if (isGroupRunning(calls) || calls.some(({ call }) => call.state === 'asking')) {
		return 'running';
	}
	if (calls.some(({ result }) => result?.state === 'error' || result?.state === 'denied')) {
		return 'error';
	}
	if (calls.some(({ result }) => result?.state === 'interrupted')) {
		return 'interrupted';
	}
	return 'success';
}

/** Number of failed (error / denied) steps, for the group header summary. */
export function countFailed(calls: ToolCallWithResult[]): number {
	return calls.filter(
		({ result }) => result?.state === 'error' || result?.state === 'denied',
	).length;
}
