import { fileSections, getFilePath } from './_fileSections';
import type { ToolRenderer } from './types';

// TODO: render old_string / new_string as a unified diff section once a
// diff component is available.
export const EditRenderer: ToolRenderer = {
	getDisplayName: (call) => call.name,

	renderCallArgs: (call) => getFilePath(call.input),

	renderSections: (call, result, t) => fileSections(call, result, t),

	renderConfirmBody: (call) => (
		<div className="w-full max-w-full overflow-hidden text-ellipsis truncate">
			<div className="text-secondary-foreground">{getFilePath(call.input)}</div>
		</div>
	),
};
