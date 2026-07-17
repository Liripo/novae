import { client } from './client';
import type { ProjectFileContent, ProjectFilesResponse } from './types';

/**
 * User workspace file browsing (``/files/``): the tree of
 * ``workspace_root/<user>/`` — top level is one directory per project.
 */
export const filesApi = {
	tree: () => client.get<ProjectFilesResponse>('/files/'),
	content: (path: string) =>
		client.get<ProjectFileContent>('/files/content', { path }),
};
