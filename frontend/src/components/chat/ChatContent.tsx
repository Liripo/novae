import type { ContentBlock, Msg, ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { ArrowDown } from 'lucide-react';
import React from 'react';
import { useRef, useEffect, useState } from 'react';

import { ChatErrorCard } from './ChatErrorCard';
import { EmptyMessage } from './Empty';
import { useElapsedSeconds, ElapsedText } from '@/components/chat/tool-renderers/_shared';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TextInput } from '@/components/chat/TextInput.tsx';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';

interface ChatContentProps {
	msgs: Msg[];
	sending: boolean;
	/** 已发送用户消息、等待回复首个事件（REPLY_START）期间为真 */
	awaitingReply: boolean;
	disabled: boolean;
	onSend: (content: ContentBlock[]) => void;
	/** 中断当前正在运行的回复（busy 时输入区显示停止按钮） */
	onStop?: () => void;
	onUserConfirm: (
		toolCall: ToolCallBlock,
		confirm: boolean,
		replyId: string,
		rules?: ToolCallBlock['suggested_rules'],
	) => void;
	autoComplete?: (input: string) => string | null;
	className?: string;
	/** @see TextInputProps.allowedInputTypes */
	allowedInputTypes: string[];
	/** @see TextInputProps.fileProcessor */
	fileProcessor: (file: File) => Promise<ContentBlock | null>;
	/** 最新的管线错误（触发/流/历史），以卡片形式展示 */
	error?: Error | null;
	/** 重试失败的运行（重发最后一条用户消息） */
	onRetryError?: () => void;
	/** 关闭错误卡片 */
	onDismissError?: () => void;
}

/**
 * 「正在思考」等待指示（hermes 风格）：三点动画 + 已耗时秒数。
 * 在用户发送后首个回复事件到达前、以及进行中的回复还没有任何
 * 可见内容时显示。
 */
function ThinkingIndicator() {
	const { t } = useTranslation();
	const elapsed = useElapsedSeconds(true);
	return (
		<div className="flex items-center gap-x-2 px-1 text-muted-foreground" role="status">
			<span className="flex gap-x-1">
				{[0, 1, 2].map((i) => (
					<span
						key={i}
						className="size-1.5 animate-bounce rounded-full bg-current"
						style={{ animationDelay: `${i * 0.15}s` }}
					/>
				))}
			</span>
			<span className="text-[0.75rem]">{t('messageBubble.thinking')}</span>
			<ElapsedText seconds={elapsed} />
		</div>
	);
}

const ChatContentComponent: React.FC<ChatContentProps> = ({
	msgs,
	sending,
	awaitingReply,
	disabled,
	onSend,
	onStop,
	onUserConfirm,
	autoComplete,
	className,
	allowedInputTypes,
	fileProcessor,
	error,
	onRetryError,
	onDismissError,
}) => {
	const { t } = useTranslation();
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLDivElement>(null);
	const [nearBottom, setNearBottom] = useState(true);
	const nearBottomRef = useRef<boolean>(true);
	// 悬浮输入区的实测高度，消息列表底部据此留白，避免遮挡最后一条消息
	const [composerHeight, setComposerHeight] = useState(120);

	// ResizeObserver 跟踪悬浮输入区高度（附件增减、多行输入都会改变高度）
	useEffect(() => {
		const el = composerRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			setComposerHeight(el.offsetHeight);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// 只要用户没有上翻，消息/内容变化时即时滚到底（instant，
	// 避免流式 token 排出一串卡顿的动画）
	useEffect(() => {
		const area = scrollAreaRef.current;
		if (!area || !nearBottomRef.current) return;
		area.scrollTo({ top: area.scrollHeight, behavior: 'auto' });
	}, [msgs, sending]);

	// 跟踪用户是否贴近底部（驱动自动滚动与「回到底部」按钮）
	useEffect(() => {
		const scrollArea = scrollAreaRef.current;
		if (!scrollArea) return;

		const handleScroll = () => {
			const { scrollTop, scrollHeight, clientHeight } = scrollArea;
			const atBottom = scrollTop + clientHeight >= scrollHeight - 50;
			nearBottomRef.current = atBottom;
			setNearBottom(atBottom);
		};

		scrollArea.addEventListener('scroll', handleScroll);
		return () => scrollArea.removeEventListener('scroll', handleScroll);
	}, []);

	const scrollToBottom = () => {
		nearBottomRef.current = true;
		setNearBottom(true);
		scrollAreaRef.current?.scrollTo({
			top: scrollAreaRef.current.scrollHeight,
			behavior: 'smooth',
		});
	};

	// 思考指示的显示条件：
	// 1) awaitingReply —— 用户消息已提交、回复的首个事件尚未到达
	//    （模型调用/重试期间可能持续很久，但报错会立即复位）；
	// 2) replyEmpty —— 回复已开始但还没有任何可见内容块。
	// 两个条件都由运行状态驱动，运行结束/失败后不会挂住。
	const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
	const showThinking =
		(awaitingReply && !!lastMsg && lastMsg.role === 'user') ||
		(sending &&
			!!lastMsg &&
			lastMsg.role === 'assistant' &&
			(lastMsg.content?.length ?? 0) === 0);

	return (
		<div className={cn('relative h-full w-full', className)}>
			{/* 消息滚动区：整高，底部按悬浮输入区高度留白 */}
			<div
				ref={scrollAreaRef}
				className="h-full w-full max-w-full overflow-auto no-scrollbar overflow-x-hidden"
			>
				<div
					className="mx-auto flex w-full max-w-full flex-col gap-4 px-2 pt-2"
					style={{ paddingBottom: composerHeight + 16 }}
				>
					{msgs.length > 0 ? (
						msgs.map((message) => (
							<MessageBubble
								key={message.id}
								message={message}
								onUserConfirm={onUserConfirm}
							/>
						))
					) : (
						<EmptyMessage />
					)}
					{showThinking && <ThinkingIndicator />}
				</div>
			</div>
			{!nearBottom && msgs.length > 0 && (
				<Button
					size="icon-sm"
					variant="outline"
					className="absolute right-3 z-20 rounded-full shadow-md"
					style={{ bottom: composerHeight + 12 }}
					title={t('chat.backToBottom')}
					onClick={scrollToBottom}
				>
					<ArrowDown />
				</Button>
			)}
			{/* 悬浮输入区：毛玻璃质感，覆盖在消息区底部 */}
			<div
				ref={composerRef}
				className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 px-2 pb-2 pt-8 [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]"
			>
				{error && (
					<ChatErrorCard
						error={error}
						onRetry={msgs.some((m) => m.role === 'user') ? onRetryError : undefined}
						onDismiss={onDismissError ?? (() => {})}
					/>
				)}
				<TextInput
					className="w-full bg-background/80 shadow-lg backdrop-blur-md"
					onSend={onSend}
					onStop={onStop}
					disabled={disabled}
					busy={sending || awaitingReply}
					autoComplete={autoComplete}
					allowedInputTypes={allowedInputTypes}
					fileProcessor={fileProcessor}
				/>
			</div>
		</div>
	);
};

export const ChatContent = React.memo(ChatContentComponent);
