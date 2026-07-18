import type {
	DataBlock,
	Msg,
	TextBlock,
	ToolCallBlock,
} from '@agentscope-ai/agentscope/message';
import {
	ArrowDown,
	ArrowUp,
	Bot,
	Brain,
	CalendarClock,
	Check,
	ChevronRight,
	CirclePlay,
	Copy,
	Loader2,
	MessageSquareQuote,
	Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { ConfirmCard } from './ConfirmCard';
import { FileAttachment } from './FileAttachment';
import { ToolCallGroupView } from './tool-renderers/ToolRows';
import { groupToolCalls, type ExtendedContentBlock } from './tool-renderers/groupToolCalls';
import type { TFunction } from './tool-renderers/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible.tsx';
import { Item, ItemContent } from '@/components/ui/item.tsx';
import { useAudioBlock, useReplayController } from '@/context/AudioContext';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';
import { formatNumber, formatTime } from '@/utils/common';

const AUDIO_WAVE_LINES: Array<{ x: number; y1: number; y2: number }> = [
	{ x: 2, y1: 10, y2: 13 },
	{ x: 6, y1: 6, y2: 17 },
	{ x: 10, y1: 3, y2: 21 },
	{ x: 14, y1: 8, y2: 15 },
	{ x: 18, y1: 5, y2: 18 },
	{ x: 22, y1: 10, y2: 13 },
];

function AudioWave({ isPlaying = true, className }: { isPlaying?: boolean; className?: string }) {
	return (
		<>
			{isPlaying && (
				<style>{`
					@keyframes audioWave {
						0%, 100% { transform: scaleY(1); }
						50%      { transform: scaleY(0.3); }
					}
				`}</style>
			)}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				className={className}
			>
				{AUDIO_WAVE_LINES.map(({ x, y1, y2 }, i) => (
					<line
						key={x}
						x1={x}
						x2={x}
						y1={y1}
						y2={y2}
						style={{
							transformOrigin: `${x}px 12px`,
							animation: isPlaying
								? `audioWave 0.8s ease-in-out ${i * 0.12}s infinite`
								: 'none',
						}}
					/>
				))}
			</svg>
		</>
	);
}

/**
 * 内嵌在底部状态行的音频控件，与耗时/用量共用同一个 Badge，
 * 不再单独浮动。
 */
function AudioInlineControl({ block }: { block: DataBlock }) {
	const { t } = useTranslation();
	const audioState = useAudioBlock(block.id);
	const replayController = useReplayController();
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);

	const isStreaming = audioState?.status === 'streaming';

	// 流式传输中不拼接大段 base64 URL（每次增量都会重新分配）；
	// 只有流结束后（或历史消息）才需要 src 用于回听。
	let src: string | null = null;
	if (!isStreaming) {
		if (audioState?.url) {
			src = audioState.url;
		} else if (block.source.type === 'url') {
			src = block.source.url;
		} else if (block.source.type === 'base64' && block.source.data) {
			src = `data:${block.source.media_type};base64,${block.source.data}`;
		}
	}

	// 源 URL 变化时重置隐藏的 <audio>，否则部分浏览器会保留旧源。
	useEffect(() => {
		const el = audioRef.current;
		if (!el || !src) return;
		setIsPlaying(false);
		el.load();
	}, [src]);

	// 有更新的回复打断时暂停本块的播放。
	const interruptCount = audioState?.interruptCount ?? 0;
	useEffect(() => {
		if (interruptCount === 0) return;
		const el = audioRef.current;
		if (el && !el.paused) {
			el.pause();
		}
	}, [interruptCount]);

	if (isStreaming) {
		return <AudioWave isPlaying className="ml-1" />;
	}

	if (!src) return null;

	const toggle = async () => {
		const el = audioRef.current;
		if (!el) return;
		if (el.paused) {
			replayController?.play(el);
			try {
				await el.play();
			} catch (err) {
				console.error('Audio playback failed', err);
			}
		} else {
			el.pause();
			replayController?.stop();
		}
	};

	return (
		<>
			<button
				type="button"
				onClick={toggle}
				aria-label={
					isPlaying ? t('messageBubble.pauseAudio') : t('messageBubble.playAudio')
				}
				className="ml-1 inline-flex cursor-pointer items-center transition-opacity hover:opacity-70"
			>
				{isPlaying ? (
					<AudioWave isPlaying className="size-3" />
				) : (
					<CirclePlay className="size-3" />
				)}
			</button>
			<audio
				ref={audioRef}
				src={src}
				preload="auto"
				onPlay={() => setIsPlaying(true)}
				onPause={() => setIsPlaying(false)}
				onEnded={() => setIsPlaying(false)}
			/>
		</>
	);
}

/**
 * 思考区块（hermes 风格）：流式生成时自动展开一个限高预览窗
 * （顶部渐变遮罩、内容自动跟随），标题带 shimmer 微光；
 * 生成结束后自动折叠。用户手动展开/折叠后不再自动变更。
 */
function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming: boolean }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(streaming);
	const userToggled = useRef(false);
	const previewRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!userToggled.current) setOpen(streaming);
	}, [streaming]);

	// 流式期间预览窗始终滚到底部
	useEffect(() => {
		const el = previewRef.current;
		if (open && streaming && el) el.scrollTop = el.scrollHeight;
	}, [thinking, open, streaming]);

	return (
		<div className="text-muted-foreground">
			<button
				type="button"
				className="flex items-center gap-x-1.5 rounded px-1 py-0.5 text-[0.75rem] transition-colors hover:bg-muted/50"
				onClick={() => {
					userToggled.current = true;
					setOpen((v) => !v);
				}}
			>
				<Brain className="size-3.5" />
				<span className={cn('font-medium', streaming && 'shimmer-text')}>
					{t('messageBubble.thinking')}
				</span>
				<ChevronRight
					className={cn('size-3 text-muted-foreground/50 transition-transform', open && 'rotate-90')}
				/>
			</button>
			{open && (
				<div className="relative ml-2 mt-1">
					<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background to-transparent" />
					<div
						ref={previewRef}
						className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[0.75rem] leading-relaxed"
					>
						{thinking}
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * 渲染单个内容块。工具调用分组交给 ToolCallGroupView；
 * 首个 asking 调用的截断与 ConfirmCard 挂载在此处理，
 * 渲染器只看到干净的调用列表。
 */
function renderBlock(
	block: ExtendedContentBlock,
	index: number,
	t: TFunction,
	isRunning: boolean,
	onUserConfirm?: (
		toolCallBlock: ToolCallBlock,
		confirm: boolean,
		rules?: ToolCallBlock['suggested_rules'],
	) => void,
) {
	switch (block.type) {
		case 'tool_call_group': {
			const firstAsk = block.calls.findIndex((item) => item.call.state === 'asking');
			const visible = firstAsk === -1 ? block.calls : block.calls.slice(0, firstAsk + 1);
			const askingCall = firstAsk === -1 ? null : block.calls[firstAsk].call;
			return (
				<div key={index} className="flex flex-col gap-y-1">
					<ToolCallGroupView calls={visible} t={t} />
					{askingCall && (
						<ConfirmCard
							toolCall={askingCall}
							onUserConfirm={(confirm, rules) => {
								if (onUserConfirm) onUserConfirm(askingCall, confirm, rules);
							}}
						/>
					)}
				</div>
			);
		}
		case 'text':
			return (
				<div key={index} className="prose w-full min-w-full text-[0.8125rem]">
					<ReactMarkdown
						remarkPlugins={[remarkGfm]}
						components={{
							code: ({ className, children, ...props }) => {
								const isInline = !String(className ?? '').startsWith('language-');
								if (isInline) {
									return (
										<code className={`${className ?? ''} break-all`} {...props}>
											{children}
										</code>
									);
								}
								return (
									<div className="relative w-full">
										<Button
											size="icon-xs"
											variant="ghost"
											className="absolute top-0 right-0 z-10"
											onClick={async (e) => {
												e.preventDefault();
												e.stopPropagation();
												await navigator.clipboard.writeText(String(children));
											}}
										>
											<Copy />
										</Button>
										<div className="overflow-x-auto max-w-full w-full">
											<code className={className} {...props}>
												{children}
											</code>
										</div>
									</div>
								);
							},
						}}
					>
						{block.text}
					</ReactMarkdown>
				</div>
			);

		case 'thinking':
			return <ThinkingBlock key={index} thinking={block.thinking} streaming={isRunning} />;

		case 'data': {
			const dataType = block.source.media_type.split('/')[0];
			// 音频块在底部状态行渲染（见 AudioInlineControl），不在正文内联
			if (dataType === 'audio') return null;
			const data =
				block.source.type === 'url'
					? block.source.url
					: `data:${block.source.media_type};base64,${block.source.data}`;
			switch (dataType) {
				case 'image':
					return (
						<img
							key={index}
							src={data}
							alt={block.name || 'Uploaded image'}
							className="max-h-80 max-w-full rounded-lg object-contain"
						/>
					);
				case 'video':
					return (
						<video
							key={index}
							controls
							src={data}
							className="max-h-80 max-w-full rounded-lg"
						/>
					);
				default:
					return (
						<FileAttachment
							key={index}
							name={block.name}
							href={data}
							mediaType={block.source.media_type}
						/>
					);
			}
		}

		case 'hint': {
			// 解析来源：优先 JSON，退化纯字符串，默认 t('common.message')
			let hintLabel: string;
			let hintSublabel: string | null = null;
			let HintIcon = MessageSquareQuote;

			if (block.source) {
				try {
					const parsed = JSON.parse(block.source) as {
						label?: string;
						sublabel?: string;
					};
					hintLabel = parsed.label
						? t(`messageBubble.hintSource.${parsed.label}`)
						: block.source;
					hintSublabel = parsed.sublabel ?? null;
					if (parsed.label === 'team_message') HintIcon = Bot;
					else if (parsed.label === 'schedule') HintIcon = CalendarClock;
					else if (parsed.label === 'tool_output') HintIcon = Wrench;
				} catch {
					hintLabel = block.source;
				}
			} else {
				hintLabel = t('common.message');
			}
			const items: (TextBlock | DataBlock)[] =
				typeof block.hint === 'string'
					? [{ type: 'text', id: `${block.id}-text`, text: block.hint }]
					: block.hint;
			return (
				<Item variant={'outline'} className="max-w-full">
					<ItemContent className="max-w-full">
						<Collapsible>
							<CollapsibleTrigger asChild>
								<Button className="group w-full max-w-full" variant="ghost">
									<HintIcon className="size-3.5" />
									<span className="tracking-tight">{hintLabel}</span>
									{hintSublabel && (
										<span className="text-muted-foreground font-normal truncate max-w-[200px]">
											{hintSublabel}
										</span>
									)}
									<ChevronRight className="ml-auto group-data-[state=open]:rotate-90" />
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="p-2.5 pt-0 max-w-full overflow-hidden break-all text-muted-foreground">
								{items.map((inner, i) => renderBlock(inner, i, t, isRunning))}
							</CollapsibleContent>
						</Collapsible>
					</ItemContent>
				</Item>
			);
		}

		default:
			return null;
	}
}

interface MessageBubbleProps {
	message: Msg;
	onUserConfirm: (
		toolCallBlock: ToolCallBlock,
		confirm: boolean,
		replyId: string,
		rules?: ToolCallBlock['suggested_rules'],
	) => void;
}

/**
 * 消息气泡（hermes 风格）：
 * - 用户消息 = 整行宽的卡片（非窄气泡右对齐）；
 * - 助手消息 = 无气泡正文，直接排版在背景上；
 * - 运行状态由 finished_at 推断：运行中显示 spinner + 秒级计时徽标；
 *   完成后底部操作栏默认隐藏，hover 浮现（复制 / 耗时 / token 用量 / 音频）。
 */
export function MessageBubble({ message, onUserConfirm }: MessageBubbleProps) {
	const isUser = message.role === 'user';
	const { t } = useTranslation();

	const isRunning = !message.finished_at;
	const hasUsage =
		!!message.usage &&
		((message.usage.input_tokens ?? 0) > 0 || (message.usage.output_tokens ?? 0) > 0);

	// 运行中每秒刷新一次，让耗时实时走动
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!isRunning) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [isRunning]);

	const blocks = groupToolCalls(message.content);
	const audioBlocks = message.content.filter(
		(b): b is DataBlock => b.type === 'data' && b.source.media_type.split('/')[0] === 'audio',
	);
	// 音频块在底部渲染，不撑起正文容器
	const hasBodyContent = blocks.some(
		(b) => !(b.type === 'data' && b.source.media_type.split('/')[0] === 'audio'),
	);

	const startMs = new Date(message.created_at).getTime();
	const endMs = isRunning ? now : new Date(message.finished_at!).getTime();
	const elapsedSeconds = Math.max(0, (endMs - startMs) / 1000);
	const elapsedText = formatTime(elapsedSeconds);

	// 复制助手消息的全部文本内容
	const handleCopy = async () => {
		const text = message.content
			.filter((b): b is TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('\n');
		if (!text.trim()) return;
		await navigator.clipboard.writeText(text);
		toast.success(t('messageBubble.copied'));
	};

	// 状态行显示条件：运行中但正文仍为空时不显示（等待由消息列表底部的
	// ThinkingIndicator 统一指示，避免同一时刻出现两个转圈）；完成后
	// 有正文或音频时才需要 hover 操作栏。
	const showStatusRow = isRunning
		? hasBodyContent
		: hasBodyContent || audioBlocks.length > 0;

	return (
		<div className="group flex w-full max-w-full flex-col" title={new Date(message.created_at).toLocaleString()}>
			{hasBodyContent &&
				(isUser ? (
					// 用户消息：整行宽的卡片
					<div className="w-full max-w-full space-y-2 rounded-xl border bg-secondary/60 px-4 py-3">
						{blocks.map((block, i) =>
							renderBlock(block, i, t, isRunning, (
								toolCall: ToolCallBlock,
								confirm: boolean,
								rules?: ToolCallBlock['suggested_rules'],
							) => {
								onUserConfirm(toolCall, confirm, message.id, rules);
								toolCall.state = confirm ? 'allowed' : 'finished';
							}),
						)}
					</div>
				) : (
					// 助手消息：无气泡，正文直接排版
					<div className="w-full max-w-full space-y-2 px-1">
						{blocks.map((block, i) =>
							renderBlock(block, i, t, isRunning, (
								toolCall: ToolCallBlock,
								confirm: boolean,
								rules?: ToolCallBlock['suggested_rules'],
							) => {
								onUserConfirm(toolCall, confirm, message.id, rules);
								toolCall.state = confirm ? 'allowed' : 'finished';
							}),
						)}
					</div>
				))}
			{!isUser && showStatusRow && (
				<div
					className={cn(
						'flex flex-row items-center gap-x-3 px-1 pt-0.5 text-muted-foreground transition-opacity',
						isRunning ? '' : 'opacity-0 group-hover:opacity-100',
					)}
				>
					{isRunning ? (
						// 运行中：常驻 spinner + 计时徽标
						<Badge variant="secondary" aria-label={t('messageBubble.running')}>
							<Loader2 data-icon="inline-start" className="animate-spin" />
							<span className="tabular-nums tracking-tighter">{elapsedText}</span>
						</Badge>
					) : (
						// 完成后：hover 浮现的操作栏
						<>
							<button
								type="button"
								onClick={handleCopy}
								aria-label={t('messageBubble.copy')}
								className="inline-flex cursor-pointer items-center text-muted-foreground/70 transition-colors hover:text-foreground"
							>
								<Copy className="size-3.5" />
							</button>
							<span className="inline-flex items-center gap-x-1 text-[0.6875rem] text-muted-foreground/70">
								<Check className="size-3" />
								<span className="tabular-nums">{elapsedText}</span>
							</span>
							{hasUsage && (
								<span className="inline-flex items-center gap-x-1 text-[0.6875rem] tabular-nums text-muted-foreground/70">
									<ArrowUp className="size-3" />
									{formatNumber(message.usage?.input_tokens ?? 0)}
									<ArrowDown className="size-3" />
									{formatNumber(message.usage?.output_tokens ?? 0)}
								</span>
							)}
						</>
					)}
					{audioBlocks.map((block) => (
						<AudioInlineControl key={block.id} block={block} />
					))}
				</div>
			)}
		</div>
	);
}
