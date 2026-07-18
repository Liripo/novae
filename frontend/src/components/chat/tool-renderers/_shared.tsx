import type { ToolResultBlock } from '@agentscope-ai/agentscope/message';
import * as mime from 'mime-types';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type { ToolCallWithResult } from './types';
import { cn } from '@/lib/utils';
import { formatTime } from '@/utils/common';

/** Per-call status driving the leading glyph — "quiet success, loud failure". */
export type ToolRowStatus = 'running' | 'asking' | 'error' | 'interrupted' | 'success';

/** Derive the row status from a call + its (optional) result. */
export function callStatus({ call, result }: ToolCallWithResult): ToolRowStatus {
	if (call.state === 'asking') return 'asking';
	if (
		!result ||
		result.state === 'running' ||
		call.state === 'pending' ||
		call.state === 'allowed' ||
		call.state === 'submitted'
	) {
		return 'running';
	}
	if (result.state === 'error' || result.state === 'denied') return 'error';
	if (result.state === 'interrupted') return 'interrupted';
	return 'success';
}

/** Leading glyph for a tool row or group header. */
export function StatusGlyph({ status }: { status: ToolRowStatus }) {
	switch (status) {
		case 'running':
			return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
		case 'asking':
			return (
				<AlertCircle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
			);
		case 'error':
			return <AlertCircle className="size-3.5 shrink-0 text-destructive" />;
		case 'interrupted':
			return (
				<AlertCircle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
			);
		default:
			// Success is quiet: a muted, low-contrast check.
			return <Check className="size-3.5 shrink-0 text-muted-foreground/60" />;
	}
}

/**
 * Ticking seconds since the component mounted, advancing only while
 * `active`. Tool blocks carry no timestamps of their own, so a live
 * "time since this row started running" counter is the honest
 * approximation available.
 */
export function useElapsedSeconds(active: boolean): number {
	const [start] = useState(() => Date.now());
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		if (!active) return;
		const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [active, start]);
	return elapsed;
}

/** Small tabular elapsed-time readout shown at the row's trailing edge. */
export function ElapsedText({ seconds, className }: { seconds: number; className?: string }) {
	return (
		<span
			className={cn(
				'shrink-0 text-[0.625rem] tabular-nums text-muted-foreground/70',
				className,
			)}
		>
			{formatTime(seconds)}
		</span>
	);
}

/** 0.65rem uppercase section label above an expanded payload block. */
export function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<p className="mb-1 text-[0.65rem] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
			{children}
		</p>
	);
}

/** Height-capped inline scroll surface for tool payloads. */
export function SectionSurface({
	children,
	mono = true,
	error = false,
	className,
}: {
	children: ReactNode;
	mono?: boolean;
	error?: boolean;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'max-h-48 max-w-full overflow-auto rounded-md bg-muted/40 px-2 py-1.5',
				mono && 'font-mono text-[0.7rem] leading-relaxed whitespace-pre-wrap break-all',
				error ? 'text-destructive' : 'text-muted-foreground',
				className,
			)}
		>
			{children}
		</div>
	);
}

/** Extract printable text from a tool result's output (string or blocks). */
export function resultToText(result: ToolResultBlock | undefined): string {
	if (!result) return '';
	if (typeof result.output === 'string') return result.output;
	return result.output
		.map((b) => {
			if (b.type === 'text') return b.text;
			const mainType = b.source.media_type.split('/')[0].toUpperCase();
			const ext = (mime.extension(b.source.media_type) || 'bin').toLowerCase();
			return `[${mainType}.${ext}]`;
		})
		.join('\n');
}

/** Cap very long outputs; the note line uses the existing tool.moreLines key. */
export function capLines(text: string, t: (k: string, p?: Record<string, unknown>) => string, max = 100): string {
	const lines = text.split('\n');
	if (lines.length <= max) return text;
	return [...lines.slice(0, max), t('tool.moreLines', { count: lines.length - max })].join('\n');
}
