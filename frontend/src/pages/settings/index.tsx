import {
	ArrowLeft,
	BarChart3,
	FolderOpen,
	Info,
	Loader2,
	LogOut,
	Trash2,
	User,
	UserPlus,
	Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import type { MeResponse, UserInfo } from '@/api';
import { authApi, metaApi, userApi } from '@/api';
import { getStoredUser, logout } from '@/api/client';
import { ProjectFilesPanel } from '@/components/project/ProjectFilesPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import i18n from '@/i18n';
import { useTranslation } from '@/i18n/useI18n';

import { UsageSection } from './UsageSection';

/** 设置页分节（与路由参数 :section 对应）。 */
const SECTIONS = ['account', 'files', 'users', 'usage', 'about'] as const;
type SettingsSection = (typeof SECTIONS)[number];

/** zcode 风格的设置行：左侧标签+说明，右侧控件。 */
function SettingRow({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
			<div className="flex min-w-0 flex-col gap-y-0.5">
				<span className="text-sm font-medium">{label}</span>
				{description && (
					<span className="text-muted-foreground text-xs">{description}</span>
				)}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

/**
 * 全页设置界面（zcode 风格）：左侧分节导航 + 「返回工作区」，右侧分节内容。
 * 分节：账户（资料卡+语言+退出）、文件（浏览用户工作区）、用户（管理员）、
 * 使用统计（卡片+热力图+趋势图）、关于（产品+后端真实版本）。
 */
export function SettingsPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { section: rawSection } = useParams<{ section?: string }>();
	const [me, setMe] = useState<MeResponse | null>(null);
	// 后端版本号（来自 pyproject，经 GET /meta）
	const [version, setVersion] = useState('-');

	// Users-section state (admin only).
	const [users, setUsers] = useState<UserInfo[]>([]);
	const [newUsername, setNewUsername] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
	const [creating, setCreating] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	// 修改当前用户密码弹窗状态
	const [pwdOpen, setPwdOpen] = useState(false);
	const [oldPwd, setOldPwd] = useState('');
	const [newPwd, setNewPwd] = useState('');
	const [confirmPwd, setConfirmPwd] = useState('');
	const [pwdChanging, setPwdChanging] = useState(false);

	const isAdmin = me?.role === 'admin';

	// 非法分节回退到账户；非管理员看不到 users 分节
	const section: SettingsSection = SECTIONS.includes(rawSection as SettingsSection)
		? (rawSection as SettingsSection)
		: 'account';
	const activeSection = section === 'users' && me !== null && !isAdmin ? 'account' : section;

	const loadUsers = useCallback(async () => {
		try {
			const res = await userApi.list();
			setUsers(res.users);
		} catch {
			// Non-admin or transient failure — the client already toasted.
			setUsers([]);
		}
	}, []);

	useEffect(() => {
		authApi
			.me()
			.then(setMe)
			.catch(() => setMe(null));
		metaApi
			.version()
			.then((res) => setVersion(res.version))
			.catch(() => setVersion('-'));
	}, []);

	useEffect(() => {
		if (isAdmin) loadUsers();
	}, [isAdmin, loadUsers]);

	const username = me?.username ?? getStoredUser();
	const language = i18n.language.startsWith('zh') ? 'zh' : 'en';

	const handleCreateUser = async () => {
		const name = newUsername.trim();
		if (!name || !newPassword) return;
		setCreating(true);
		try {
			await userApi.create({ username: name, password: newPassword, role: newRole });
			toast.success(t('settings.users.created', { name }));
			setNewUsername('');
			setNewPassword('');
			setNewRole('user');
			setCreateOpen(false);
			await loadUsers();
		} catch {
			// Failure toast is emitted by the API client already.
		} finally {
			setCreating(false);
		}
	};

	// 修改当前用户密码：前端先校验一致性，后端再验旧密码
	const handleChangePassword = async () => {
		if (!newPwd) {
			toast.error(t('settings.password.empty'));
			return;
		}
		if (newPwd !== confirmPwd) {
			toast.error(t('settings.password.mismatch'));
			return;
		}
		setPwdChanging(true);
		try {
			await authApi.changePassword({ old_password: oldPwd, new_password: newPwd });
			toast.success(t('settings.password.changed'));
			setPwdOpen(false);
			setOldPwd('');
			setNewPwd('');
			setConfirmPwd('');
		} catch {
			// Failure toast is emitted by the API client already.
		} finally {
			setPwdChanging(false);
		}
	};

	// 删除用户（管理员）：确认弹窗 -> 调接口 -> 刷新列表
	const handleDelete = async () => {
		if (!deleteTarget) return;
		setDeleting(true);
		try {
			await userApi.delete(deleteTarget);
			toast.success(t('settings.users.deleted', { name: deleteTarget }));
			setDeleteTarget(null);
			await loadUsers();
		} catch {
			// Failure toast is emitted by the API client already.
		} finally {
			setDeleting(false);
		}
	};

	const navItems: {
		key: SettingsSection;
		label: string;
		icon: ReactNode;
		adminOnly?: boolean;
	}[] = [
		{ key: 'account', label: t('settings.accountTab'), icon: <User /> },
		{ key: 'files', label: t('settings.filesTab'), icon: <FolderOpen /> },
		{
			key: 'users',
			label: t('settings.usersTab'),
			icon: <Users />,
			adminOnly: true,
		},
		{ key: 'usage', label: t('settings.usageTab'), icon: <BarChart3 /> },
		{ key: 'about', label: t('settings.aboutTab'), icon: <Info /> },
	];

	const sectionTitles: Record<SettingsSection, string> = {
		account: t('settings.accountTab'),
		files: t('settings.filesTab'),
		users: t('settings.usersTab'),
		usage: t('settings.usageTab'),
		about: t('settings.aboutTab'),
	};

	return (
		<div className="flex h-full w-full">
			{/* 左侧分节导航（zcode 风格） */}
			<aside className="flex w-52 shrink-0 flex-col gap-y-1 border-r p-3">
				<button
					type="button"
					onClick={() => navigate('/chat')}
					className="mb-3 flex items-center gap-x-2 rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
				>
					<ArrowLeft className="size-4" />
					{t('settings.backToWorkspace')}
				</button>
				{navItems
					.filter((item) => !item.adminOnly || isAdmin)
					.map((item) => (
						<button
							key={item.key}
							type="button"
							onClick={() => navigate(`/settings/${item.key}`)}
							className={`flex items-center gap-x-2 rounded-md px-2 py-1.5 text-sm ${
								activeSection === item.key
									? 'bg-accent font-medium'
									: 'text-muted-foreground hover:bg-accent hover:text-foreground'
							}`}
						>
							<span className="[&>svg]:size-4">{item.icon}</span>
							{item.label}
						</button>
					))}
			</aside>

			{/* 右侧分节内容 */}
			<main className="min-w-0 flex-1 overflow-y-auto p-6">
				<div className="mx-auto flex max-w-2xl flex-col gap-y-4">
					<h1 className="font-semibold text-xl">{sectionTitles[activeSection]}</h1>

					{activeSection === 'account' && (
						<>
							{/* 资料卡：大头像 + 用户名 + 角色徽章 */}
							<div className="flex items-center gap-x-4 rounded-lg border p-5">
								<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-lg text-primary-foreground">
									{(username || '?').charAt(0).toUpperCase()}
								</span>
								<div className="flex min-w-0 flex-col gap-y-1">
									<span className="truncate font-semibold text-base">{username}</span>
									<span className="w-fit rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
										{me?.role === 'admin'
											? t('settings.users.roleAdmin')
											: t('settings.users.roleUser')}
									</span>
								</div>
							</div>
							<SettingRow
								label={t('settings.language')}
								description={t('settings.languageHint')}
							>
								<div className="flex gap-x-2">
									<Button
										variant={language === 'zh' ? 'default' : 'outline'}
										size="sm"
										onClick={() => i18n.changeLanguage('zh')}
									>
										中文
									</Button>
									<Button
										variant={language === 'en' ? 'default' : 'outline'}
										size="sm"
										onClick={() => i18n.changeLanguage('en')}
									>
										English
									</Button>
								</div>
							</SettingRow>
							<SettingRow label={t('settings.password.label')}>
								<Button variant="outline" size="sm" onClick={() => setPwdOpen(true)}>
									{t('settings.password.change')}
								</Button>
							</SettingRow>
							<Separator />
							<Button variant="destructive" className="w-fit" onClick={logout}>
								<LogOut />
								{t('account.logout')}
							</Button>

							{/* 修改密码弹窗 */}
							<Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>{t('settings.password.label')}</DialogTitle>
									</DialogHeader>
									<FieldGroup>
										<Field>
											<FieldLabel>{t('settings.password.current')}</FieldLabel>
											<Input
												type="password"
												value={oldPwd}
												onChange={(e) => setOldPwd(e.target.value)}
												autoComplete="current-password"
											/>
										</Field>
										<Field>
											<FieldLabel>{t('settings.password.new')}</FieldLabel>
											<Input
												type="password"
												value={newPwd}
												onChange={(e) => setNewPwd(e.target.value)}
												autoComplete="new-password"
											/>
										</Field>
										<Field>
											<FieldLabel>{t('settings.password.confirm')}</FieldLabel>
											<Input
												type="password"
												value={confirmPwd}
												onChange={(e) => setConfirmPwd(e.target.value)}
												autoComplete="new-password"
											/>
										</Field>
									</FieldGroup>
									<DialogFooter>
										<Button variant="outline" onClick={() => setPwdOpen(false)}>
											{t('common.cancel')}
										</Button>
										<Button
											onClick={handleChangePassword}
											disabled={pwdChanging || !oldPwd || !newPwd}
										>
											{pwdChanging && <Loader2 className="animate-spin" />}
											{t('common.confirm')}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</>
					)}

					{activeSection === 'files' && (
						<div className="flex flex-col gap-y-2">
							<p className="text-muted-foreground text-xs">{t('settings.filesHint')}</p>
							<div className="h-[60vh] overflow-hidden rounded-md border">
								<ProjectFilesPanel userMode className="h-full" />
							</div>
						</div>
					)}

					{activeSection === 'users' && isAdmin && (
						<>
							{/* 顶部：用户总数 + 新建用户入口（弹窗） */}
							<div className="flex items-center justify-between gap-x-4">
								<span className="text-muted-foreground text-sm">
									{t('settings.users.total', { count: users.length })}
								</span>
								<Button size="sm" onClick={() => setCreateOpen(true)}>
									<UserPlus />
									{t('settings.users.createTitle')}
								</Button>
							</div>

							{/* 用户表格：用户 / 角色 / 创建时间 / 操作 */}
							<div className="overflow-hidden rounded-lg border">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b bg-muted/50 text-left text-muted-foreground">
											<th className="px-4 py-2 font-medium">
												{t('settings.users.colUser')}
											</th>
											<th className="px-4 py-2 font-medium">
												{t('settings.users.colRole')}
											</th>
											<th className="px-4 py-2 font-medium">
												{t('settings.users.colCreatedAt')}
											</th>
											<th className="px-4 py-2 text-right font-medium">
												{t('settings.users.colActions')}
											</th>
										</tr>
									</thead>
									<tbody>
										{users.map((user) => (
											<tr key={user.username} className="border-b last:border-0">
												<td className="px-4 py-2.5">
													<span className="flex items-center gap-x-2">
														<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
															{user.username.charAt(0).toUpperCase()}
														</span>
														{user.username}
														{user.username === username && (
															<Badge variant="outline">
																{t('settings.users.me')}
															</Badge>
														)}
													</span>
												</td>
												<td className="px-4 py-2.5">
													<Badge
														variant={
															user.role === 'admin' ? 'default' : 'secondary'
														}
													>
														{user.role === 'admin'
															? t('settings.users.roleAdmin')
															: t('settings.users.roleUser')}
													</Badge>
												</td>
												<td className="px-4 py-2.5 text-muted-foreground">
													{user.created_at ? user.created_at.slice(0, 10) : '-'}
												</td>
												<td className="px-4 py-2.5 text-right">
													<Button
														variant="ghost"
														size="icon"
														disabled={user.username === username}
														onClick={() => setDeleteTarget(user.username)}
													>
														<Trash2 className="size-4 text-destructive" />
													</Button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* 新建用户弹窗 */}
							<Dialog open={createOpen} onOpenChange={setCreateOpen}>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>{t('settings.users.createTitle')}</DialogTitle>
									</DialogHeader>
									<FieldGroup>
										<Field>
											<FieldLabel>{t('settings.users.usernamePlaceholder')}</FieldLabel>
											<Input
												value={newUsername}
												onChange={(e) => setNewUsername(e.target.value)}
												placeholder={t('settings.users.usernamePlaceholder')}
												autoComplete="off"
											/>
										</Field>
										<Field>
											<FieldLabel>{t('settings.users.passwordPlaceholder')}</FieldLabel>
											<Input
												type="password"
												value={newPassword}
												onChange={(e) => setNewPassword(e.target.value)}
												placeholder={t('settings.users.passwordPlaceholder')}
												autoComplete="new-password"
											/>
										</Field>
										<Field>
											<FieldLabel>{t('settings.users.colRole')}</FieldLabel>
											<Select
												value={newRole}
												onValueChange={(v) => setNewRole(v as 'user' | 'admin')}
											>
												<SelectTrigger className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent position="popper">
													<SelectItem value="user">
														{t('settings.users.roleUser')}
													</SelectItem>
													<SelectItem value="admin">
														{t('settings.users.roleAdmin')}
													</SelectItem>
												</SelectContent>
											</Select>
										</Field>
									</FieldGroup>
									<DialogFooter>
										<Button variant="outline" onClick={() => setCreateOpen(false)}>
											{t('common.cancel')}
										</Button>
										<Button
											onClick={handleCreateUser}
											disabled={creating || !newUsername.trim() || !newPassword}
										>
											{creating ? (
												<Loader2 className="animate-spin" />
											) : (
												<UserPlus />
											)}
											{t('common.create')}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>

							{/* 删除用户确认弹窗 */}
							<Dialog
								open={deleteTarget !== null}
								onOpenChange={(open) => {
									if (!open) setDeleteTarget(null);
								}}
							>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>{t('settings.users.deleteTitle')}</DialogTitle>
										<DialogDescription>
											{t('settings.users.deleteConfirm', { name: deleteTarget })}
										</DialogDescription>
									</DialogHeader>
									<DialogFooter>
										<Button variant="outline" onClick={() => setDeleteTarget(null)}>
											{t('common.cancel')}
										</Button>
										<Button
											variant="destructive"
											onClick={handleDelete}
											disabled={deleting}
										>
											{deleting ? (
												<Loader2 className="animate-spin" />
											) : (
												<Trash2 />
											)}
											{t('settings.users.delete')}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</>
					)}

					{activeSection === 'usage' && <UsageSection />}

					{activeSection === 'about' && (
						<>
							<div className="flex flex-col gap-y-1 py-2">
								<span className="font-semibold text-base">
									{t('settings.aboutProduct')}
								</span>
								<span className="text-muted-foreground text-sm">
									{t('settings.aboutTagline')}
								</span>
							</div>
							<SettingRow label={t('settings.version')}>
								<span className="font-mono text-sm">{version}</span>
							</SettingRow>
						</>
					)}
				</div>
			</main>
		</div>
	);
}
