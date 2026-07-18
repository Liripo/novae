import { capLines, resultToText } from './_shared';
import { parseInput } from './_fileSections';
import type { ToolRenderer, ToolSection } from './types';

function getPattern(input: string): string {
	const { pattern } = parseInput(input) as { pattern?: string };
	return pattern || input;
}

/** Sections for pattern-oriented tools (Glob / Grep): pattern + matches. */
function patternSections(
	call: { input: string },
	result: Parameters<NonNullable<ToolRenderer['renderSections']>>[1],
	t: Parameters<NonNullable<ToolRenderer['renderSections']>>[2],
): ToolSection[] {
	const sections: ToolSection[] = [
		{ label: t('tool.sections.pattern'), body: getPattern(call.input) },
	];
	if (!result || result.state === 'running') return sections;
	if (result.state === 'interrupted') {
		return [...sections, { label: t('tool.sections.output'), body: t('common.interrupted') }];
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

export { getPattern, patternSections };
