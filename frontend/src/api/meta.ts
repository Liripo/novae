import { client } from './client';
import type { UsageStats } from './types';

// 应用元信息（版本号等，来自后端 pyproject）
export const metaApi = {
	version: () => client.get<{ version: string }>('/meta'),
};

// 当前用户的使用统计
export const usageApi = {
	stats: (days: number) =>
		client.get<UsageStats>('/usage/stats', { days: String(days) }),
};
