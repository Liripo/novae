import { Loader2, LogOut, UserPlus } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import type { MeResponse, UserInfo } from '@/api';
import { authApi, userApi } from '@/api';
import { getStoredUser, logout } from '@/api/client';
import { ProjectFilesPanel } from '@/components/project/ProjectFilesPanel';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import i18n from '@/i18n';
import { useTranslation } from '@/i18n/useI18n';

export type SettingsTab = 'account' | 'general' | 'files' | 'users' | 'about';

interface SettingsDialogContextValue {
	/** Open the settings dialog, optionally pre-selecting a tab. */
	openSettings: (tab?: SettingsTab) => void;
}

const SettingsDialogContext = createContext<SettingsDialogContextValue>({
	openSettings: () => {},
});

export const useSettingsDialog = () => useContext(SettingsDialogContext);

/**
 * Holds the global settings-dialog state and renders the dialog. Mounted
 * once in AppLayout; the single entry point is the chat sidebar's user
 * card (settings / logout dropdown).
 */
export function SettingsDialogProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<SettingsTab>('account');

	const openSettings = useCallback((next: SettingsTab = 'account') => {
		setTab(next);
		setOpen(true);
	}, []);
	const value = useMemo(() => ({ openSettings }), [openSettings]);

	return (
		<SettingsDialogContext.Provider value={value}>
			{children}
			<SettingsDialog open={open} onOpenChange={setOpen} tab={tab} onTabChange={setTab} />
		</SettingsDialogContext.Provider>
	);
}

interface SettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tab: SettingsTab;
	onTabChange: (tab: SettingsTab) => void;
}

/**
 * Application settings, opencode-style: account (profile + logout),
 * general (language), files (browse the whole user workspace), users
 * (admin-only user management) and about (product + version).
 */
function SettingsDialog({ open, onOpenChange, tab, onTabChange }: SettingsDialogProps) {
	const { t } = useTranslation();
	const [me, setMe] = useState<MeResponse | null>(null);

	// Users-tab state (admin only).
	const [users, setUsers] = useState<UserInfo[]>([]);
	const [newUsername, setNewUsername] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
	const [creating, setCreating] = useState(false);

	const isAdmin = me?.role === 'admin';

	const loadUsers = useCallback(async () => {
		try {
			const res = await userApi.list();
			setUsers(res.users);
		} catch {
			// Non-admin or transient failure — the client already toasted.
			setUsers([]);
		}
	}, []);

	// Refresh remote data each time the dialog opens.
	useEffect(() => {
		if (!open) return;
		authApi
			.me()
			.then(setMe)
			.catch(() => setMe(null));
	}, [open]);

	useEffect(() => {
		if (open && isAdmin) loadUsers();
	}, [open, isAdmin, loadUsers]);

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
			await loadUsers();
		} catch {
			// Failure toast is emitted by the API client already.
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{t('settings.title')}</DialogTitle>
					<DialogDescription>{t('settings.description')}</DialogDescription>
				</DialogHeader>
				<Tabs value={tab} onValueChange={(v) => onTabChange(v as SettingsTab)}>
					<TabsList className="w-full">
						<TabsTrigger value="account" className="flex-1">
							{t('settings.accountTab')}
						</TabsTrigger>
						<TabsTrigger value="general" className="flex-1">
							{t('settings.generalTab')}
						</TabsTrigger>
						<TabsTrigger value="files" className="flex-1">
							{t('settings.filesTab')}
						</TabsTrigger>
						{isAdmin && (
							<TabsTrigger value="users" className="flex-1">
								{t('settings.usersTab')}
							</TabsTrigger>
						)}
						<TabsTrigger value="about" className="flex-1">
							{t('settings.aboutTab')}
						</TabsTrigger>
					</TabsList>

					<TabsContent value="account">
						<FieldGroup>
							<Field>
								<FieldLabel>{t('settings.username')}</FieldLabel>
								<div className="flex items-center gap-x-2">
									<span className="flex size-7 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
										{(username || '?').charAt(0).toUpperCase()}
									</span>
									<span className="text-sm">{username}</span>
								</div>
							</Field>
							<Field>
								<FieldLabel>{t('settings.role')}</FieldLabel>
								<span className="text-sm">{me?.role ?? '-'}</span>
							</Field>
							<Separator />
							<Button variant="destructive" className="w-fit" onClick={logout}>
								<LogOut />
								{t('account.logout')}
							</Button>
						</FieldGroup>
					</TabsContent>

					<TabsContent value="general">
						<FieldGroup>
							<Field>
								<FieldLabel>{t('settings.language')}</FieldLabel>
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
							</Field>
						</FieldGroup>
					</TabsContent>

					<TabsContent value="files">
						<div className="flex flex-col gap-y-2">
							<p className="text-muted-foreground text-xs">{t('settings.filesHint')}</p>
							<div className="h-[380px] overflow-hidden rounded-md border">
								<ProjectFilesPanel userMode className="h-full" />
							</div>
						</div>
					</TabsContent>

					{isAdmin && (
						<TabsContent value="users">
							<FieldGroup>
								<Field>
									<FieldLabel>{t('settings.users.listLabel')}</FieldLabel>
									<ul className="flex max-h-40 flex-col gap-y-1 overflow-auto rounded-md border p-2">
										{users.map((user) => (
											<li
												key={user.username}
												className="flex items-center justify-between text-sm"
											>
												<span className="flex items-center gap-x-2">
													<span className="flex size-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
														{user.username.charAt(0).toUpperCase()}
													</span>
													{user.username}
												</span>
												<span className="text-muted-foreground text-xs">
													{user.role === 'admin'
														? t('settings.users.roleAdmin')
														: t('settings.users.roleUser')}
												</span>
											</li>
										))}
									</ul>
								</Field>
								<Separator />
								<Field>
									<FieldLabel>{t('settings.users.createTitle')}</FieldLabel>
									<div className="flex flex-col gap-y-2">
										<Input
											value={newUsername}
											onChange={(e) => setNewUsername(e.target.value)}
											placeholder={t('settings.users.usernamePlaceholder')}
											autoComplete="off"
										/>
										<Input
											type="password"
											value={newPassword}
											onChange={(e) => setNewPassword(e.target.value)}
											placeholder={t('settings.users.passwordPlaceholder')}
											autoComplete="new-password"
										/>
										<div className="flex items-center gap-x-2">
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
										</div>
									</div>
								</Field>
							</FieldGroup>
						</TabsContent>
					)}

					<TabsContent value="about">
						<FieldGroup>
							<div className="flex flex-col gap-y-1 py-2">
								<span className="font-semibold text-base">
									{t('settings.aboutProduct')}
								</span>
								<span className="text-muted-foreground text-sm">
									{t('settings.aboutTagline')}
								</span>
							</div>
							<Separator />
							<Field>
								<FieldLabel>{t('settings.version')}</FieldLabel>
								<span className="font-mono text-sm">0.1.0</span>
							</Field>
						</FieldGroup>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
