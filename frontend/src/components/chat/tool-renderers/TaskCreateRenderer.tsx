import { parseInput } from './_fileSections';
import type { ToolRenderer, ToolSection } from './types';

export const TaskCreateRenderer: ToolRenderer = {
	getDisplayName: (_call, t) => t('tool.taskCreate.name'),

	renderCallArgs: (call) => {
		const input = parseInput(call.input);
		return (input.subject as string) || '';
	},

	renderSections: (call, _result, t): ToolSection[] => {
		const input = parseInput(call.input);
		const subject = (input.subject as string) || '';
		const description = (input.description as string) || '';
		const sections: ToolSection[] = [
			{ label: t('tool.sections.task'), body: subject, mono: false },
		];
		if (description) {
			sections.push({ label: t('tool.sections.description'), body: description, mono: false });
		}
		return sections;
	},
};
