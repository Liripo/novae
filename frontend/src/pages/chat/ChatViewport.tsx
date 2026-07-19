import type { TaskContext } from '@agentscope-ai/agentscope/state';
import { ClipboardList, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatContent } from '@/components/chat/ChatContent.tsx';
import { sessionApi } from '@/api';
import { TaskPanel } from '@/components/chat/TaskPanel';
import { WorkspaceDrawer } from '@/components/drawer/WorkspaceDrawer.tsx';
import { ProjectFilesPanel } from '@/components/project/ProjectFilesPanel';
import { PermissionModeSelect } from '@/components/select/PermissionModeSelect.tsx';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMessages } from '@/hooks/useMessages';
import { useProjects } from '@/hooks/useProjects';
import { useSessions } from '@/hooks/useSessions';
import { useWorkspace } from '@/hooks/useWorkspace.ts';
import { useTranslation } from '@/i18n/useI18n.ts';

/**
 * Attachment types accepted by the chat input. The model is centrally
 * configured on the backend (.env), so the frontend can no longer derive
 * supported modalities from a model card — a conservative static list is
 * used instead (text & data files, images, PDF, Office documents).
 */
const ALLOWED_INPUT_TYPES = [
	'text/*',
	'image/*',
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

interface ChatViewportProps {
	/**
	 * The agent that owns the session being viewed. May be the
	 * user-facing leader agent or — when drilled into a team member
	 * via the URL's `:memberId` slot — a worker agent.
	 */
	agentId: string | null;
	/**
	 * The session whose messages, model config, permission mode, and
	 * workspace drive every control rendered here.
	 */
	sessionId: string | null;
	/**
	 * Optional hook invoked when a team membership change arrives on
	 * this viewport's SSE stream. The outer page owns the session list
	 * that backs the team sidebar, so it must be told to refetch too;
	 * passing this callback wires that signal up.
	 */
	onTeamUpdated?: () => void;
	/**
	 * 工作区抽屉（MCP/技能）的受控打开状态。打开入口在外层页面的
	 * 用户菜单中，抽屉本身仍由本组件渲染（数据依赖当前会话）。
	 */
	workspaceDrawerOpen?: boolean;
	onWorkspaceDrawerOpenChange?: (open: boolean) => void;
}

/**
 * The right-hand main panel of the chat page — every UI element that
 * operates on a single `(agentId, sessionId)` pair lives here:
 * model selector, permission mode select, message stream, workspace
 * drawer, and the team sidebar.
 *
 * Self-contained by design. The outer page passes in the
 * `(agentId, sessionId)` it wants displayed (which may be the leader
 * session or a focused team member's session) and this component
 * does the rest — fetching the session view, syncing local UI state
 * with it, and writing changes back to the same session. Switching
 * between leader and member is just a prop change; no internal
 * branching is needed.
 *
 * @param agentId - The agent to operate on. `null` while no agent is
 *   selected yet (renders an empty / disabled state).
 * @param sessionId - The session to operate on. `null` while no
 *   session is selected yet.
 * @returns The right-side main JSX of the chat page.
 */
export function ChatViewport({ agentId, sessionId, onTeamUpdated, workspaceDrawerOpen, onWorkspaceDrawerOpenChange }: ChatViewportProps) {
	const { t } = useTranslation();
	const { sessions, refetch: refetchSessions } = useSessions(agentId);
	const { projects } = useProjects();

	// When the viewport agent differs from the outer page's selected
	// agent (i.e. user drilled into a team member), `refetchSessions`
	// only refreshes the member's session list. The team sidebar is
	// driven by the leader's session list owned by the outer page, so
	// we also fire the parent's refetch to keep that in sync.
	const handleTeamUpdated = useCallback(() => {
		refetchSessions();
		onTeamUpdated?.();
	}, [refetchSessions, onTeamUpdated]);

	const [selectedPermissionMode, setSelectedPermissionMode] = useState<string>('default');
	const [tasksContext, setTasksContext] = useState<TaskContext | null>(null);

	const handleStateUpdated = useCallback((value: Record<string, unknown>) => {
		if (value.tasks_context) {
			setTasksContext(value.tasks_context as TaskContext);
		}
		// TODO: handle permission_context updates when permission UI is built
	}, []);

	const { msgs, streaming, awaitingReply, error, send, onUserConfirm, stop, resendLastUserMessage, clearError } =
		useMessages(agentId, sessionId, {
			onTeamUpdated: handleTeamUpdated,
			onStateUpdated: handleStateUpdated,
		});
	const {
		mcps,
		loading: mcpsLoading,
		addMcps,
		removeMcp,
		skills,
		skillsLoading,
		addSkill,
		removeSkill,
	} = useWorkspace(agentId, sessionId);

	const view = sessions.find((v) => v.session.id === sessionId) ?? null;

	// The project this session belongs to (workspace_id == project.id),
	// or null for legacy / unbound sessions. Drives the "文件" tab of the
	// right panel.
	const currentProject = useMemo(() => {
		const workspaceId = view?.session.config?.workspace_id;
		if (!workspaceId) return null;
		return projects.find((p) => p.id === workspaceId) ?? null;
	}, [view, projects]);

	// Right panel (tasks + project files) visibility. Hidden below the
	// `md` breakpoint regardless of this flag, so mobile is unaffected.
	const [rightPanelOpen, setRightPanelOpen] = useState(true);

	// ChatViewport keeps its own `useSessions(agentId)` instance (the
	// outer page has a separate one). Its built-in fetch only fires on
	// `agentId` change, so when the outer page creates a new session
	// under the same agent, this list doesn't auto-refresh. Without
	// this refetch, `view` would stay `null` for the brand-new session
	// id and every effect below would early-return on `!view`,
	// leaving the model select and friends pinned to whatever the
	// previously-viewed session had configured.
	useEffect(() => {
		if (!sessionId) return;
		if (view) return;
		refetchSessions();
	}, [sessionId, view, refetchSessions]);

	// Sync tasksContext from the session snapshot. Real-time updates
	// arrive via the CustomEvent(name="state_updated") → the
	// onStateUpdated callback above. We always mirror the snapshot
	// (including clearing to null when the session is gone or has no
	// tasks yet) so that switching sessions doesn't leak stale tasks
	// from the previous one.
	useEffect(() => {
		if (!view) {
			setTasksContext(null);
			return;
		}
		const tc = (view.session.state as Record<string, unknown>)?.tasks_context as
			| TaskContext
			| undefined;
		setTasksContext(tc ?? null);
	}, [view]);

	// Sync selectedPermissionMode when the session changes. Same
	// loading-window guard as above — don't reset the displayed mode
	// to "default" while the new session view is still on the wire.
	useEffect(() => {
		if (!view) return;
		const mode = (view.session.state?.permission_context as Record<string, unknown>)
			?.mode as string;
		setSelectedPermissionMode(mode ?? 'default');
	}, [sessionId, view]);

	/**
	 * Persist a permission-mode change.
	 *
	 * @param mode - New permission mode (e.g. `default`, `explore`).
	 */
	const handlePermissionModeChange = async (mode: string) => {
		setSelectedPermissionMode(mode);
		if (!sessionId || !agentId) return;
		await sessionApi.update(sessionId, agentId, { permission_mode: mode });
		await refetchSessions();
	};

	return (
		<>
			<main className="flex size-full">
				<div className="flex flex-col flex-1 min-h-0 p-2">
					<div className="flex flex-row gap-x-2 justify-between">
						<div className="flex flex-row items-center gap-x-1">
							<SidebarTrigger className="md:hidden" />
						</div>
						<div id="tour-permission-mode" className="flex flex-row gap-x-2">
							<PermissionModeSelect
								value={selectedPermissionMode}
								disabled={!sessionId}
								onChange={handlePermissionModeChange}
							/>
						</div>
					</div>
					<div className="flex flex-1 justify-center min-h-0 overflow-hidden relative [--chat-content-w:48rem]">
						<ChatContent
							className={'max-w-[var(--chat-content-w)] w-full'}
							msgs={msgs}
							sending={streaming}
							awaitingReply={awaitingReply}
							disabled={!sessionId}
							onSend={send}
							onStop={stop}
							onUserConfirm={onUserConfirm}
							error={error}
							onRetryError={resendLastUserMessage}
							onDismissError={clearError}
							allowedInputTypes={ALLOWED_INPUT_TYPES}
							fileProcessor={async (file) => {
								const filePath = (file as File & { path?: string }).path;
								if (filePath) {
									return {
										id: crypto.randomUUID(),
										type: 'data' as const,
										source: {
											type: 'url' as const,
											url: `file://${filePath}`,
											media_type: file.type || 'application/octet-stream',
										},
										name: file.name,
									};
								}
								if (file.type === 'text/plain') {
									const text = await file.text();
									return {
										id: crypto.randomUUID(),
										type: 'text' as const,
										text: `[File: ${file.name}]\n${text}`,
									};
								}
								const buffer = await file.arrayBuffer();
								const bytes = new Uint8Array(buffer);
								let binary = '';
								for (let i = 0; i < bytes.byteLength; i++) {
									binary += String.fromCharCode(bytes[i]);
								}
								const base64 = btoa(binary);
								return {
									id: crypto.randomUUID(),
									type: 'data' as const,
									source: {
										type: 'base64' as const,
										media_type: file.type || 'application/octet-stream',
										data: base64,
									},
									name: file.name,
								};
							}}
						/>
					</div>
				</div>
				<div className="flex flex-col h-full gap-2 p-2">
					<Button
						size="icon-sm"
						variant="ghost"
						title={t('right-panel.toggle')}
						onClick={() => setRightPanelOpen((open) => !open)}
					>
						{rightPanelOpen ? <PanelRightClose /> : <PanelRightOpen />}
					</Button>
					{/* 工作区抽屉（MCP/技能）：打开入口在用户菜单，
					 * 此处仅渲染抽屉本体（受控）。 */}
					<WorkspaceDrawer
						open={workspaceDrawerOpen}
						onOpenChange={onWorkspaceDrawerOpenChange}
						mcps={mcps}
						loading={mcpsLoading}
						onAdd={addMcps}
						onRemove={removeMcp}
						skills={skills}
						skillsLoading={skillsLoading}
						onAddSkill={addSkill}
						onRemoveSkill={removeSkill}
					/>
				</div>
				{rightPanelOpen && (
					<aside className="hidden md:flex w-72 lg:w-80 shrink-0 flex-col border-l">
						<Tabs
							defaultValue="tasks"
							className="flex min-h-0 flex-1 flex-col gap-2 p-2"
						>
							<TabsList className="w-full">
								<TabsTrigger value="tasks">{t('right-panel.tasks')}</TabsTrigger>
								<TabsTrigger value="files">{t('right-panel.files')}</TabsTrigger>
							</TabsList>
							<TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto">
								{tasksContext && tasksContext.tasks.length > 0 ? (
									<TaskPanel tasksContext={tasksContext} className="w-full" />
								) : (
									<div className="flex h-full flex-col items-center justify-center gap-y-2 p-4">
										<ClipboardList className="size-8 text-muted-foreground" />
										<p className="text-center text-muted-foreground text-xs">
											{t('task-panel.noTasks')}
										</p>
									</div>
								)}
							</TabsContent>
							<TabsContent
								value="files"
								className="flex min-h-0 flex-1 flex-col overflow-hidden"
							>
								<ProjectFilesPanel project={currentProject} className="flex-1" />
							</TabsContent>
						</Tabs>
					</aside>
				)}
			</main>
		</>
	);
}
