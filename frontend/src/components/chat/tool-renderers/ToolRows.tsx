import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import {
	ElapsedText,
	SectionLabel,
	SectionSurface,
	StatusGlyph,
	callStatus,
	useElapsedSeconds,
} from './_shared';
import { countFailed, groupStatus, isGroupRunning } from './groupToolCalls';
import { getDisplayName, renderCallArgs, renderSections } from './index';
import type { TFunction, ToolCallWithResult } from './types';
import { cn } from '@/lib/utils';

/**
 * hermes 风格的工具调用呈现：
 * - 单行 disclosure：[状态图标] 标题 摘要 …… 耗时，点击展开详情；
 * - 连续多个工具调用折叠为一个「工具调用 · N 步」分组；
 * - 状态语义「成功安静、失败响亮」：成功只显示灰色对勾，
 *   运行中显示旋转图标 + 计时，失败/被中断以醒目颜色标出。
 */

/** 单行工具调用（可展开查看输入/输出分区） */
function ToolRow({ item, t }: { item: ToolCallWithResult; t: TFunction }) {
	const { call, result } = item;
	const status = callStatus(item);
	const running = status === 'running' || status === 'asking';
	const elapsed = useElapsedSeconds(running);
	const [open, setOpen] = useState(false);

	const sections = open ? renderSections(call, result, t) : [];

	return (
		<div className="min-w-0">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="group/row flex w-full min-w-0 items-center gap-x-1.5 rounded px-1 py-0.5 text-left text-[0.75rem] text-muted-foreground transition-colors hover:bg-muted/50"
			>
				<StatusGlyph status={status} />
				<span
					className={cn(
						'shrink-0 font-medium',
						running && 'shimmer-text',
						status === 'error' && 'text-destructive',
					)}
				>
					{getDisplayName(call, t)}
				</span>
				<span className="min-w-0 flex-1 truncate text-muted-foreground/70">
					{renderCallArgs(call, t)}
				</span>
				{running && <ElapsedText seconds={elapsed} />}
				<ChevronRight
					className={cn(
						'size-3 shrink-0 text-muted-foreground/50 transition-transform',
						open && 'rotate-90',
						!open && 'opacity-0 group-hover/row:opacity-100',
					)}
				/>
			</button>
			{open && sections.length > 0 && (
				<div className="ml-5 flex flex-col gap-y-2 border-l border-border/60 pl-2 pt-1 pb-1.5">
					{sections.map((section, i) => (
						<div key={i}>
							<SectionLabel>{section.label}</SectionLabel>
							{section.mono === false ? (
								<div className="text-[0.75rem] text-muted-foreground">
									{section.body}
								</div>
							) : (
								<SectionSurface error={section.error}>
									{section.body}
								</SectionSurface>
							)}
						</div>
					))}
			</div>
			)}
		</div>
	);
}

/** 分组视图：单条调用直接渲染一行，多条包一层分组头（拆成两个组件以符合 hooks 规则） */
export function ToolCallGroupView({
	calls,
	t,
}: {
	calls: ToolCallWithResult[];
	t: TFunction;
}) {
	if (calls.length === 1) {
		return <ToolRow item={calls[0]} t={t} />;
	}
	return <MultiToolGroup calls={calls} t={t} />;
}

/** 分组头：「工具调用 · N 步」+ 总耗时/失败摘要，body 用 hidden 收起以保住展开状态 */
function MultiToolGroup({ calls, t }: { calls: ToolCallWithResult[]; t: TFunction }) {
	const status = groupStatus(calls);
	const running = isGroupRunning(calls) || status === 'running';
	const failed = countFailed(calls);
	const elapsed = useElapsedSeconds(running);
	const [open, setOpen] = useState(false);

	return (
		<div className="min-w-0 rounded-md bg-muted/30 px-1 py-0.5">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="group/row flex w-full min-w-0 items-center gap-x-1.5 rounded px-1 py-0.5 text-left text-[0.75rem] text-muted-foreground transition-colors hover:bg-muted/50"
			>
				<StatusGlyph status={status === 'success' ? 'success' : status} />
				<span className={cn('shrink-0 font-medium', running && 'shimmer-text')}>
					{t('tool.group.title', { count: calls.length })}
				</span>
				{failed > 0 && (
					<span className="shrink-0 text-destructive">
						{t('tool.group.failed', { count: failed })}
					</span>
				)}
				<span className="flex-1" />
				{running && <ElapsedText seconds={elapsed} />}
				<ChevronRight
					className={cn(
						'size-3 shrink-0 text-muted-foreground/50 transition-transform',
						open && 'rotate-90',
						!open && 'opacity-0 group-hover/row:opacity-100',
					)}
				/>
			</button>
			{/* 收起时用 hidden 而非卸载，保留各行的展开状态 */}
			<div hidden={!open} className="flex flex-col">
				{calls.map((item) => (
					<ToolRow key={item.call.id} item={item} t={t} />
				))}
			</div>
		</div>
	);
}
