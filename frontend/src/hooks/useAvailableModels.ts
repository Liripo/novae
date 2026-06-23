import { useState, useEffect, useCallback } from 'react';

import { credentialApi, modelApi } from '@/api';
import type { CredentialRecord, ModelCard } from '@/api';

export interface CredentialWithModels {
	credential: CredentialRecord;
	models: ModelCard[];
}

/**
 * Fetches all credentials and their available models, grouped by provider type.
 * Provider type is read from `credential.data.type`.
 * Credentials without a `type` field or whose model fetch fails are silently skipped.
 */
export function useAvailableModels() {
	const [groups, setGroups] = useState<Record<string, CredentialWithModels[]>>({});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const refetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const { credentials } = await credentialApi.list();
			const result: Record<string, CredentialWithModels[]> = {};

			await Promise.all(
				credentials.map(async (credential) => {
					const type = credential.data.type as string | undefined;
					if (!type) return;
					if (!result[type]) result[type] = [];
					let models: ModelCard[];
					try {
						const resp = await modelApi.list(type);
						models = resp.models;
					} catch {
						models = [];
					}
					// Merge custom_models stored in credential data
					const custom = credential.data.custom_models as string[] | undefined;
					if (Array.isArray(custom) && custom.length > 0) {
						const seen = new Set(models.map((m) => m.name));
						for (const name of custom) {
							if (!seen.has(name)) {
								models.push({
									type: 'chat_model',
									name,
									label: name,
									status: 'active',
									deprecated_at: null,
									input_types: [],
									output_types: [],
									context_size: 0,
									output_size: 0,
									parameter_schema: {},
									parameters_overrides: {},
								});
							}
						}
					}
					result[type].push({ credential, models });
				}),
			);

			setGroups(result);
		} catch (e) {
			setError(e as Error);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refetch();
	}, [refetch]);

	return { groups, loading, error, refetch };
}
