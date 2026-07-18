import {
	BotMessageSquare,
	CalendarClock,
	ChevronRight,
	Compass,
	Ellipsis,
	Folder,
	FolderOpen,
	FolderPlus,
	LogOut,
	MessageSquareDashed,
	MessageSquarePlus,
	Pencil,
	Plus,
	Settings,
	Trash2,
} from 'lucide-react';
import { useOnborda } from 'onborda';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ChatViewport } from './ChatViewport';
import type { Project, SessionRecord, SessionView } from '@/api';
import { sessionApi } from '@/api';
import { getStoredUser, logout } from '@/api/client';
import Logo from '@/assets/images/novae.svg?react';
import { DeleteDialog } from '@/components/dialog/DeleteDialog';
import { ProjectDialog, type ProjectFormValues } from '@/components/dialog/ProjectDialog';
import { RenameSessionDialog } from '@/components/dialog/RenameSessionDialog';
import { useSettingsDialog } from '@/components/dialog/SettingsDialog';
import { TeamSidebar } from '@/components/team/TeamSidebar';
import { ChatTourController } from '@/components/tour/ChatTourController';
import { CHAT_TOUR_NAME } from '@/components/tour/chatTourSteps';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
	EmptyDescription,
	EmptyContent,
	EmptyMedia,
} from '@/components/ui/empty';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	useSidebar,
} from '@/components/ui/sidebar';
import { AudioProvider } from '@/context/AudioContext';
import { useAgents } from '@/hooks/useAgents';
import { useProjects } from '@/hooks/useProjects';
import { useAllSessions, useSessions } from '@/hooks/useSessions';
import { useTranslation } from '@/i18n/useI18n.ts';
import { cn } from '@/lib/utils';

/**
 * The chat page's outer shell. Responsibilities split cleanly:
 *
 * - **This component** owns *which* `(agent, session)` is being
 *   viewed. The URL is the single source of truth: every selection
 *   (project session row, "other session" row, team member, new
 *   session) is a ``navigate(...)`` call. State is derived from
 *   ``useParams``, never duplicated in React state. Renders the
 *   SciOmni-style left sidebar (brand + "新项目" + project tree with
 *   nested sessions + legacy "其他会话" group + user footer) and
 *   computes the ``effective`` ids to feed the chat viewport.
 * - **`ChatViewport`** owns *what* to render for that pair: messages,
 *   model selector, permission mode, workspace drawer, and the right
 *   panel (tasks + project files).
 *
 * Splitting along this seam means switching between the leader's
 * session and a focused team member is just a prop change for the
 * viewport — the leader's session list stays anchored in this outer
 * sidebar. Driving everything off URL also gets us browser back /
 * forward, shareable links, and refresh-preserving state for free.
 *
 * @returns The chat page JSX.
 */
const ChatPageInner = () => {
	const navigate = useNavigate();
	const {
		agentId: urlAgentId,
		sessionId: urlSessionId,
		memberId: urlMemberId,
	} = useParams<{
		agentId?: string;
		sessionId?: string;
		memberId?: string;
	}>();
	const { t } = useTranslation();
	const { agents } = useAgents();
	const {
		sessions,
		refetch: refetchSessions,
	} = useSessions(urlAgentId ?? null);
	const {
		projects,
		create: createProject,
		update: updateProject,
		remove: removeProject,
	} = useProjects();
	const { sessions: allSessions, refetch: refetchAllSessions } = useAllSessions(agents);

	const { isMobile, setOpen, setOpenMobile } = useSidebar();
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameSession, setRenameSession] = useState<SessionRecord | null>(null);
	const [deleteSessionOpen, setDeleteSessionOpen] = useState(false);
	const [sessionToDelete, setSessionToDelete] = useState<SessionRecord | null>(null);
	const [projectDialogOpen, setProjectDialogOpen] = useState(false);
	const [editingProject, setEditingProject] = useState<Project | null>(null);
	const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
	const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
	// Collapse state per project id; absent = auto (open when it holds the
	// current session).
	const [projectOpen, setProjectOpen] = useState<Record<string, boolean>>({});
	const [otherOpen, setOtherOpen] = useState(false);

	const currentView = sessions.find((v) => v.session.id === urlSessionId) ?? null;
	const hasScheduleSessions = allSessions.some((v) => v.session.source === 'schedule');
	const username = getStoredUser();
	const { openSettings } = useSettingsDialog();
	// 新手引导触发器（原在最左图标栏，现并入用户卡片菜单）
	const { startOnborda } = useOnborda();

	// Group every session by its owning project (workspace_id match);
	// sessions that belong to no known project fall into "其他会话".
	const { sessionsByProject, otherSessions } = useMemo(() => {
		const projectIds = new Set(projects.map((p) => p.id));
		const byProject = new Map<string, SessionView[]>();
		const others: SessionView[] = [];
		for (const view of allSessions) {
			const workspaceId = view.session.config?.workspace_id;
			if (workspaceId && projectIds.has(workspaceId)) {
				const list = byProject.get(workspaceId) ?? [];
				list.push(view);
				byProject.set(workspaceId, list);
			} else {
				others.push(view);
			}
		}
		return { sessionsByProject: byProject, otherSessions: others };
	}, [allSessions, projects]);

	const currentProjectId = currentView?.session.config?.workspace_id ?? null;

	// "Inner focus" — when the URL carries a third `:memberId` segment
	// the user is drilling into a team member's chat. The main sidebar
	// stays anchored on the outer (leader) session; only the chat
	// viewport follows this inner focus. When `urlMemberId` is
	// undefined or doesn't resolve to a known team member, the inner
	// focus collapses back to the outer (leader) session.
	const focusedMember = urlMemberId
		? (currentView?.team?.members.find((m) => m.agent.id === urlMemberId) ?? null)
		: null;
	const effectiveAgentId =
		focusedMember && focusedMember.session_id ? focusedMember.agent.id : (urlAgentId ?? null);
	const effectiveSessionId =
		focusedMember && focusedMember.session_id
			? focusedMember.session_id
			: (urlSessionId ?? null);

	// Redirect: URL is missing an agent → pick the first one and rewrite
	// the URL in-place (replace so we don't pollute history).
	useEffect(() => {
		if (!urlAgentId && agents.length > 0) {
			navigate(`/chat/${agents[0].id}`, { replace: true });
		}
	}, [agents, urlAgentId, navigate]);

	// Redirect: URL has an agent but no session, or its sessionId no
	// longer exists for this agent → pick the first available session.
	useEffect(() => {
		if (!urlAgentId || sessions.length === 0) return;
		const matches = urlSessionId && sessions.some((v) => v.session.id === urlSessionId);
		if (matches) return;
		navigate(`/chat/${urlAgentId}/${sessions[0].session.id}`, { replace: true });
	}, [urlAgentId, urlSessionId, sessions, navigate]);

	const refetchBothSessionLists = async () => {
		await Promise.all([refetchSessions(), refetchAllSessions()]);
	};

	/**
	 * Build the model-config seed for a new session under ``agentId``:
	 * inherit the model + fallback of the currently open session when it
	 * belongs to that agent, otherwise of any existing session under
	 * that agent (keeps the model choice sticky across sessions).
	 */
	const seedModelConfig = (agentId: string) => {
		const current =
			currentView?.session.agent_id === agentId ? currentView.session.config : null;
		const fallback = allSessions.find((v) => v.session.agent_id === agentId)?.session
			.config;
		const seed = current ?? fallback;
		return seed
			? {
					...(seed.chat_model_config
						? { chat_model_config: seed.chat_model_config }
						: {}),
					...(seed.fallback_chat_model_config
						? { fallback_chat_model_config: seed.fallback_chat_model_config }
						: {}),
				}
			: {};
	};

	/**
	 * Create a session bound to a project (``workspace_id = project.id``)
	 * under the project's agent, then navigate to it.
	 */
	const handleCreateSessionInProject = async (project: Project) => {
		const res = await sessionApi.create({
			agent_id: project.agent_id,
			workspace_id: project.id,
			...seedModelConfig(project.agent_id),
		});
		await refetchBothSessionLists();
		navigate(`/chat/${project.agent_id}/${res.session_id}`);
		setOpenMobile(false);
	};

	const handleDeleteSession = async (session: SessionRecord) => {
		await sessionApi.delete(session.id, session.agent_id);
		await refetchBothSessionLists();
		// If we just removed the session the URL is pointing at, fall
		// back to the parent /chat/:agentId path; the redirect effect
		// will then pick the next available session.
		if (session.id === urlSessionId) {
			navigate(`/chat/${session.agent_id}`, { replace: true });
		}
	};

	const requestDeleteSession = (session: SessionRecord) => {
		setSessionToDelete(session);
		setDeleteSessionOpen(true);
	};

	const handleRenameConfirm = async (name: string) => {
		if (!renameSession) return;
		await sessionApi.update(renameSession.id, renameSession.agent_id, { name });
		await refetchBothSessionLists();
	};

	const requestCreateProject = () => {
		setEditingProject(null);
		setProjectDialogOpen(true);
	};

	const requestRenameProject = (project: Project) => {
		setEditingProject(project);
		setProjectDialogOpen(true);
	};

	const requestDeleteProject = (project: Project) => {
		setProjectToDelete(project);
		setDeleteProjectOpen(true);
	};

	const handleProjectConfirm = async (values: ProjectFormValues) => {
		if (editingProject) {
			await updateProject(editingProject.id, {
				name: values.name,
				description: values.description,
			});
		} else {
			await createProject(values);
		}
	};

	const handleDeleteProjectConfirm = async () => {
		if (!projectToDelete) return;
		const wasCurrent = currentProjectId === projectToDelete.id;
		await removeProject(projectToDelete.id);
		await refetchBothSessionLists();
		if (wasCurrent) {
			navigate('/chat', { replace: true });
		}
	};

	const openSession = (view: SessionView) => {
		navigate(`/chat/${view.session.agent_id}/${view.session.id}`);
		setOpenMobile(false);
	};

	const renderSessionIcon = (view: SessionView) =>
		hasScheduleSessions ? (
			view.session.source === 'schedule' ? (
				<CalendarClock />
			) : (
				<BotMessageSquare />
			)
		) : null;

	const renderSessionActions = (session: SessionRecord) => (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-opacity group-hover/session:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-accent"
					onClick={(e) => e.stopPropagation()}
				>
					<Ellipsis className="size-4" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="right" align="start">
				<DropdownMenuItem
					onClick={() => {
						setRenameSession(session);
						setRenameOpen(true);
					}}
				>
					<Pencil />
					{t('session-menu.rename')}
				</DropdownMenuItem>
				<DropdownMenuItem
					variant="destructive"
					onClick={() => requestDeleteSession(session)}
				>
					<Trash2 />
					{t('session-menu.delete')}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	const renderSessionRow = (view: SessionView) => {
		const session = view.session;
		return (
			<SidebarMenuSubItem key={session.id} className="group/session relative">
				<div className="flex items-center">
					<SidebarMenuSubButton
						isActive={urlSessionId === session.id}
						onClick={() => openSession(view)}
						className="flex-1 cursor-pointer"
					>
						{renderSessionIcon(view)}
						<span className="truncate">{session.config.name || session.id}</span>
						{/* 运行中的会话显示脉冲状态点（参考 hermes 桌面版） */}
						{view.is_running && (
							<span className="ml-auto relative flex size-2 shrink-0">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
								<span className="relative inline-flex size-2 rounded-full bg-primary" />
							</span>
						)}
					</SidebarMenuSubButton>
					{renderSessionActions(session)}
				</div>
			</SidebarMenuSubItem>
		);
	};

	return (
		<div className="flex h-full w-full">
			{/*
			 * 桌面端保持 `collapsible="none"`，项目树常驻在页面左侧；
			 * 移动端切换为 `offcanvas`，shadcn 的 Sidebar 会渲染 Sheet 抽屉，
			 * 避免桌面端 `fixed left-0` 容器遮挡内容。
			 */}
			<Sidebar collapsible={isMobile ? 'offcanvas' : 'none'} className="border-r">
				<SidebarHeader>
					<div className="flex flex-col gap-y-2">
						<div className="flex items-center justify-between px-1 pt-1">
							<div className="flex items-center gap-x-2">
								<Logo className="size-7 shrink-0" />
								<div className="flex flex-col">
									<span className="text-base font-semibold tracking-wide">Novae</span>
									<span className="text-muted-foreground text-xs">
										{t('common.brandSubtitle')}
									</span>
								</div>
							</div>
						</div>
						<Button
							id="tour-create-project"
							className="w-full"
							disabled={agents.length === 0}
							onClick={requestCreateProject}
						>
							<FolderPlus />
							{t('chat.project.create')}
						</Button>
						{agents.length === 0 && (
							<p className="px-1 text-muted-foreground text-xs">
								{t('chat.project.noAgentHint')}
							</p>
						)}
					</div>
				</SidebarHeader>
				<SidebarContent className="my-2">
					<SidebarGroup>
						<SidebarGroupLabel>{t('chat.project.label')}</SidebarGroupLabel>
						<SidebarGroupAction asChild>
							<div>
								<Button
									size="icon-xs"
									variant="default"
									disabled={agents.length === 0}
									title={t('chat.project.create')}
									onClick={requestCreateProject}
								>
									<Plus />
								</Button>
							</div>
						</SidebarGroupAction>
						<SidebarGroupContent>
							{projects.length === 0 ? (
								<Empty className="border-none py-4 min-h-50">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<Folder />
										</EmptyMedia>
										<EmptyTitle>{t('chat.project.emptyTitle')}</EmptyTitle>
										<EmptyDescription>
											{t('chat.project.emptyDescription')}
										</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										<Button
											variant="outline"
											size="sm"
											disabled={agents.length === 0}
											onClick={requestCreateProject}
										>
											<FolderPlus />
											{t('chat.project.create')}
										</Button>
									</EmptyContent>
								</Empty>
							) : (
								<SidebarMenu>
									{projects.map((project) => {
										const isOpen =
											projectOpen[project.id] ?? currentProjectId === project.id;
										const projectSessions =
											sessionsByProject.get(project.id) ?? [];
										return (
											<Collapsible
												key={project.id}
												open={isOpen}
												onOpenChange={(open) =>
													setProjectOpen((prev) => ({
														...prev,
														[project.id]: open,
													}))
												}
											>
												<SidebarMenuItem className="group/project">
													<div className="flex items-center">
														<CollapsibleTrigger asChild>
															<SidebarMenuButton
																className="flex-1 cursor-pointer"
																isActive={currentProjectId === project.id}
															>
																<ChevronRight
																	className={cn(
																		'shrink-0 transition-transform',
																		isOpen && 'rotate-90',
																	)}
																/>
																{isOpen ? (
																	<FolderOpen className="shrink-0" />
																) : (
																	<Folder className="shrink-0" />
																)}
																<span className="truncate">
																	{project.name}
																</span>
															</SidebarMenuButton>
														</CollapsibleTrigger>
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<button
																	type="button"
																	className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-opacity group-hover/project:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-accent"
																>
																	<Ellipsis className="size-4" />
																</button>
															</DropdownMenuTrigger>
															<DropdownMenuContent side="right" align="start">
																<DropdownMenuItem
																	onClick={() =>
																		handleCreateSessionInProject(project)
																	}
																>
																	<MessageSquarePlus />
																	{t('chat.project.newSessionInProject')}
																</DropdownMenuItem>
																<DropdownMenuItem
																	onClick={() => requestRenameProject(project)}
																>
																	<Pencil />
																	{t('session-menu.rename')}
																</DropdownMenuItem>
																<DropdownMenuItem
																	variant="destructive"
																	onClick={() => requestDeleteProject(project)}
																>
																	<Trash2 />
																	{t('session-menu.delete')}
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
													</div>
													<CollapsibleContent>
														<SidebarMenuSub>
															{projectSessions.length === 0 ? (
																<SidebarMenuSubItem>
																	<span className="px-2 py-1 text-muted-foreground text-xs">
																		{t('chat.noSessions')}
																	</span>
																</SidebarMenuSubItem>
															) : (
																projectSessions.map(renderSessionRow)
															)}
														</SidebarMenuSub>
													</CollapsibleContent>
												</SidebarMenuItem>
											</Collapsible>
										);
									})}
								</SidebarMenu>
							)}
						</SidebarGroupContent>
					</SidebarGroup>
					{otherSessions.length > 0 && (
						<SidebarGroup>
							<Collapsible open={otherOpen} onOpenChange={setOtherOpen}>
								<SidebarMenu>
									<SidebarMenuItem>
										<CollapsibleTrigger asChild>
											<SidebarMenuButton className="cursor-pointer">
												<ChevronRight
													className={cn(
														'shrink-0 transition-transform',
														otherOpen && 'rotate-90',
													)}
												/>
												<MessageSquareDashed className="shrink-0" />
												<span className="truncate">
													{t('chat.project.otherSessions')}
												</span>
												<span className="ml-auto text-muted-foreground text-xs">
													{otherSessions.length}
												</span>
											</SidebarMenuButton>
										</CollapsibleTrigger>
										<CollapsibleContent>
											<SidebarMenuSub>
												{otherSessions.map(renderSessionRow)}
											</SidebarMenuSub>
										</CollapsibleContent>
									</SidebarMenuItem>
								</SidebarMenu>
							</Collapsible>
						</SidebarGroup>
					)}
				</SidebarContent>
				<SidebarFooter>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="flex w-full items-center gap-x-2 rounded-md px-1 py-1 text-left hover:bg-accent"
							>
								<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
									{(username || '?').charAt(0).toUpperCase()}
								</span>
								<span className="truncate text-sm">{username}</span>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent side="top" align="start" className="w-44">
							<DropdownMenuItem onClick={() => openSettings('account')}>
								<Settings />
								{t('common.settings')}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => navigate('/schedule')}>
									<CalendarClock />
									{t('common.schedule')}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => startOnborda(CHAT_TOUR_NAME)}>
									<Compass />
									{t('tour.trigger')}
								</DropdownMenuItem>
								<DropdownMenuItem variant="destructive" onClick={logout}>
								<LogOut />
								{t('account.logout')}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarFooter>
			</Sidebar>
			{/*
			 * Team sidebar lives at the outer page level (not inside
			 * ChatViewport) so navigating between leader and member
			 * sessions does NOT unmount it. The team data comes from
			 * the leader's session view, which is stable across that
			 * navigation; only `currentSessionId` changes to drive
			 * row highlighting.
			 */}
			{currentView?.team && effectiveSessionId && (
				<TeamSidebar team={currentView.team} currentSessionId={effectiveSessionId} />
			)}
			<div className="flex flex-1 min-w-0">
				<ChatViewport
					agentId={effectiveAgentId}
					sessionId={effectiveSessionId}
					onTeamUpdated={refetchSessions}
				/>
			</div>
			<RenameSessionDialog
				open={renameOpen}
				onOpenChange={setRenameOpen}
				currentName={renameSession?.config.name ?? renameSession?.id ?? ''}
				onConfirm={handleRenameConfirm}
			/>
			<DeleteDialog
				open={deleteSessionOpen}
				onOpenChange={setDeleteSessionOpen}
				title={t('common.deleteTitle', {
					entity: t('dialog-session-delete.entity'),
					name: sessionToDelete?.config.name || sessionToDelete?.id || '',
				})}
				description={t('common.deleteDescription')}
				confirmLabel={t('dialog-session-delete.confirm')}
				onConfirm={async () => {
					if (sessionToDelete) {
						await handleDeleteSession(sessionToDelete);
					}
				}}
			/>
			<ProjectDialog
				open={projectDialogOpen}
				onOpenChange={setProjectDialogOpen}
				project={editingProject}
				agents={agents}
				onConfirm={handleProjectConfirm}
			/>
			<DeleteDialog
				open={deleteProjectOpen}
				onOpenChange={setDeleteProjectOpen}
				title={t('common.deleteTitle', {
					entity: t('dialog-project-delete.entity'),
					name: projectToDelete?.name ?? '',
				})}
				description={t('dialog-project-delete.description')}
				confirmLabel={t('dialog-project-delete.confirm')}
				onConfirm={handleDeleteProjectConfirm}
			/>
			<ChatTourController
				projectsCount={projects.length}
				onEnsureSidebarOpen={() => {
					setOpen(true);
					setOpenMobile(true);
				}}
			/>
		</div>
	);
};

export const ChatPage = () => (
	<AudioProvider>
		{/* h-full min-h-0：让聊天页高度链在 AppLayout 的定高容器内闭合，
		    消息列表内部滚动，输入框与侧栏底栏固定在可视区内 */}
		<SidebarProvider defaultOpen className="h-full min-h-0">
			<ChatPageInner />
		</SidebarProvider>
	</AudioProvider>
);
