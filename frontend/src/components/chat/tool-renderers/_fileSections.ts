import { capLines, resultToText } from './_shared';
import type { ToolRenderer, ToolSection } from './types';

function parseInput(input: string): Record<string, unknown> {
	try {
		return JSON.parse(input);
	} catch {
		return {};
	}
}

function getFilePath(input: string): string {
	const { file_path } = parseInput(input) as { file_path?: string };
	return file_path || input;
}

/** Sections for file-oriented tools: the target path + the result text. */
export function fileSections(
	call: { input: string },
	result: Parameters<NonNullable<ToolRenderer['renderSections']>>[1],
	t: Parameters<NonNullable<ToolRenderer['renderSections']>>[2],
): ToolSection[] {
	const sections: ToolSection[] = [
		{ label: t('tool.sections.file'), body: getFilePath(call.input) },
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

export { getFilePath, parseInput };
