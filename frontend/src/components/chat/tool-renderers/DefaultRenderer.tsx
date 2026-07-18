import type { ToolCallBlock, ToolResultBlock } from '@agentscope-ai/agentscope/message';
import type { ReactNode } from 'react';

import { capLines, resultToText } from './_shared';
import type { TFunction, ToolSection } from './types';

/** Compact one-line summary of a call's JSON input: `k: "v", k2: "v2"`. */
export function summarizeInput(input: string): string {
	try {
		const obj = JSON.parse(input);
		return Object.entries(obj)
			.map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`)
			.join(', ');
	} catch {
		return input;
	}
}

/** Pretty multi-line rendering of a call's JSON input, one entry per line. */
export function prettyInput(input: string): string {
	try {
		const obj = JSON.parse(input);
		return Object.entries(obj)
			.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
			.join('\n');
	} catch {
		return input;
	}
}

export function defaultGetDisplayName(call: ToolCallBlock): string {
	return call.name;
}

export function defaultRenderCallArgs(call: ToolCallBlock): ReactNode {
	if (call.input.length <= 2) return null;
	return summarizeInput(call.input);
}

/**
 * Default expanded body: the call's input and — once available — the
 * result text, each in its own labeled section. Non-success terminal
 * states collapse to a short status line; error output renders in
 * destructive color.
 */
export function defaultRenderSections(
	call: ToolCallBlock,
	result: ToolResultBlock | undefined,
	t: TFunction,
): ToolSection[] {
	const sections: ToolSection[] = [];
	const input = prettyInput(call.input);
	if (input.trim()) {
		sections.push({ label: t('tool.sections.input'), body: input });
	}
	if (!result || result.state === 'running') {
		return sections;
	}
	if (result.state === 'interrupted') {
		sections.push({ label: t('tool.sections.output'), body: t('common.interrupted') });
		return sections;
	}
	const output = resultToText(result);
	if (output.trim()) {
		sections.push({
			label: t('tool.sections.output'),
			body: capLines(output, t),
			error: result.state === 'error' || result.state === 'denied',
		});
	}
	return sections;
}

export function defaultRenderConfirmBody(call: ToolCallBlock): ReactNode {
	return (
		<div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
			<div className="text-secondary-foreground">{call.input}</div>
		</div>
	);
}
