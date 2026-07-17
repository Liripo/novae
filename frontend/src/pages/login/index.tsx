import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card.tsx';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import Logo from '@/assets/images/novae.svg?react';
import { useTranslation } from '@/i18n/useI18n.ts';
import { authApi } from '@/api';
import { setStoredUser, setToken } from '@/api/client';
import { cn } from '@/lib/utils.ts';

interface Props {
	onComplete: () => void;
	className?: string;
}

export const LoginPage = ({ onComplete, className }: Props) => {
	const { t } = useTranslation();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const res = await authApi.login({ username, password });
			setToken(res.token);
			setStoredUser(res.username);
			onComplete();
		} catch {
			setError(t('login.error'));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex items-center justify-center h-full">
			<div className={cn('flex flex-col gap-6 w-full max-w-sm', className)}>
				<div className="flex justify-center">
					<Logo className="size-12" />
				</div>
				<Card>
					<CardHeader>
						<CardTitle>{t('login.title')}</CardTitle>
						<CardDescription>{t('login.description')}</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit}>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="login-username-input">
										{t('login.username')}
									</FieldLabel>
									<Input
										id="login-username-input"
										type="text"
										placeholder={t('login.usernamePlaceholder')}
										value={username}
										onChange={(e) => setUsername(e.target.value)}
										required
										autoFocus
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="login-password-input">
										{t('login.password')}
									</FieldLabel>
									<Input
										id="login-password-input"
										type="password"
										placeholder={t('login.passwordPlaceholder')}
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
									/>
								</Field>
								{error && (
									<p className="text-sm text-destructive">{error}</p>
								)}
								<Field>
									<Button type="submit" className="w-full" disabled={submitting}>
										{submitting ? t('login.submitting') : t('login.submit')}
									</Button>
								</Field>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
};
