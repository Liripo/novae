import type { ContentBlock, Msg, ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { ArrowDown } from 'lucide-react';
import React from 'react';
import { useRef, useEffect, useState } from 'react';

import { ChatErrorCard } from './ChatErrorCard';
import { EmptyMessage } from './Empty';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TextInput } from '@/components/chat/TextInput.tsx';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';

interface ChatContentProps {
	msgs: Msg[];
	sending: boolean;
	disabled: boolean;
	onSend: (content: ContentBlock[]) => void;
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
	/** Latest pipeline error (trigger / stream / history), shown as a card. */
	error?: Error | null;
	/** Retry the failed run (resends the last user message). */
	onRetryError?: () => void;
	/** Dismiss the error card. */
	onDismissError?: () => void;
}

/**
 * Three-dot "assistant is thinking" row. Shown after the user sends
 * (before the first reply event arrives) and while the in-progress reply
 * has not produced any visible content yet.
 */
function ThinkingIndicator() {
	const { t } = useTranslation();
	return (
		<div className="flex items-center gap-x-2 px-2 text-muted-foreground">
			<span className="flex gap-x-1">
				{[0, 1, 2].map((i) => (
					<span
						key={i}
						className="size-1.5 animate-bounce rounded-full bg-current"
						style={{ animationDelay: `${i * 0.15}s` }}
					/>
				))}
			</span>
			<span className="text-sm">{t('messageBubble.thinking')}…</span>
		</div>
	);
}

const ChatContentComponent: React.FC<ChatContentProps> = ({
	msgs,
	sending,
	disabled,
	onSend,
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
	const [nearBottom, setNearBottom] = useState(true);
	const nearBottomRef = useRef<boolean>(true);

	// Auto-scroll on every message/content change as long as the user has
	// not scrolled up. Instant (not smooth) so streaming tokens don't
	// queue a janky animation chain.
	useEffect(() => {
		const area = scrollAreaRef.current;
		if (!area || !nearBottomRef.current) return;
		area.scrollTo({ top: area.scrollHeight, behavior: 'auto' });
	}, [msgs, sending]);

	// Track whether the user is near the bottom (drives both auto-scroll
	// and the "back to bottom" floating button).
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

	// Thinking indicator: right after sending (reply not started) and
	// while the in-progress assistant reply is still empty.
	const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
	const awaitingReply = !!lastMsg && lastMsg.role === 'user';
	const replyEmpty =
		sending &&
		!!lastMsg &&
		lastMsg.role === 'assistant' &&
		(lastMsg.content?.length ?? 0) === 0;

	return (
		<div className={cn('flex flex-col h-full w-full items-center p-2 gap-4', className)}>
			<div className="relative flex-1 w-full max-w-full min-h-0">
				<div
					ref={scrollAreaRef}
					className="h-full w-full max-w-full overflow-auto no-scrollbar overflow-x-hidden"
				>
					<div className="flex flex-col gap-4 size-full max-w-full">
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
						{(awaitingReply || replyEmpty) && <ThinkingIndicator />}
					</div>
				</div>
				{!nearBottom && msgs.length > 0 && (
					<Button
						size="icon-sm"
						variant="outline"
						className="absolute bottom-3 right-3 z-10 rounded-full shadow-md"
						title={t('chat.backToBottom')}
						onClick={scrollToBottom}
					>
						<ArrowDown />
					</Button>
				)}
			</div>
			{error && (
				<ChatErrorCard
					error={error}
					onRetry={msgs.some((m) => m.role === 'user') ? onRetryError : undefined}
					onDismiss={onDismissError ?? (() => {})}
				/>
			)}
			<TextInput
				className="min-w-full max-w-full w-full"
				onSend={onSend}
				disabled={disabled}
				busy={sending}
				autoComplete={autoComplete}
				allowedInputTypes={allowedInputTypes}
				fileProcessor={fileProcessor}
			/>
		</div>
	);
};

export const ChatContent = React.memo(ChatContentComponent);
