import { capLines, resultToText } from './_shared';
import type { ToolRenderer, ToolSection } from './types';

function parseInput(input: string): Record<string, unknown> {
	try {
		return JSON.parse(input);
	} catch {
		return {};
	}
}

export const BashRenderer: ToolRenderer = {
	getDisplayName: () => 'Bash',

	renderCallArgs: (call) => {
		const { command } = parseInput(call.input) as { command?: string };
		return command || call.input;
	},

	renderSections: (call, result, t) => {
		const { command } = parseInput(call.input) as { command?: string };
		const sections: ToolSection[] = [
			{ label: t('tool.sections.command'), body: command || call.input },
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
	},

	renderConfirmBody: (call) => {
		const { command, description } = parseInput(call.input) as {
			command?: string;
			description?: string;
		};
		return (
			<div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
				<div className="text-secondary-foreground font-mono">{command}</div>
				{description && <div className="text-muted-foreground">{description}</div>}
			</div>
		);
	},
};
