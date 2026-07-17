import { client } from './client';

export interface UserInfo {
	username: string;
	role: string;
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
};
