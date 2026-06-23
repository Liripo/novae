import { CircleAlert, Loader2, Save } from 'lucide-react';
import { useState, useEffect } from 'react';

import { credentialApi } from '@/api';
import type { CredentialRecord, CredentialSchema } from '@/api';
import { SchemaForm, type SchemaFormValue } from '@/components/form/SchemaForm';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field.tsx';
import { useCredentials } from '@/hooks/useCredentials';
import { useTranslation } from '@/i18n/useI18n';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	credential: CredentialRecord;
	onUpdated?: () => void;
}

export function EditCredentialDialog({ open, onOpenChange, credential, onUpdated }: Props) {
	const { update } = useCredentials();
	const { t } = useTranslation();
	const [schema, setSchema] = useState<CredentialSchema | null>(null);
	const [loadingSchema, setLoadingSchema] = useState(false);
	const [values, setValues] = useState<Record<string, SchemaFormValue>>({});
	const [customModels, setCustomModels] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const type = credential.data.type as string | undefined;

	useEffect(() => {
		if (!open || !type) return;
		setLoadingSchema(true);
		setCustomModels(
			(credential.data.custom_models as string[] | undefined)?.join('\n') ?? '',
		);
		credentialApi
			.schemas()
			.then((res) => {
				const matched = res.schemas.find(
					(s) => (s.properties.type?.const as string) === type,
				);
				setSchema(matched ?? null);
				// Pre-fill values from existing credential data (excluding writeOnly fields)
				if (matched) {
					const prefill: Record<string, SchemaFormValue> = {};
					for (const [key, prop] of Object.entries(matched.properties)) {
						if (key === 'id' || key === 'type' || prop.const !== undefined) continue;
						if (prop.writeOnly) continue; // don't pre-fill secrets like api_key
						const existing = credential.data[key];
						if (existing !== undefined) {
							prefill[key] = existing as SchemaFormValue;
						}
					}
					setValues(prefill);
				}
			})
			.finally(() => setLoadingSchema(false));
	}, [open, type, credential.data]);

	const handleSubmit = async () => {
		if (!schema) return;
		setSubmitting(true);
		try {
			const data: Record<string, unknown> = { ...credential.data };
			for (const [key, prop] of Object.entries(schema.properties)) {
				if (key === 'id' || key === 'type' || prop.const !== undefined) continue;
				const val = values[key];
				if (val !== undefined && val !== '') data[key] = val;
			}
			const models = customModels
				.split('\n')
				.map((s) => s.trim())
				.filter(Boolean);
			if (models.length > 0) data['custom_models'] = models;
			else delete data['custom_models'];
			await update(credential.id, { data });
			onOpenChange(false);
			onUpdated?.();
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="!w-[500px] !max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{t('dialog-credential-edit.title')}</DialogTitle>
					<DialogDescription>{t('dialog-credential-edit.description')}</DialogDescription>
				</DialogHeader>
				{loadingSchema ? (
					<p className="text-muted-foreground text-sm">{t('common.loading')}</p>
				) : schema ? (
					<FieldGroup>
						<SchemaForm
							schema={schema}
							values={values}
							onChange={(key, val) => setValues((prev) => ({ ...prev, [key]: val }))}
						/>
						<Field>
							<FieldLabel>{t('dialog-credential-edit.customModels')}</FieldLabel>
							<textarea
								value={customModels}
								onChange={(e) => setCustomModels(e.target.value)}
								placeholder={t('dialog-credential-edit.customModelsPlaceholder')}
								rows={3}
								className="w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
							/>
						</Field>
					</FieldGroup>
				) : null}
				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={submitting}
					>
						<CircleAlert className="size-3.5" />
						{t('common.cancel')}
					</Button>
					<Button onClick={handleSubmit} disabled={submitting || !schema}>
						{submitting ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Save className="size-3.5" />
						)}
						{submitting ? t('common.saving') : t('common.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
