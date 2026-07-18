import { EventType } from '@agentscope-ai/agentscope/event';
import type {
	AgentEvent,
	CustomEvent,
	DataBlockStartEvent,
	DataBlockDeltaEvent,
	DataBlockEndEvent,
	ReplyStartEvent,
	UserConfirmResultEvent,
} from '@agentscope-ai/agentscope/event';
import { appendEvent, AssistantMsg, UserMsg } from '@agentscope-ai/agentscope/message';
import type { Msg, ContentBlock } from '@agentscope-ai/agentscope/message';
import type { ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { useState, useCallback, useRef, useEffect } from 'react';

import { sessionApi } from '@/api';
import { chatApi } from '@/api';
import { useAudioManager } from '@/context/AudioContext';

/**
 * Manages messages for a single ``(agentId, sessionId)`` pair.
 *
 * Event delivery has two independent channels:
 *
 * - **History** — ``GET /sessions/{sid}/messages`` fetches persisted
 *   ``Msg`` objects (each a complete reply).
 * - **Live stream** — ``GET /sessions/{sid}/stream`` is a long-lived
 *   SSE connection that pushes ``AgentEvent`` deltas as they are
 *   produced by any chat run on this session (user-triggered,
 *   background retrigger, team member message, …).
 *
 * The hook opens the SSE connection immediately after fetching
 * history. User input and human-in-the-loop confirmations are sent
 * via ``POST /chat/`` (fire-and-forget); the resulting events arrive
 * through the already-open SSE connection.
 *
 * ``streaming`` is driven by event content, not HTTP lifecycle:
 * ``true`` after receiving ``ReplyStartEvent``, ``false`` after
 * ``ReplyEndEvent``.
 *
 * @param agentId - The agent whose session to subscribe. ``null`` to
 *   skip.
 * @param sessionId - The session to subscribe. ``null`` to skip.
 * @returns Object with ``msgs``, ``loading``, ``streaming``, ``error``,
 *   ``send``, ``onUserConfirm``, and ``abort``.
 */
export function useMessages(
	agentId: string | null,
	sessionId: string | null,
	options?: {
		/**
		 * Called when a ``CUSTOM`` event with ``name="team_updated"``
		 * arrives — the team membership has changed (TeamCreate /
		 * AgentCreate / TeamDelete ran). The typical response is to
		 * refetch the session list so the team sidebar updates.
		 */
		onTeamUpdated?: () => void;
		/**
		 * Called when a ``CUSTOM`` event with ``name="state_updated"``
		 * arrives — agent state (tasks / permission) changed during a
		 * tool call. The ``value`` payload contains the latest
		 * ``tasks_context`` and ``permission_context``.
		 */
		onStateUpdated?: (value: Record<string, unknown>) => void;
	},
) {
	const [msgs, setMsgs] = useState<Msg[]>([]);
	const [loading, setLoading] = useState(false);
	const [streaming, setStreaming] = useState(false);
	// 已发送用户消息、正在等待回复的首个事件（REPLY_START）。
	// 独立于 streaming：streaming 要等 REPLY_START 才置真，而这之前
	// 模型调用可能耗时很久（如 429 重试），期间需要显示「正在思考」；
	// 一旦报错或回复开始则立刻复位，避免「思考中」永远挂住。
	const [awaitingReply, setAwaitingReply] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const msgsRef = useRef<Msg[]>([]);
	const currentReplyRef = useRef<Msg | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const rafRef = useRef<number | null>(null);

	const audioManager = useAudioManager();

	const optionsRef = useRef(options);
	useEffect(() => {
		optionsRef.current = options;
	}, [options]);
	const scheduleUpdate = useCallback(() => {
		if (rafRef.current !== null) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = null;
			setMsgs([...msgsRef.current]);
		});
	}, []);

	/** Apply a single AgentEvent to the in-progress reply. */
	const processEvent = useCallback(
		(event: AgentEvent) => {
			// Custom events are service-layer notifications, not agent
			// reply content — route them to callbacks and skip appendEvent.
			if (event.type === EventType.CUSTOM) {
				const custom = event as CustomEvent;
				if (custom.name === 'team_updated') {
					optionsRef.current?.onTeamUpdated?.();
				} else if (custom.name === 'state_updated' && custom.value) {
					optionsRef.current?.onStateUpdated?.(custom.value as Record<string, unknown>);
				} else if (custom.name === 'run_error') {
					// 后端运行失败（如模型 429 限流）：后端不会再发 REPLY_END，
					// 在此展示错误卡片并收尾运行状态；完全没有内容的空回复
					// 直接移除，错误卡片已足以说明问题。
					const value = (custom.value ?? {}) as {
						error_type?: string;
						message?: string;
					};
					const detail = [value.error_type, value.message]
						.filter(Boolean)
						.join(': ');
					setError(new Error(detail || 'Agent run failed'));
					const reply = currentReplyRef.current;
					if (reply) {
						if (reply.content.length === 0) {
							msgsRef.current = msgsRef.current.filter((m) => m.id !== reply.id);
						} else if (!reply.finished_at) {
							reply.finished_at = new Date().toISOString();
						}
					}
					currentReplyRef.current = null;
					setStreaming(false);
					setAwaitingReply(false);
					scheduleUpdate();
				}
				return;
			}
			if (event.type === EventType.REPLY_START) {
				audioManager?.stopAllPlayback();
				const e = event as ReplyStartEvent;
				const msg = AssistantMsg({ id: e.reply_id, name: e.name, content: [] });
				msgsRef.current = [...msgsRef.current, msg];
				currentReplyRef.current = msg;
				setAwaitingReply(false);
				setStreaming(true);
			} else if (event.type === EventType.REPLY_END) {
				if (currentReplyRef.current) {
					appendEvent(currentReplyRef.current, event);
				}
				setStreaming(false);
				currentReplyRef.current = null;
			} else if (currentReplyRef.current) {
				appendEvent(currentReplyRef.current, event);
			}

			// Route streaming audio DataBlocks to the audio manager. They still
			// flow through `appendEvent` above (which builds up `source.data`
			// in the Msg), but MessageBubble reads playback state from the
			// manager so it can show progress and autoplay on completion.
			if (audioManager) {
				if (event.type === EventType.DATA_BLOCK_START) {
					const e = event as DataBlockStartEvent;
					if (e.media_type.startsWith('audio/')) {
						audioManager.start(e.block_id, e.media_type);
					}
				} else if (event.type === EventType.DATA_BLOCK_DELTA) {
					const e = event as DataBlockDeltaEvent;
					if (e.media_type.startsWith('audio/')) {
						audioManager.append(e.block_id, e.data);
					}
				} else if (event.type === EventType.DATA_BLOCK_END) {
					const e = event as DataBlockEndEvent;
					// `end` is a no-op when the block isn't being tracked, so
					// we can call it unconditionally.
					audioManager.end(e.block_id);
				}
			}

			scheduleUpdate();
		},
		[scheduleUpdate, audioManager],
	);

	// ── Lifecycle: fetch history + open SSE stream ──────────────────
	useEffect(() => {
		msgsRef.current = [];
		currentReplyRef.current = null;
		setMsgs([]);
		setError(null);
		setStreaming(false);
		setAwaitingReply(false);
		audioManager?.disposeAll();

		if (!agentId || !sessionId) return;

		const controller = new AbortController();
		abortRef.current = controller;
		let cancelled = false;

		(async () => {
			// 1. Fetch persisted history
			setLoading(true);
			try {
				const { messages, is_running } = await sessionApi.messages(sessionId, agentId);
				if (cancelled) return;
				// 会话未在运行时，历史里不应存在「未完成」消息
				// （崩溃/限流中断的回复 finished_at 为 null，否则会永远
				// 显示运行中 spinner 和思考微光）——按创建时间就地收尾。
				if (!is_running) {
					for (const m of messages) {
						if (!m.finished_at) m.finished_at = m.created_at;
					}
				}
				msgsRef.current = messages;
				scheduleUpdate();
			} catch (e) {
				if (!cancelled) setError(e as Error);
				return;
			} finally {
				if (!cancelled) setLoading(false);
			}

			// 2. Open SSE long connection for live events
			try {
				for await (const event of sessionApi.streamEvents(
					sessionId,
					agentId,
					controller.signal,
				)) {
					if (cancelled) break;
					processEvent(event);
				}
			} catch (e) {
				if ((e as Error).name !== 'AbortError' && !cancelled) {
					setError(e as Error);
					// 流中断时后端可能不会再发 REPLY_END：就地收尾，
					// 否则这条回复会永远停在「运行中」 spinner / 思考微光。
					if (currentReplyRef.current && !currentReplyRef.current.finished_at) {
						currentReplyRef.current.finished_at = new Date().toISOString();
						scheduleUpdate();
					}
					currentReplyRef.current = null;
					setStreaming(false);
					setAwaitingReply(false);
				}
			}
		})();

		return () => {
			cancelled = true;
			controller.abort();
			abortRef.current = null;
		};
	}, [agentId, sessionId, scheduleUpdate, processEvent, audioManager]);

	/**
	 * Send a user message. Appends the message to the local list
	 * optimistically, then fires a ``POST /chat/`` trigger. Events
	 * arrive via the already-open SSE connection.
	 *
	 * @param content - The message content blocks.
	 */
	const send = useCallback(
		async (content: ContentBlock[]) => {
			if (!agentId || !sessionId) return;
			setError(null);

			const userMsg = UserMsg({ name: 'user', content });
			msgsRef.current = [...msgsRef.current, userMsg];
			scheduleUpdate();

			try {
				await chatApi.trigger({
					agent_id: agentId,
					session_id: sessionId,
					input: userMsg,
				});
				// 触发成功，等待 REPLY_START（processEvent 中复位）
				setAwaitingReply(true);
			} catch (e) {
				setError(e as Error);
			}
		},
		[agentId, sessionId, scheduleUpdate],
	);

	/**
	 * Re-trigger the most recent user message without appending a
	 * duplicate bubble (the original is already in the list; the backend
	 * upserts by message id). Used by the error card's retry button.
	 */
	const resendLastUserMessage = useCallback(async () => {
		if (!agentId || !sessionId) return;
		const lastUser = [...msgsRef.current].reverse().find((m) => m.role === 'user');
		if (!lastUser) return;
		setError(null);
		try {
			await chatApi.trigger({
				agent_id: agentId,
				session_id: sessionId,
				input: lastUser,
			});
			setAwaitingReply(true);
		} catch (e) {
			setError(e as Error);
		}
	}, [agentId, sessionId]);

	/** Dismiss the current error (error card's close button). */
	const clearError = useCallback(() => setError(null), []);

	/**
	 * Confirm or deny a tool call (human-in-the-loop). Fires a
	 * ``POST /chat/`` with a ``UserConfirmResultEvent``; events
	 * arrive via SSE.
	 *
	 * @param toolCall - The tool call block to confirm/deny.
	 * @param confirm - Whether the user confirmed.
	 * @param replyId - The reply id the tool call belongs to.
	 * @param rules - Optional permission rules to attach.
	 */
	const onUserConfirm = useCallback(
		async (
			toolCall: ToolCallBlock,
			confirm: boolean,
			replyId: string,
			rules?: ToolCallBlock['suggested_rules'],
		) => {
			if (!agentId || !sessionId) return;

			// Restore the ref so continuation events (no REPLY_START)
			// have a target.
			currentReplyRef.current = msgsRef.current.find((m) => m.id === replyId) ?? null;

			const event: UserConfirmResultEvent = {
				type: EventType.USER_CONFIRM_RESULT,
				id: crypto.randomUUID(),
				created_at: new Date().toISOString(),
				reply_id: replyId,
				confirm_results: [
					{ confirmed: confirm, tool_call: toolCall, rules: rules ?? null },
				],
			};

			try {
				await chatApi.trigger({
					agent_id: agentId,
					session_id: sessionId,
					input: event,
				});
			} catch (e) {
				setError(e as Error);
			}
		},
		[agentId, sessionId],
	);

	/** Abort the current SSE connection. */
	const abort = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	return { msgs, loading, streaming, awaitingReply, error, send, onUserConfirm, abort, resendLastUserMessage, clearError };
}
