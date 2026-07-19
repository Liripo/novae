import { Outlet } from 'react-router-dom';

/**
 * 应用外层布局。
 * 最左图标栏（AppSidebar）已移除：日程与新手引导入口并入聊天页用户卡片菜单，
 * 设置已改为独立全页（/settings，zcode 风格），此处只保留路由出口。
 * 注意：必须保持 h-screen + overflow-hidden 的定高约束——聊天页内部靠
 * 百分比高度链（h-full/min-h-0）把滚动限制在消息列表内部，一旦这里
 * 放开高度，侧栏底部用户卡片和悬浮输入框都会被顶出可视区。
 */
export function AppLayout() {
	return (
		<div className="flex h-screen overflow-hidden">
			<Outlet />
		</div>
	);
}
