import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { usageApi } from '@/api';
import type { UsageDaily, UsageStats } from '@/api';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n';
import { useTranslation } from '@/i18n/useI18n';

/** 模型配色盘：按模型名哈希稳定取色，趋势图分段与图例共用。 */
const MODEL_COLORS = [
	'#3b82f6',
	'#10b981',
	'#f59e0b',
	'#8b5cf6',
	'#f43f5e',
	'#06b6d4',
	'#84cc16',
	'#ec4899',
];

function modelColor(name: string): string {
	let hash = 0;
	for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return MODEL_COLORS[hash % MODEL_COLORS.length];
}

/** token 数按界面语言缩写：中文用 万/亿，英文用 K/M。 */
export function formatTokens(n: number, language: string): string {
	if (language.startsWith('zh')) {
		if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
		if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
		return String(n);
	}
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return String(n);
}

/** 单个大数字统计卡片。 */
function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div className="flex flex-col gap-y-1 rounded-lg border p-4">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-semibold text-2xl">{value}</span>
			{hint && <span className="text-muted-foreground text-xs">{hint}</span>}
		</div>
	);
}

/** GitHub 风格活跃热力图：列=周（周日起始）、行=周日到周六，
 *  顶部月份标签、左侧星期标签（仅标 周一/三/五），颜色按当天消息数分档。 */
function ActivityHeatmap({ daily }: { daily: UsageDaily[] }) {
	const { t } = useTranslation();
	const isZh = i18n.language.startsWith('zh');
	const WEEKDAYS = isZh
		? ['日', '一', '二', '三', '四', '五', '六']
		: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const MONTHS_EN = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
	];

	// 周列 + 月份标签一起算：首列前置空白对齐到周日（GitHub 风格）；
	// 某周首格的月份与前一列不同（或为首列）时，在该列顶部显示月份
	const { weeks, monthLabels } = useMemo(() => {
		const empty = { weeks: [] as (UsageDaily | null)[][], monthLabels: [] as string[] };
		if (daily.length === 0) return empty;
		const labelOf = (m: number) => (isZh ? `${m + 1}月` : MONTHS_EN[m]);
		const first = new Date(`${daily[0].date}T00:00:00`);
		const cells: (UsageDaily | null)[] = [
			...Array<null>(first.getDay()).fill(null),
			...daily,
		];
		const cols: (UsageDaily | null)[][] = [];
		for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
		const labels = cols.map((week, i) => {
			const firstDay = week.find((d) => d !== null);
			if (!firstDay) return '';
			const month = new Date(`${firstDay.date}T00:00:00`).getMonth();
			if (i === 0) return labelOf(month);
			const prev = cols[i - 1].find((d) => d !== null);
			if (prev && new Date(`${prev.date}T00:00:00`).getMonth() === month) {
				return '';
			}
			return labelOf(month);
		});
		return { weeks: cols, monthLabels: labels };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [daily, isZh]);

	const levelClass = (messages: number): string => {
		if (messages <= 0) return 'bg-muted';
		if (messages <= 2) return 'bg-primary/25';
		if (messages <= 5) return 'bg-primary/45';
		if (messages <= 9) return 'bg-primary/70';
		return 'bg-primary';
	};

	return (
		<div className="flex flex-col gap-y-2 rounded-lg border p-4">
			<span className="text-sm font-medium">{t('usage.heatmap')}</span>
			<div className="flex gap-1 overflow-x-auto pb-1">
				{/* 左侧星期标签列（顶部留空与月份标签行对齐） */}
				<div className="flex shrink-0 flex-col gap-1">
					<span className="h-4" />
					{WEEKDAYS.map((label, i) => (
						<span
							key={label}
							className="flex h-3 w-6 items-center text-[10px] text-muted-foreground leading-none"
						>
							{i === 1 || i === 3 || i === 5 ? label : ''}
						</span>
					))}
				</div>
				{/* 周列：顶部月份标签 + 7 天格子 */}
				{weeks.map((week, wi) => (
					<div key={wi} className="flex flex-col gap-1">
						<span className="h-4 whitespace-nowrap text-[10px] text-muted-foreground leading-4">
							{monthLabels[wi]}
						</span>
						{week.map((day, di) =>
							day === null ? (
								<span key={`b${di}`} className="size-3" />
							) : (
								<span
									key={day.date}
									title={t('usage.cellActivity', {
										date: day.date,
										count: day.messages,
									})}
									className={`size-3 rounded-sm ${levelClass(day.messages)}`}
								/>
							),
						)}
					</div>
				))}
			</div>
			<div className="flex items-center justify-end gap-x-1 text-muted-foreground text-xs">
				<span>{t('usage.less')}</span>
				{['bg-muted', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'].map(
					(cls) => (
						<span key={cls} className={`size-3 rounded-sm ${cls}`} />
					),
				)}
				<span>{t('usage.more')}</span>
			</div>
		</div>
	);
}

/** 按天 Token 堆叠柱状图：纯 CSS 实现，每段按模型着色，附模型图例。 */
function DailyTokenBars({ daily }: { daily: UsageDaily[] }) {
	const { t } = useTranslation();
	const maxTokens = Math.max(1, ...daily.map((d) => d.tokens));
	// 汇总各模型总 token，图例按用量降序
	const modelTotals = useMemo(() => {
		const totals = new Map<string, number>();
		for (const d of daily) {
			for (const [model, tokens] of Object.entries(d.models)) {
				totals.set(model, (totals.get(model) ?? 0) + tokens);
			}
		}
		return [...totals.entries()].sort((a, b) => b[1] - a[1]);
	}, [daily]);

	return (
		<div className="flex flex-col gap-y-2 rounded-lg border p-4">
			<span className="text-sm font-medium">{t('usage.dailyTrend')}</span>
			<div className="flex h-32 items-end gap-[3px]">
				{daily.map((d) => (
					<div
						key={d.date}
						title={`${d.date} · ${d.tokens}`}
						className="flex min-w-[3px] flex-1 flex-col-reverse rounded-sm"
					>
						{Object.entries(d.models).map(([model, tokens]) => (
							<div
								key={model}
								style={{
									height: `${(tokens / maxTokens) * 100}%`,
									backgroundColor: modelColor(model),
								}}
							/>
						))}
					</div>
				))}
			</div>
			{modelTotals.length > 0 && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
					{modelTotals.map(([model]) => (
						<span key={model} className="flex items-center gap-x-1.5">
							<span
								className="size-2.5 rounded-sm"
								style={{ backgroundColor: modelColor(model) }}
							/>
							{model}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * 使用统计分节：时间范围切换 + 6 个统计卡片 + 活跃热力图 + 按天 Token 趋势。
 * 数据来自 GET /usage/stats（仅统计当前用户）。
 */
export function UsageSection() {
	const { t } = useTranslation();
	const [days, setDays] = useState<7 | 30>(7);
	const [stats, setStats] = useState<UsageStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setFailed(false);
		usageApi
			.stats(days)
			.then((res) => {
				if (cancelled) return;
				setStats(res);
				setLoading(false);
			})
			.catch(() => {
				if (cancelled) return;
				setFailed(true);
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [days]);

	const lang = i18n.language;

	return (
		<div className="flex flex-col gap-y-4">
			{/* 时间范围切换 */}
			<div className="flex gap-x-2">
				<Button
					variant={days === 7 ? 'default' : 'outline'}
					size="sm"
					onClick={() => setDays(7)}
				>
					{t('usage.last7Days')}
				</Button>
				<Button
					variant={days === 30 ? 'default' : 'outline'}
					size="sm"
					onClick={() => setDays(30)}
				>
					{t('usage.last30Days')}
				</Button>
			</div>

			{loading ? (
				<div className="flex h-40 items-center justify-center">
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</div>
			) : failed || stats === null ? (
				<div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
					{t('usage.noData')}
				</div>
			) : (
				<>
					{/* 统计卡片 */}
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<StatCard
							label={t('usage.tokensUsed')}
							value={formatTokens(stats.total_tokens, lang)}
						/>
						<StatCard label={t('usage.sessions')} value={String(stats.total_sessions)} />
						<StatCard label={t('usage.messages')} value={String(stats.total_messages)} />
						<StatCard
							label={t('usage.activeDays')}
							value={`${stats.active_days} / ${stats.days}`}
						/>
						<StatCard label={t('usage.streakDays')} value={String(stats.streak_days)} />
						<StatCard
							label={t('usage.topModel')}
							value={stats.top_model?.name ?? '-'}
							hint={
								stats.top_model
									? t('usage.shareOf', {
											share: Math.round(stats.top_model.share * 100),
										})
									: undefined
							}
						/>
					</div>
					<ActivityHeatmap daily={stats.daily} />
					<DailyTokenBars daily={stats.daily} />
				</>
			)}
		</div>
	);
}
