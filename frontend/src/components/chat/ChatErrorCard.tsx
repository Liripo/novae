import { ChevronDown, CircleAlert, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useTranslation } from '@/i18n/useI18n';
import { chatErrorDetail, chatErrorMessage } from '@/utils/chatError';

interface ChatErrorCardProps {
	error: Error;
	/** Resend the last user message. Hidden when there is nothing to resend. */
	onRetry?: () => void;
	onDismiss: () => void;
}

/**
 * Persistent (non-toast) error card rendered inside the chat area. Shows
 * the unified friendly message, a retry button for the last user message
 * and — when the raw text is technical — a collapsible details section.
 */
export function ChatErrorCard({ error, onRetry, onDismiss }: ChatErrorCardProps) {
	const { t } = useTranslation();
	const [detailsOpen, setDetailsOpen] = useState(false);
	const detail = chatErrorDetail(error);

	return (
		<div className="flex w-full items-start gap-x-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5">
			<CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
			<div className="flex min-w-0 flex-1 flex-col gap-y-1">
				<span className="text-sm">{chatErrorMessage(t, error)}</span>
				{detail && (
					<Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
						<CollapsibleTrigger className="group flex w-fit cursor-pointer items-center gap-x-1 text-muted-foreground text-xs hover:text-foreground">
							<ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
							{t('chat.error.technicalDetails')}
						</CollapsibleTrigger>
						<CollapsibleContent>
							<pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-muted-foreground text-xs whitespace-pre-wrap break-all">
								{detail}
							</pre>
						</CollapsibleContent>
					</Collapsible>
				)}
			</div>
			{onRetry && (
				<Button size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
					<RefreshCw />
					{t('chat.error.retry')}
				</Button>
			)}
			<Button size="icon-xs" variant="ghost" className="shrink-0" onClick={onDismiss}>
				<X />
			</Button>
		</div>
	);
}
