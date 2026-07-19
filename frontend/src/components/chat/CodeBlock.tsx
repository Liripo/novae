/**
 * 带语法高亮的代码块组件。
 *
 * 基于 react-syntax-highlighter 的 PrismLight（按需注册语言，控制包体积），
 * 主题跟随系统 prefers-color-scheme（与 index.css 的 dark 策略一致），
 * 右上角提供复制按钮。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';

// 按需注册常用语言（生信场景以 python/r/bash 为主）
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('r', r);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('sql', sql);

/** 监听系统深色模式（与 index.css 的 prefers-color-scheme 策略一致）。 */
function useIsDark(): boolean {
	const [isDark, setIsDark] = useState(
		() => window.matchMedia('(prefers-color-scheme: dark)').matches,
	);
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);
	return isDark;
}

interface CodeBlockProps {
	className?: string;
	children?: ReactNode;
}

export function CodeBlock({ className, children }: CodeBlockProps) {
	const isDark = useIsDark();
	const code = String(children ?? '').replace(/\n$/, '');
	const language = /language-(\w+)/.exec(className ?? '')?.[1] ?? 'text';

	return (
		<div className="relative w-full">
			<Button
				size="icon-xs"
				variant="ghost"
				className="absolute top-1 right-1 z-10"
				onClick={async (e) => {
					e.preventDefault();
					e.stopPropagation();
					await navigator.clipboard.writeText(code);
				}}
			>
				<Copy />
			</Button>
			<div className="w-full max-w-full overflow-x-auto">
				<SyntaxHighlighter
					language={language}
					style={isDark ? oneDark : oneLight}
					customStyle={{
						margin: 0,
						borderRadius: '0.375rem',
						fontSize: '0.75rem',
						lineHeight: 1.6,
					}}
					codeTagProps={{
						style: { fontFamily: 'inherit' },
					}}
				>
					{code}
				</SyntaxHighlighter>
			</div>
		</div>
	);
}
