import type { TFunction } from 'i18next';
import type { Tour } from 'onborda/dist/types';

export const CHAT_TOUR_NAME = 'chat-onboarding';

export const buildChatTour = (t: TFunction): Tour => ({
	tour: CHAT_TOUR_NAME,
	steps: [
		{
			icon: null,
			title: t('tour.createProject.title'),
			content: t('tour.createProject.content'),
			selector: '#tour-create-project',
			side: 'bottom',
			showControls: false,
			pointerPadding: 8,
			pointerRadius: 8,
		},
		{
			icon: null,
			title: t('tour.permissionMode.title'),
			content: t('tour.permissionMode.content'),
			selector: '#tour-permission-mode',
			side: 'bottom-right',
			showControls: false,
			pointerPadding: 6,
			pointerRadius: 8,
		},
		{
			icon: null,
			title: t('tour.chatInput.title'),
			content: t('tour.chatInput.content'),
			selector: '#tour-chat-input',
			side: 'top',
			showControls: false,
			pointerPadding: 6,
			pointerRadius: 16,
		},
	],
});
