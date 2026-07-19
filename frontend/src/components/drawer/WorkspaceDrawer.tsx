import { Search, Trash, PlusCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import type { MCPClient, MCPClientStatus, Skill } from '@/api';
import { AddSkillDialog } from '@/components/dialog/AddSkillDialog.tsx';
import { DeleteDialog } from '@/components/dialog/DeleteDialog.tsx';
import { CreateMCPDialog } from '@/components/dialog/MCPDialog.tsx';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from '@/components/ui/drawer';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { useTranslation } from '@/i18n/useI18n.ts';

interface WorkspaceDrawerProps {
	/** 可选触发器（DrawerTrigger 子元素）。入口外置（如用户菜单）时
	 * 不传，改用 open/onOpenChange 受控打开。 */
	children?: ReactNode;
	/** 受控打开状态（与 onOpenChange 配对）。 */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	mcps: MCPClientStatus[];
	loading?: boolean;
	onAdd: (mcps: MCPClient[]) => Promise<void>;
	onRemove: (name: string) => Promise<void>;
	skills: Skill[];
	skillsLoading?: boolean;
	onAddSkill: (skillPath: string) => Promise<void>;
	onRemoveSkill: (name: string) => Promise<void>;
}

export function WorkspaceDrawer({
	children,
	open,
	onOpenChange,
	mcps,
	loading = false,
	onAdd,
	onRemove,
	skills,
	skillsLoading = false,
	onAddSkill,
	onRemoveSkill,
}: WorkspaceDrawerProps) {
	const { t } = useTranslation();
	const [search, setSearch] = useState('');
	const [skillSearch, setSkillSearch] = useState('');
	const [activeTab, setActiveTab] = useState('mcp');
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [skillDeleteOpen, setSkillDeleteOpen] = useState(false);
	const [skillDeleteTarget, setSkillDeleteTarget] = useState<string | null>(null);

	const filtered = search
		? mcps.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
		: mcps;

	const filteredSkills = skillSearch
		? skills.filter((s) => s.name.toLowerCase().includes(skillSearch.toLowerCase()))
		: skills;

	return (
		<Drawer direction="right" open={open} onOpenChange={onOpenChange}>
			{children ? <DrawerTrigger asChild>{children}</DrawerTrigger> : null}
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{t('common.workspace')}</DrawerTitle>
					<DrawerDescription>{t('workspace-drawer.description')}</DrawerDescription>
				</DrawerHeader>
				<div className="flex flex-col no-scrollbar overflow-y-auto px-4 gap-y-2">
					<Tabs defaultValue="mcp" onValueChange={setActiveTab}>
						<TabsList className={'w-full'}>
							<TabsTrigger value={'mcp'}>MCP</TabsTrigger>
							<TabsTrigger value={'skill'}>{t('workspace-drawer.skillsTab')}</TabsTrigger>
						</TabsList>
						<TabsContent value={'mcp'} asChild>
							<div className="flex flex-col no-scrollbar overflow-y-auto gap-y-2">
								<span className={'text-muted-foreground text-sm'}>
									{t('workspace-drawer.mcpHint')}
								</span>
								<InputGroup className="mt-4">
									<InputGroupInput
										placeholder={t('workspace-drawer.mcpSearchPlaceholder')}
										value={search}
										onChange={(e) => setSearch(e.target.value)}
									/>
									<InputGroupAddon align="inline-end">
										<Search />
									</InputGroupAddon>
								</InputGroup>
								{loading ? (
									<p className="text-muted-foreground text-sm text-center py-4">
										{t('common.loading')}
									</p>
								) : filtered.length === 0 ? (
									<p className="text-muted-foreground text-sm text-center py-4">
										{t('workspace-drawer.noMcps')}
									</p>
								) : (
									filtered.map((mcp) => (
										<Item key={mcp.name} variant="outline">
											<ItemContent>
												<ItemTitle className="flex items-center gap-x-2">
													<span
														className={`size-2 shrink-0 rounded-full ${mcp.is_healthy ? 'bg-green-500' : 'bg-red-500'}`}
													/>
													{mcp.name}
												</ItemTitle>
												<ItemDescription>
													<KbdGroup>
														<Kbd>
															{mcp.mcp_config.type === 'stdio_mcp'
																? 'STDIO'
																: 'HTTP'}
														</Kbd>
														<Kbd>{t('workspace-drawer.toolsCount', { count: mcp.tools.length })}</Kbd>
													</KbdGroup>
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Button
													variant="outline"
													size="icon-sm"
													onClick={() => {
														setDeleteTarget(mcp.name);
														setDeleteOpen(true);
													}}
												>
													<Trash />
												</Button>
											</ItemActions>
										</Item>
									))
								)}
							</div>
						</TabsContent>
						<TabsContent value={'skill'} asChild>
							<div className="flex flex-col no-scrollbar overflow-y-auto gap-y-2">
								<span className={'text-muted-foreground text-sm'}>
									{t('workspace-drawer.skillsHint')}
								</span>
								<InputGroup className="mt-4">
									<InputGroupInput
										placeholder={t('workspace-drawer.skillSearchPlaceholder')}
										value={skillSearch}
										onChange={(e) => setSkillSearch(e.target.value)}
									/>
									<InputGroupAddon align="inline-end">
										<Search />
									</InputGroupAddon>
								</InputGroup>
								{skillsLoading ? (
									<p className="text-muted-foreground text-sm text-center py-4">
										{t('common.loading')}
									</p>
								) : filteredSkills.length === 0 ? (
									<p className="text-muted-foreground text-sm text-center py-4">
										{t('workspace-drawer.noSkills')}
									</p>
								) : (
									filteredSkills.map((skill) => (
										<Item key={skill.name} variant="outline">
											<ItemContent>
												<ItemTitle>{skill.name}</ItemTitle>
												<ItemDescription>
													{skill.description}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Button
													variant="outline"
													size="icon-sm"
													onClick={() => {
														setSkillDeleteTarget(skill.name);
														setSkillDeleteOpen(true);
													}}
												>
													<Trash />
												</Button>
											</ItemActions>
										</Item>
									))
								)}
							</div>
						</TabsContent>
					</Tabs>
				</div>

				<DrawerFooter>
					{activeTab === 'mcp' ? (
						<CreateMCPDialog onAdd={onAdd}>
							<Button variant="default">
								<PlusCircle />
								{t('workspace-drawer.addMcp')}
							</Button>
						</CreateMCPDialog>
					) : (
						<AddSkillDialog onAdd={onAddSkill}>
							<Button variant="default">
								<PlusCircle />
								{t('workspace-drawer.addSkill')}
							</Button>
						</AddSkillDialog>
					)}
				</DrawerFooter>
			</DrawerContent>
			<DeleteDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title={t('common.deleteTitle', {
					entity: t('dialog-mcp-delete.entity'),
					name: deleteTarget ?? '',
				})}
				description={t('common.deleteDescription')}
				onConfirm={async () => {
					if (deleteTarget) await onRemove(deleteTarget);
				}}
			/>
			<DeleteDialog
				open={skillDeleteOpen}
				onOpenChange={setSkillDeleteOpen}
				title={t('common.deleteTitle', {
					entity: t('dialog-mcp-delete.skillEntity'),
					name: skillDeleteTarget ?? '',
				})}
				description={t('dialog-mcp-delete.skillDescription')}
				onConfirm={async () => {
					if (skillDeleteTarget) await onRemoveSkill(skillDeleteTarget);
				}}
			/>
		</Drawer>
	);
}
