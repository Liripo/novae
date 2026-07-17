import {
	ChevronRight,
	File,
	FileText,
	Folder,
	FolderOpen,
	Loader2,
	RefreshCw,
	ArrowLeft,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { Project, ProjectFileContent, ProjectFileNode } from '@/api';
import { filesApi, projectApi } from '@/api';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';

interface ProjectFilesPanelProps {
	/**
	 * Project mode: the project whose working directory to browse.
	 * `null` shows a hint. Ignored when `userMode` is set.
	 */
	project?: Project | null;
	/**
	 * User mode: browse the caller's whole workspace root (top level =
	 * one directory per project) via ``/files/`` instead of a project.
	 */
	userMode?: boolean;
	className?: string;
}

function formatSize(size: number | null | undefined): string {
	if (size === null || size === undefined) return '';
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

interface FileTreeProps {
	nodes: ProjectFileNode[];
	depth: number;
	openDirs: Set<string>;
	onToggleDir: (path: string) => void;
	onSelectFile: (path: string) => void;
	selectedPath: string | null;
}

function FileTree({ nodes, depth, openDirs, onToggleDir, onSelectFile, selectedPath }: FileTreeProps) {
	return (
		<ul className="flex flex-col">
			{nodes.map((node) => {
				const isDir = node.type === 'dir';
				const isOpen = openDirs.has(node.path);
				return (
					<li key={node.path}>
						<button
							type="button"
							className={cn(
								'flex w-full items-center gap-x-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent',
								!isDir && selectedPath === node.path && 'bg-accent',
							)}
							style={{ paddingLeft: `${depth * 12 + 6}px` }}
							onClick={() => (isDir ? onToggleDir(node.path) : onSelectFile(node.path))}
						>
							{isDir ? (
								<>
									<ChevronRight
										className={cn(
											'size-3 shrink-0 text-muted-foreground transition-transform',
											isOpen && 'rotate-90',
										)}
									/>
									{isOpen ? (
										<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
									) : (
										<Folder className="size-3.5 shrink-0 text-muted-foreground" />
									)}
								</>
							) : (
								<>
									<span className="size-3 shrink-0" />
									<File className="size-3.5 shrink-0 text-muted-foreground" />
								</>
							)}
							<span className="truncate">{node.name}</span>
							{!isDir && node.size != null && (
								<span className="ml-auto shrink-0 text-muted-foreground">
									{formatSize(node.size)}
								</span>
							)}
						</button>
						{isDir && isOpen && node.children && node.children.length > 0 && (
							<FileTree
								nodes={node.children}
								depth={depth + 1}
								openDirs={openDirs}
								onToggleDir={onToggleDir}
								onSelectFile={onSelectFile}
								selectedPath={selectedPath}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/**
 * Browse a working directory: a file tree on one side and a text viewer
 * for the selected file. Project mode reads ``/projects/{id}/files``;
 * user mode reads ``/files/`` (the whole user workspace root).
 */
export function ProjectFilesPanel({ project, userMode = false, className }: ProjectFilesPanelProps) {
	const { t } = useTranslation();
	const [tree, setTree] = useState<ProjectFileNode[]>([]);
	const [treeLoading, setTreeLoading] = useState(false);
	const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [fileContent, setFileContent] = useState<ProjectFileContent | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);

	const loadTree = useCallback(async () => {
		if (!userMode && !project) {
			setTree([]);
			return;
		}
		setTreeLoading(true);
		try {
			const res = userMode
				? await filesApi.tree()
				: await projectApi.files(project!.id);
			setTree(res.tree);
		} catch {
			setTree([]);
		} finally {
			setTreeLoading(false);
		}
	}, [userMode, project]);

	// Reset browsing state when switching projects / modes.
	useEffect(() => {
		setOpenDirs(new Set());
		setSelectedPath(null);
		setFileContent(null);
		setFileError(null);
		loadTree();
	}, [loadTree]);

	const handleToggleDir = (path: string) => {
		setOpenDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const handleSelectFile = async (path: string) => {
		if (!userMode && !project) return;
		setSelectedPath(path);
		setFileLoading(true);
		setFileError(null);
		try {
			const res = userMode
				? await filesApi.content(path)
				: await projectApi.fileContent(project!.id, path);
			setFileContent(res);
		} catch (e) {
			setFileContent(null);
			setFileError(e instanceof Error ? e.message : String(e));
		} finally {
			setFileLoading(false);
		}
	};

	if (!userMode && !project) {
		return (
			<div className={cn('flex flex-col items-center justify-center gap-y-2 p-4', className)}>
				<FileText className="size-8 text-muted-foreground" />
				<p className="text-center text-muted-foreground text-xs">
					{t('project-files.noProject')}
				</p>
			</div>
		);
	}

	return (
		<div className={cn('flex min-h-0 flex-col', className)}>
			<div className="flex items-center justify-between gap-x-1 px-2 py-1">
				{fileContent || fileLoading || fileError ? (
					<Button
						size="xs"
						variant="ghost"
						onClick={() => {
							setSelectedPath(null);
							setFileContent(null);
							setFileError(null);
						}}
					>
						<ArrowLeft className="size-3" />
						{t('project-files.backToTree')}
					</Button>
				) : (
					<span
						className="truncate px-1 text-muted-foreground text-xs"
						title={userMode ? t('project-files.userRoot') : project?.name}
					>
						{userMode ? t('project-files.userRoot') : project?.name}
					</span>
				)}
				<Button size="icon-xs" variant="ghost" onClick={loadTree} disabled={treeLoading}>
					<RefreshCw className={cn('size-3', treeLoading && 'animate-spin')} />
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
				{fileLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					</div>
				) : fileError ? (
					<p className="px-2 py-4 text-center text-destructive text-xs">{fileError}</p>
				) : fileContent ? (
					<div className="flex flex-col gap-y-1">
						<span className="truncate px-1 font-mono text-muted-foreground text-xs">
							{fileContent.path}
						</span>
						{fileContent.truncated && (
							<span className="px-1 text-muted-foreground text-xs">
								{t('project-files.truncated')}
							</span>
						)}
						<pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
							{fileContent.content}
						</pre>
					</div>
				) : treeLoading && tree.length === 0 ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					</div>
				) : tree.length === 0 ? (
					<p className="px-2 py-4 text-center text-muted-foreground text-xs">
						{t('project-files.noFiles')}
					</p>
				) : (
					<FileTree
						nodes={tree}
						depth={0}
						openDirs={openDirs}
						onToggleDir={handleToggleDir}
						onSelectFile={handleSelectFile}
						selectedPath={selectedPath}
					/>
				)}
			</div>
		</div>
	);
}
