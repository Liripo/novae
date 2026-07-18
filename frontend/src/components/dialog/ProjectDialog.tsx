import { CheckCircle, CircleAlert, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AgentRecord, Project } from '@/api';
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
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n/useI18n';

export interface ProjectFormValues {
	name: string;
	description: string;
	agent_id: string;
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * The project being renamed, or `null` to create a new one. In edit
	 * mode only name + description are editable (the owning agent and
	 * workdir are immutable).
	 */
	project: Project | null;
	agents: AgentRecord[];
	onConfirm: (values: ProjectFormValues) => Promise<void>;
}

/**
 * Create / rename dialog for projects. Fields: name, description and —
 * on create only — the owning agent.
 */
export function ProjectDialog({ open, onOpenChange, project, agents, onConfirm }: Props) {
	const { t } = useTranslation();
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [agentId, setAgentId] = useState('');
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		setName(project?.name ?? '');
		setDescription(project?.description ?? '');
		setAgentId(project?.agent_id ?? agents[0]?.id ?? '');
	}, [open, project, agents]);

	const editing = project !== null;
	const valid = name.trim().length > 0 && (editing || agentId.length > 0);

	const handleConfirm = async () => {
		if (!valid) return;
		setLoading(true);
		try {
			await onConfirm({
				name: name.trim(),
				description: description.trim(),
				agent_id: agentId,
			});
			onOpenChange(false);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{editing ? t('dialog-project.editTitle') : t('dialog-project.createTitle')}
					</DialogTitle>
					<DialogDescription>{t('dialog-project.description')}</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<Field>
						<FieldLabel>{t('dialog-project.nameLabel')}</FieldLabel>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t('dialog-project.namePlaceholder')}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleConfirm();
							}}
							autoFocus
						/>
					</Field>
					<Field>
						<FieldLabel>{t('dialog-project.descLabel')}</FieldLabel>
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t('dialog-project.descPlaceholder')}
							rows={3}
						/>
					</Field>
					{/* 单个 agent 时显示只读字段（明确告知项目绑定的智能体），
					    多个时才显示可切换的下拉菜单 */}
					{agents.length === 1 && (
						<Field>
							<FieldLabel>{t('dialog-project.agentLabel')}</FieldLabel>
							<Input value={agents[0].data.name} disabled readOnly />
						</Field>
					)}
					{agents.length > 1 && (
						<Field>
							<FieldLabel>{t('dialog-project.agentLabel')}</FieldLabel>
							<Select value={agentId} onValueChange={setAgentId} disabled={editing}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t('dialog-project.agentPlaceholder')} />
								</SelectTrigger>
								<SelectContent position="popper">
									{agents.map((agent) => (
										<SelectItem key={agent.id} value={agent.id}>
											{agent.data.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					)}
					{!editing && agents.length === 0 && (
						<p className="text-muted-foreground text-xs">
							{t('dialog-project.noAgents')}
						</p>
					)}
				</FieldGroup>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
						<CircleAlert className="size-3.5" />
						{t('common.cancel')}
					</Button>
					<Button onClick={handleConfirm} disabled={loading || !valid}>
						{loading ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<CheckCircle className="size-3.5" />
						)}
						{editing ? t('common.save') : t('common.create')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
