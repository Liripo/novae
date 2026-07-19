import { client } from './client';

export interface UserInfo {
	username: string;
	role: string;
	created_at: string | null;
}

export interface UserListResponse {
	users: UserInfo[];
	total: number;
}

export interface CreateUserRequest {
	username: string;
	password: string;
	role: 'user' | 'admin';
}

/** Admin-only user management routes (``/users/``). */
export const userApi = {
	list: () => client.get<UserListResponse>('/users/'),
	create: (body: CreateUserRequest) => client.post<UserInfo>('/users/', body),
	delete: (username: string) =>
		client.delete<{ username: string; deleted: boolean }>(
			`/users/${encodeURIComponent(username)}`,
		),
};
