import { fileSections, getFilePath } from './_fileSections';
import type { ToolRenderer } from './types';

export const ReadRenderer: ToolRenderer = {
	getDisplayName: (_call, t) => t('tool.read.name'),

	renderCallArgs: (call) => getFilePath(call.input),

	renderSections: (call, result, t) => fileSections(call, result, t),

	renderConfirmBody: (call) => (
		<div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
			<div className="text-secondary-foreground">{getFilePath(call.input)}</div>
		</div>
	),
};
