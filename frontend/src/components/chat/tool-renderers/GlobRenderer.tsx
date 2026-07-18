import { getPattern, patternSections } from './_patternSections';
import type { ToolRenderer } from './types';

export const GlobRenderer: ToolRenderer = {
	getDisplayName: (_call, t) => t('tool.glob.name'),

	renderCallArgs: (call) => getPattern(call.input),

	renderSections: (call, result, t) => patternSections(call, result, t),
};
