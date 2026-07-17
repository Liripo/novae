import type { TFunction } from 'i18next';

/**
 * Unified, user-friendly chat error mapping.
 *
 * Every error that can reach the chat UI — trigger POST failures, SSE
 * stream drops, history fetch failures and the api client's auto toast —
 * is classified here into one of four kinds and rendered as a short,
 * non-technical message. The raw text (JSON dumps, stack traces, error
 * type names) is preserved in `detail` for an optional collapsible
 * "technical details" section, never shown by default.
 *
 * The module is dependency-free (the i18next import is type-only) so it
 * can be unit-tested with plain node.
 */
export type ChatErrorKind = 'rateLimit' | 'busy' | 'network' | 'unknown';

export interface ChatErrorInfo {
	kind: ChatErrorKind;
	/** Raw extracted text, for the collapsible technical-details area. */
	detail: string;
	/**
	 * True when the server-provided message is short and clean enough to
	 * show verbatim (e.g. "Invalid username or password.") instead of the
	 * generic fallback copy.
	 */
	useRaw: boolean;
}

/** Shapes carried by our ApiError without importing it (keeps this pure). */
interface ErrorLike {
	name?: string;
	message?: string;
	status?: number;
	detail?: string;
}

const RATE_LIMIT_RE =
	/429|rate.?limit|too many requests|FreeUsageLimit|quota|限流/i;
const BUSY_RE = /409|already in flight|in progress/i;
const NETWORK_RE =
	/network|failed to fetch|fetch failed|timeout|timed out|ECONN|abort|网络/i;
/** Markers of technical text that must never reach the user verbatim. */
const TECHNICAL_RE =
	/[{}\[\]\\]|\n|Traceback|Exception|\bError\b|status code|HTTP \d{3}|stack/i;
const RAW_OK_MAX_LEN = 120;

/** Pull a human-ish string out of any thrown value. */
function extract(raw: unknown): { status?: number; text: string } {
	if (raw == null) return { text: '' };
	if (typeof raw === 'string') return { text: raw };
	const e = raw as ErrorLike;
	const status = typeof e.status === 'number' ? e.status : undefined;
	const text =
		(typeof e.detail === 'string' && e.detail) ||
		(typeof e.message === 'string' && e.message) ||
		String(raw);
	return { status, text };
}

/** Classify any error thrown around the chat pipeline. */
export function classifyChatError(raw: unknown): ChatErrorInfo {
	const { status, text } = extract(raw);

	let kind: ChatErrorKind = 'unknown';
	if (status === 429 || RATE_LIMIT_RE.test(text)) kind = 'rateLimit';
	else if (status === 409 || BUSY_RE.test(text)) kind = 'busy';
	// fetch() network failures surface as TypeError with no status.
	else if (status === undefined && (raw instanceof TypeError || NETWORK_RE.test(text)))
		kind = 'network';

	const useRaw =
		kind === 'unknown' &&
		text.length > 0 &&
		text.length <= RAW_OK_MAX_LEN &&
		!TECHNICAL_RE.test(text);

	return { kind, detail: text, useRaw };
}

/**
 * Map an error to the message shown to the user. Clean short server
 * messages pass through; everything else becomes friendly copy.
 */
export function chatErrorMessage(t: TFunction, raw: unknown): string {
	const info = classifyChatError(raw);
	if (info.useRaw) return info.detail;
	return t(`chat.error.${info.kind}`);
}

/** Technical detail for the collapsible section (null when not worth showing). */
export function chatErrorDetail(raw: unknown): string | null {
	const info = classifyChatError(raw);
	if (!info.detail || info.useRaw) return null;
	return info.detail;
}
