import type { ToolCallBlock, ToolResultBlock } from '@agentscope-ai/agentscope/message';
import type { ReactNode } from 'react';

import { BashRenderer } from './BashRenderer';
import {
	defaultGetDisplayName,
	defaultRenderCallArgs,
	defaultRenderConfirmBody,
	defaultRenderSections,
} from './DefaultRenderer';
import { EditRenderer } from './EditRenderer';
import { GlobRenderer } from './GlobRenderer';
import { GrepRenderer } from './GrepRenderer';
import { ReadRenderer } from './ReadRenderer';
import { TaskCreateRenderer } from './TaskCreateRenderer';
import type { TFunction, ToolRenderer, ToolSection } from './types';
import { WriteRenderer } from './WriteRenderer';

// 按工具名注册的专属渲染器；未注册的工具走 DefaultRenderer 的通用呈现
const renderers: Record<string, ToolRenderer> = {
	Bash: BashRenderer,
	Read: ReadRenderer,
	Write: WriteRenderer,
	Edit: EditRenderer,
	Glob: GlobRenderer,
	Grep: GrepRenderer,
	TaskCreate: TaskCreateRenderer,
};

function getRenderer(toolName: string): ToolRenderer {
	return renderers[toolName] ?? {};
}

/** 行标题（如 "Bash"、"读取"），未定制时回退为工具原名 */
export function getDisplayName(call: ToolCallBlock, t: TFunction): string {
	const r = getRenderer(call.name);
	return r.getDisplayName?.(call, t) ?? defaultGetDisplayName(call);
}

/** 标题后的行内摘要（命令/路径/模式…） */
export function renderCallArgs(call: ToolCallBlock, t: TFunction): ReactNode {
	const r = getRenderer(call.name);
	return r.renderCallArgs?.(call, t) ?? defaultRenderCallArgs(call);
}

/** 展开后的分区内容，未定制时回退为 输入 JSON + 输出文本 */
export function renderSections(
	call: ToolCallBlock,
	result: ToolResultBlock | undefined,
	t: TFunction,
): ToolSection[] {
	const r = getRenderer(call.name);
	return r.renderSections?.(call, result, t) ?? defaultRenderSections(call, result, t);
}

/** 权限确认卡（ConfirmCard）的正文 */
export function renderConfirmBody(call: ToolCallBlock, t: TFunction): ReactNode {
	const r = getRenderer(call.name);
	return r.renderConfirmBody?.(call, t) ?? defaultRenderConfirmBody(call);
}
