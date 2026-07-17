import { Outlet } from 'react-router-dom';

import { SettingsDialogProvider } from '@/components/dialog/SettingsDialog';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export function AppLayout() {
	return (
		<div className="h-screen flex">
			<SidebarProvider>
				<SettingsDialogProvider>
					<AppSidebar />
					<SidebarInset className="flex-1 overflow-hidden">
						<Outlet />
					</SidebarInset>
				</SettingsDialogProvider>
			</SidebarProvider>
		</div>
	);
}
