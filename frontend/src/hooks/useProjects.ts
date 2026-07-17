import { useState, useEffect, useCallback } from 'react';

import { projectApi } from '../api';
import type { Project, CreateProjectRequest, UpdateProjectRequest } from '../api';

/**
 * Manages the current user's project list with CRUD operations.
 * Fetches on mount and automatically re-fetches after each mutation,
 * mirroring the style of `useAgents`.
 */
export function useProjects() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const refetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await projectApi.list();
			setProjects(res.projects);
		} catch (e) {
			setError(e as Error);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refetch();
	}, [refetch]);

	/** Creates a new project and refreshes the list. */
	const create = useCallback(
		async (body: CreateProjectRequest) => {
			const res = await projectApi.create(body);
			await refetch();
			return res;
		},
		[refetch],
	);

	/** Partially updates a project and refreshes the list. */
	const update = useCallback(
		async (projectId: string, body: UpdateProjectRequest) => {
			const res = await projectApi.update(projectId, body);
			await refetch();
			return res;
		},
		[refetch],
	);

	/** Deletes a project (cascading server-side) and refreshes the list. */
	const remove = useCallback(
		async (projectId: string) => {
			await projectApi.remove(projectId);
			await refetch();
		},
		[refetch],
	);

	return { projects, loading, error, refetch, create, update, remove };
}
