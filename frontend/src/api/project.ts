import { client } from './client';
import type {
	CreateProjectRequest,
	Project,
	ProjectFileContent,
	ProjectFilesResponse,
	ProjectListResponse,
	UpdateProjectRequest,
} from './types';

export const projectApi = {
	list: () => client.get<ProjectListResponse>('/projects/'),

	create: (body: CreateProjectRequest) => client.post<Project>('/projects/', body),

	update: (projectId: string, body: UpdateProjectRequest) =>
		client.patch<Project>(`/projects/${projectId}`, body),

	remove: (projectId: string) => client.delete(`/projects/${projectId}`),

	files: (projectId: string) =>
		client.get<ProjectFilesResponse>(`/projects/${projectId}/files`),

	fileContent: (projectId: string, path: string) =>
		client.get<ProjectFileContent>(`/projects/${projectId}/files/content`, { path }),
};
