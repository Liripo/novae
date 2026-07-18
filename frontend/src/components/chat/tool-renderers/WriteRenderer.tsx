import { fileSections, getFilePath } from './_fileSections';
import type { ToolRenderer } from './types';

export const WriteRenderer: ToolRenderer = {
	getDisplayName: (call) => call.name,

	renderCallArgs: (call) => getFilePath(call.input),

	renderSections: (call, result, t) => fileSections(call, result, t),

	renderConfirmBody: (call) => (
		<div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
			<div className="text-secondary-foreground">{getFilePath(call.input)}</div>
		</div>
	),
};
