import type { ToolCallBlock, ToolResultBlock } from '@agentscope-ai/agentscope/message';
import type { ReactNode } from 'react';

export type TFunction = (key: string, params?: Record<string, unknown>) => string;

export interface ToolCallWithResult {
	call: ToolCallBlock;
	result?: ToolResultBlock;
}

/**
 * One labeled section inside a tool row's expanded body. Rendered as a
 * small uppercase label over a height-capped scroll surface.
 */
export interface ToolSection {
	label: string;
	body: ReactNode;
	/** Render the body in the mono scroll surface (default true). */
	mono?: boolean;
	/** Render the body in destructive color (failed output). */
	error?: boolean;
}

export interface ToolRenderer {
	/** Row title, e.g. `Bash` or the localized tool name. */
	getDisplayName?: (call: ToolCallBlock, t: TFunction) => string;
	/** Short inline summary after the title (command / path / pattern…). */
	renderCallArgs?: (call: ToolCallBlock, t: TFunction) => ReactNode;
	/**
	 * Expanded body sections. Defaults to input JSON + output text when
	 * the renderer does not override it.
	 */
	renderSections?: (
		call: ToolCallBlock,
		result: ToolResultBlock | undefined,
		t: TFunction,
	) => ToolSection[];
	/** Body of the permission ConfirmCard shown for `asking` calls. */
	renderConfirmBody?: (call: ToolCallBlock, t: TFunction) => ReactNode;
}
