import { client } from './client';

export interface LoginRequest {
	username: string;
	password: string;
}

export interface LoginResponse {
	token: string;
	username: string;
	role: string;
}

export interface MeResponse {
	username: string;
	role: string;
}

export const authApi = {
	login: (body: LoginRequest) => client.post<LoginResponse>('/auth/login', body),
	me: () => client.get<MeResponse>('/auth/me'),
};
