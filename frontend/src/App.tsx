import { Onborda, OnbordaProvider } from 'onborda';
import { useMemo, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import { RouteError } from '@/components/error/RouteError';
import { AppLayout } from '@/components/layout/AppLayout';
import { buildChatTour } from '@/components/tour/chatTourSteps';
import { TourCard } from '@/components/tour/TourCard';
import { useTranslation } from '@/i18n/useI18n';
import { ChatPage } from '@/pages/chat';
import { CredentialPage } from '@/pages/credential';
import { SchedulePage } from '@/pages/schedule';
import { LoginPage } from '@/pages/login';
import { getToken } from '@/api/client';

function LoginPageRoute() {
	const navigate = useNavigate();
	return (
		<>
			<div className="h-screen">
				<LoginPage onComplete={() => navigate('/')} />
			</div>
			<Toaster richColors position="top-right" />
		</>
	);
}

const router = createBrowserRouter([
	{
		element: <AppLayout />,
		errorElement: <RouteError />,
		children: [
			{
				errorElement: <RouteError />,
				children: [
					{ path: '/', element: <Navigate to="/chat" replace /> },
					{
						path: '/chat/:agentId?/:sessionId?/:memberId?',
						element: <ChatPage />,
					},
					{ path: '/schedule', element: <SchedulePage /> },
					{ path: '/credential', element: <CredentialPage /> },
				],
			},
		],
	},
	{
		path: '/login',
		element: <LoginPageRoute />,
		errorElement: <RouteError />,
	},
]);

function App() {
	const { t } = useTranslation();
	const [authed, setAuthed] = useState(() => !!getToken());
	const tours = useMemo(() => [buildChatTour(t)], [t]);

	if (!authed) {
		return <LoginPage onComplete={() => setAuthed(true)} />;
	}

	return (
		<OnbordaProvider>
			<Onborda
				steps={tours}
				cardComponent={TourCard}
				shadowOpacity="0.6"
				cardTransition={{ type: 'spring', duration: 0.4 }}
			>
				<RouterProvider router={router} />
				<Toaster richColors position="top-right" />
			</Onborda>
		</OnbordaProvider>
	);
}

export default App;
