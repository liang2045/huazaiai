import { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Cloud,
  Copy as CopyIcon,
  Download as DownloadIcon,
  Edit2,
  ExternalLink,
  Film,
  FolderOpen,
  Hand,
  Image as ImageIcon,
  Menu,
  MoreHorizontal,
  Moon,
  MousePointer2,
  Music,
  Frame,
  Plus,
  Save,
  Settings,
  Sun,
  Trash2,
  Type,
  Upload,
  Video,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useThemeStore } from './stores/theme';
import { useApiKeysStore } from './stores/apiKeys';
import { useCanvasStore } from './stores/canvas';
import Sidebar from './components/Sidebar';
import Canvas, { type CanvasInteractionMode } from './components/Canvas';
import ApiSettingsModal from './components/ApiSettings';
import ErrorBoundary from './components/ErrorBoundary';
import * as api from './services/api';
import { apiUrl } from './services/apiBase';
import type { CanvasListItem, NodeType } from './types/canvas';

declare const __APP_VERSION__: string;
declare global {
  interface Window {
    imade?: {
      getInfo?: () => Promise<any>;
      openPath?: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
      openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>;
      chooseDirectory?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      downloadToDirectory?: (payload: { url: string; directory: string; fileName?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
    };
  }
}

const DEFAULT_APP_CONFIG: api.AppConfig = {
  appName: 'iMade',
  logoUrl: '/logo.svg',
  version: __APP_VERSION__,
  themeColor: '#d7ccb3',
  licenseStatus: 'offline',
  customerId: 'local-default',
  machineId: '',
  expiresAt: null,
  lastSyncAt: null,
  features: ['canvas', 'image-generation', 'reference-image', 'workflow', 'white-label'],
  updateUrl: '',
};
const RECENT_VISIBLE_LIMIT = 48;
const RECENT_MORE_LIMIT = 96;

type UpdateNotice = {
  version: string;
  url: string;
  assetUrl?: string;
};

type DownloadNotice = {
  kind: 'success' | 'error';
  message: string;
  path?: string;
  directory?: string;
  fileName?: string;
};

type ProjectTransferProgress = {
  kind: 'export' | 'import';
  label: string;
  current: number;
  total: number;
};

function normalizeVersion(value: string) {
  return String(value || '').trim().replace(/^v/i, '').split(/[+-]/)[0];
}

function compareVersions(a: string, b: string) {
  const pa = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function getRecentPreviewUrl(canvas: CanvasListItem) {
  if (!canvas.previewUrl || canvas.previewKind !== 'image') return canvas.previewUrl;
  return `/api/files/thumbnail?url=${encodeURIComponent(canvas.previewUrl)}&w=320&h=240`;
}

function formatProjectTime(value: number) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--';
  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function sanitizeExportName(name: string) {
  return String(name || 'project')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'project';
}

function collectLocalAssetUrls(value: unknown, out = new Set<string>()) {
  if (typeof value === 'string') {
    if (/^\/(?:files\/(?:input|output)|input|output)\//.test(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLocalAssetUrls(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => collectLocalAssetUrls(item, out));
  }
  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(blob);
  });
}

function replaceLocalAssetUrls(value: unknown, urlMap: Record<string, string>): unknown {
  if (typeof value === 'string') return urlMap[value] || value;
  if (Array.isArray(value)) return value.map((item) => replaceLocalAssetUrls(item, urlMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceLocalAssetUrls(item, urlMap)]),
    );
  }
  return value;
}

const BOTTOM_CORE_NODES: Array<{
  type: NodeType;
  label: string;
  icon: typeof Upload;
  accent: string;
}> = [
  { type: 'upload', label: '上传图像', icon: Upload, accent: '#a9b8ae' },
  { type: 'drawing-board', label: '画框', icon: Frame, accent: '#bbb196' },
  { type: 'text', label: '文字', icon: Type, accent: '#aab5ba' },
  { type: 'image', label: '图像生成', icon: ImageIcon, accent: '#c0b594' },
  { type: 'video', label: '视频生成', icon: Video, accent: '#b6a0a3' },
  { type: 'seedance', label: 'SD2.0', icon: Film, accent: '#b0a6b6' },
  { type: 'audio', label: '音频', icon: Music, accent: '#aaa5b7' },
  { type: 'llm', label: 'LLM', icon: Brain, accent: '#9fb4aa' },
];

function App() {
  const { theme, toggleTheme } = useThemeStore();
  const { settings, load: loadSettings } = useApiKeysStore();
  const { canvases, createCanvas, deleteCanvas, renameCanvas, loadCanvases, loading: canvasLoading, setActive, clearActive } = useCanvasStore();
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectStarted, setProjectStarted] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('select');
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<DownloadNotice | null>(null);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);
  const [recentMoreOpen, setRecentMoreOpen] = useState(false);
  const [recentMenu, setRecentMenu] = useState<{ x: number; y: number; canvas: CanvasListItem } | null>(null);
  const [deletingRecentId, setDeletingRecentId] = useState<string | null>(null);
  const [editingRecentId, setEditingRecentId] = useState<string | null>(null);
  const [editingRecentName, setEditingRecentName] = useState('');
  const [confirmDeleteRecent, setConfirmDeleteRecent] = useState<CanvasListItem | null>(null);
  const [copyingRecentId, setCopyingRecentId] = useState<string | null>(null);
  const [exportingRecentId, setExportingRecentId] = useState<string | null>(null);
  const [importingProject, setImportingProject] = useState(false);
  const [transferProgress, setTransferProgress] = useState<ProjectTransferProgress | null>(null);
  const [appConfig, setAppConfig] = useState<api.AppConfig>(DEFAULT_APP_CONFIG);
  const longPressTimer = useRef<number | null>(null);
  const importProjectInputRef = useRef<HTMLInputElement>(null);
  const addNodeRef = useRef<((type: NodeType) => void) | null>(null);
  const saveCanvasRef = useRef<(() => Promise<void>) | null>(null);
  const projectName = appConfig.appName || DEFAULT_APP_CONFIG.appName;
  const logoUrl = appConfig.logoUrl || DEFAULT_APP_CONFIG.logoUrl;
  const appVersion = appConfig.version || DEFAULT_APP_CONFIG.version || __APP_VERSION__;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme-style', 'tech');
    root.setAttribute('data-theme-mode', theme);
    root.setAttribute('spellcheck', 'false');
    document.body.setAttribute('spellcheck', 'false');
  }, [theme]);

  useEffect(() => {
    const apply = (el: Element) => {
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
        if (tag !== 'SELECT') {
          el.setAttribute('spellcheck', 'false');
          el.setAttribute('autocorrect', 'off');
          el.setAttribute('autocapitalize', 'off');
        }
        el.classList.add('nodrag', 'nowheel');
      }
    };
    document.querySelectorAll('textarea, input, select').forEach(apply);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as Element;
          apply(el);
          el.querySelectorAll?.('textarea, input, select').forEach(apply);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    loadCanvases();
  }, [loadCanvases]);

  useEffect(() => {
    let alive = true;
    api.getAppConfig()
      .then((config) => {
        if (!alive) return;
        setAppConfig({ ...DEFAULT_APP_CONFIG, ...config });
      })
      .catch(() => {
        if (alive) setAppConfig(DEFAULT_APP_CONFIG);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.title = projectName;
  }, [projectName]);

  useEffect(() => {
    const check = async () => {
      const ok = await api.checkBackendStatus();
      setBackendStatus(ok ? 'ok' : 'error');
    };
    check();
    const t = window.setInterval(check, 15_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setUpdateNotice(null);
  }, []);

  useEffect(() => {
    const onComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setDownloadNotice({
        kind: 'success',
        message: '已保存到下载文件夹',
        path: detail.path,
        directory: detail.directory,
        fileName: detail.fileName,
      });
    };
    const onError = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setDownloadNotice({
        kind: 'error',
        message: detail.message || '下载失败',
        directory: detail.directory,
      });
    };
    window.addEventListener('imade:download-complete', onComplete);
    window.addEventListener('imade:download-error', onError);
    return () => {
      window.removeEventListener('imade:download-complete', onComplete);
      window.removeEventListener('imade:download-error', onError);
    };
  }, []);

  const isDark = theme === 'dark';
  const ActiveToolIcon = interactionMode === 'select' ? MousePointer2 : Hand;
  const visibleRecentCanvases = canvases;
  const recentCanvases = visibleRecentCanvases.slice(0, RECENT_VISIBLE_LIMIT);
  const moreRecentCanvases = visibleRecentCanvases.slice(0, RECENT_MORE_LIMIT);
  const hasMoreRecentCanvases = moreRecentCanvases.length > recentCanvases.length;

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const beginToolPress = () => {
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      setToolMenuOpen(true);
      longPressTimer.current = null;
    }, 360);
  };

  const selectTool = (mode: CanvasInteractionMode) => {
    setInteractionMode(mode);
    setToolMenuOpen(false);
  };

  const handleCreateProject = async () => {
    if (creatingProject) return;
    setCreatingProject(true);
    const item = await createCanvas(projectName);
    if (item) setProjectStarted(true);
    setCreatingProject(false);
  };

  const openRecentCanvas = (id: string) => {
    setRecentMenu(null);
    setEditingRecentId(null);
    setRecentMoreOpen(false);
    setActive(id);
    setProjectStarted(true);
  };

  const startRenameRecent = (canvas: CanvasListItem) => {
    setRecentMenu(null);
    setEditingRecentId(canvas.id);
    setEditingRecentName(canvas.name);
  };

  const submitRenameRecent = async () => {
    if (!editingRecentId) return;
    const nextName = editingRecentName.trim();
    if (nextName) {
      await renameCanvas(editingRecentId, nextName);
      await loadCanvases();
    }
    setEditingRecentId(null);
    setEditingRecentName('');
  };

  const copyRecentProject = async (canvas: CanvasListItem) => {
    if (copyingRecentId) return;
    setRecentMenu(null);
    setCopyingRecentId(canvas.id);
    try {
      const data = await api.getCanvasData(canvas.id);
      const item = await createCanvas(`${canvas.name} 副本`);
      if (!item) throw new Error('创建副本失败');
      await api.saveCanvasData(item.id, data);
      await loadCanvases();
      setDownloadNotice({ kind: 'success', message: '项目已复制', fileName: `${canvas.name} 副本` });
    } catch (err) {
      setDownloadNotice({
        kind: 'error',
        message: `复制项目失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setCopyingRecentId(null);
    }
  };

  const exportRecentProject = async (canvas: CanvasListItem) => {
    if (exportingRecentId) return;
    setRecentMenu(null);
    setExportingRecentId(canvas.id);
    setTransferProgress({ kind: 'export', label: '读取项目数据', current: 0, total: 1 });
    try {
      const data = await api.getCanvasData(canvas.id);
      const assetUrls = collectLocalAssetUrls(data);
      if (canvas.previewUrl) collectLocalAssetUrls(canvas.previewUrl, assetUrls);
      const assetUrlList = [...assetUrls];
      const totalSteps = Math.max(assetUrlList.length + 2, 2);
      setTransferProgress({ kind: 'export', label: '收集项目素材', current: 1, total: totalSteps });
      const assets: Array<{ url: string; name: string; mime: string; size: number; dataUrl: string }> = [];
      for (const [index, url] of assetUrlList.entries()) {
        setTransferProgress({ kind: 'export', label: `打包素材 ${index + 1}/${assetUrlList.length}`, current: index + 1, total: totalSteps });
        try {
          const res = await fetch(apiUrl(url));
          if (!res.ok) continue;
          const blob = await res.blob();
          if (blob.type && !blob.type.startsWith('image/')) continue;
          assets.push({
            url,
            name: decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() || 'asset'),
            mime: blob.type || 'application/octet-stream',
            size: blob.size,
            dataUrl: await blobToDataUrl(blob),
          });
        } catch {
          /* skip missing asset */
        }
      }
      setTransferProgress({ kind: 'export', label: '生成导出文件', current: totalSteps - 1, total: totalSteps });
      const payload = {
        schema: 'imade-project-export-v1',
        exportedAt: new Date().toISOString(),
        appVersion,
        canvas,
        data,
        assets,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      setTransferProgress({ kind: 'export', label: '下载导出文件', current: totalSteps, total: totalSteps });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `${sanitizeExportName(canvas.name)}.imade-project.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      setDownloadNotice({ kind: 'success', message: '项目已导出', fileName: link.download });
    } catch (err) {
      setDownloadNotice({
        kind: 'error',
        message: `导出项目失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExportingRecentId(null);
      window.setTimeout(() => setTransferProgress(null), 450);
    }
  };

  const handleImportProjectFile = async (file?: File | null) => {
    if (!file || importingProject) return;
    setImportingProject(true);
    setTransferProgress({ kind: 'import', label: '读取项目文件', current: 0, total: 1 });
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      if (payload?.schema !== 'imade-project-export-v1' || !payload?.data) {
        throw new Error('项目文件格式不正确');
      }
      const assets = Array.isArray(payload.assets) ? payload.assets : [];
      const totalSteps = Math.max(assets.length + 2, 2);
      const urlMap: Record<string, string> = {};
      for (const [index, asset] of assets.entries()) {
        setTransferProgress({ kind: 'import', label: `恢复素材 ${index + 1}/${assets.length}`, current: index + 1, total: totalSteps });
        if (!asset?.url || !asset?.dataUrl) continue;
        if (typeof asset.dataUrl === 'string' && !asset.dataUrl.startsWith('data:image/')) continue;
        const res = await fetch(apiUrl('/api/files/upload-base64'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: asset.dataUrl, prefix: 'import' }),
        });
        if (!res.ok) throw new Error(`素材恢复失败：${asset.name || asset.url}`);
        const uploaded = await res.json();
        const nextUrl = uploaded?.data?.url;
        if (nextUrl) urlMap[asset.url] = nextUrl;
      }
      setTransferProgress({ kind: 'import', label: '创建项目', current: totalSteps - 1, total: totalSteps });
      const importedData = replaceLocalAssetUrls(payload.data, urlMap) as any;
      const sourceCanvas = payload.canvas || {};
      const importedName = `${sourceCanvas.name || file.name.replace(/\.imade-project\.json$/i, '') || '导入项目'} 导入`;
      const item = await createCanvas(importedName);
      if (!item) throw new Error('创建导入项目失败');
      await api.saveCanvasData(item.id, importedData);
      setTransferProgress({ kind: 'import', label: '完成导入', current: totalSteps, total: totalSteps });
      await loadCanvases();
      setActive(item.id);
      setRecentMoreOpen(false);
      setRecentMenu(null);
      setProjectStarted(true);
      setDownloadNotice({ kind: 'success', message: '项目已导入', fileName: importedName });
    } catch (err) {
      setDownloadNotice({
        kind: 'error',
        message: `导入项目失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setImportingProject(false);
      if (importProjectInputRef.current) importProjectInputRef.current.value = '';
      window.setTimeout(() => setTransferProgress(null), 450);
    }
  };

  const deleteRecentNow = async (id: string) => {
    if (deletingRecentId) return;
    setDeletingRecentId(id);
    try {
      await deleteCanvas(id);
      await loadCanvases();
      setRecentMenu(null);
      setConfirmDeleteRecent(null);
    } catch (err) {
      setDownloadNotice({
        kind: 'error',
        message: `删除项目失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setDeletingRecentId(null);
    }
  };

  const saveCanvasNow = async () => {
    if (!saveCanvasRef.current || savingCanvas) return;
    setSavingCanvas(true);
    try {
      await saveCanvasRef.current();
      await loadCanvases();
    } finally {
      window.setTimeout(() => setSavingCanvas(false), 350);
    }
  };

  const returnToStartPage = async () => {
    if (savingCanvas) return;
    setSavingCanvas(true);
    try {
      await saveCanvasRef.current?.();
      await loadCanvases();
    } catch (e) {
      console.error('返回启动页前保存画布失败', e);
    } finally {
      setSavingCanvas(false);
      setMenuOpen(false);
      setToolMenuOpen(false);
      clearActive();
      setProjectStarted(false);
    }
  };

  const openSharedFolder = async () => {
    const targetPath = settings.sharedFolderPath?.trim();
    if (!targetPath) {
      setSettingsOpen(true);
      return;
    }
    try {
      if (window.imade?.openPath) {
        const result = await window.imade.openPath(targetPath);
        if (result?.ok) return;
        throw new Error(result?.error || '无法打开共享文件夹');
      }
      const res = await fetch(apiUrl('/api/files/open-path'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) return;
      throw new Error(json?.error || `HTTP ${res.status}`);
    } catch (err) {
      setDownloadNotice({
        kind: 'error',
        message: `无法打开共享文件夹：${err instanceof Error ? err.message : String(err)}`,
        directory: targetPath,
      });
    }
  };

  const openNetdisk = async () => {
    const rawUrl = settings.netdiskUrl?.trim();
    if (!rawUrl) {
      setSettingsOpen(true);
      return;
    }
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
      if (window.imade?.openExternal) {
        const result = await window.imade.openExternal(url);
        if (result?.ok) return;
        throw new Error(result?.error || '无法打开云盘');
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setDownloadNotice({
        kind: 'error',
        message: `无法打开云盘：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const openDownloadDirectory = async () => {
    const directory = downloadNotice?.directory;
    if (!directory) return;
    try {
      if (window.imade?.openPath) {
        const result = await window.imade.openPath(directory);
        if (result?.ok) return;
        throw new Error(result?.error || '无法打开下载目录');
      }
      const res = await fetch(apiUrl('/api/files/open-path'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: directory }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) return;
      throw new Error(json?.error || `HTTP ${res.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDownloadNotice({
        kind: 'error',
        message: `下载失败：无法打开下载目录。${message}`,
        directory,
      });
    }
  };

  const openUpdateUrl = async () => {
    const targetUrl = updateNotice?.assetUrl || updateNotice?.url;
    if (!targetUrl) return;
    if (window.imade?.openExternal) {
      const result = await window.imade.openExternal(targetUrl);
      if (result?.ok) return;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const renderUpdateNotice = () => {
    if (!updateNotice) return null;
    return (
      <div
        className={`fixed right-4 top-24 z-[91] flex max-w-[380px] items-center gap-2 rounded-full border px-2 py-1.5 text-xs shadow-2xl ${
          isDark
            ? 'border-emerald-300/20 bg-zinc-950/94 text-white'
            : 'border-emerald-700/15 bg-white/96 text-zinc-900'
        }`}
        style={{ backdropFilter: 'blur(16px)' }}
      >
        <button
          type="button"
          onClick={openUpdateUrl}
          className={`flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-left ${
            isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'
          }`}
          title="打开最新版本"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
          <span className="truncate font-medium">发现新版本 v{updateNotice.version}</span>
          <ExternalLink size={13} className={isDark ? 'text-white/55' : 'text-zinc-500'} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setUpdateNotice(null);
          }}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            isDark ? 'hover:bg-white/10 text-white/65' : 'hover:bg-black/5 text-zinc-600'
          }`}
          title="关闭提示"
        >
          <X size={13} />
        </button>
      </div>
    );
  };

  const renderDownloadNotice = () => {
    if (!downloadNotice) return null;
    const isError = downloadNotice.kind === 'error';
    return (
      <div
        className={`fixed right-4 top-14 z-[90] flex max-w-[360px] items-center gap-2 rounded-full border px-2 py-1.5 text-xs shadow-2xl ${
          isDark
            ? 'border-white/12 bg-zinc-950/92 text-white'
            : 'border-black/12 bg-white/96 text-zinc-900'
        }`}
        style={{ backdropFilter: 'blur(16px)' }}
      >
        <button
          type="button"
          onClick={openDownloadDirectory}
          className={`flex min-w-0 items-center gap-2 rounded-full px-2 py-1 text-left ${
            downloadNotice.directory
              ? isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'
              : ''
          }`}
          title={downloadNotice.directory ? '打开下载目录' : downloadNotice.message}
        >
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              isError ? 'bg-red-400' : 'bg-emerald-400'
            }`}
          />
          <span className="truncate font-medium">{downloadNotice.message}</span>
          {downloadNotice.fileName && (
            <span className={isDark ? 'max-w-[120px] truncate text-white/45' : 'max-w-[120px] truncate text-zinc-500'}>
              {downloadNotice.fileName}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDownloadNotice(null);
          }}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            isDark ? 'hover:bg-white/10 text-white/65' : 'hover:bg-black/5 text-zinc-600'
          }`}
          title="关闭提示"
        >
          <X size={13} />
        </button>
      </div>
    );
  };

  const renderTransferProgress = () => {
    if (!transferProgress) return null;
    const percent = Math.max(0, Math.min(100, Math.round((transferProgress.current / Math.max(transferProgress.total, 1)) * 100)));
    return (
      <div
        className={`fixed right-4 top-[98px] z-[92] w-[320px] rounded-2xl border p-3 text-xs shadow-2xl ${
          isDark ? 'border-white/12 bg-[#111111] text-white' : 'border-black/10 bg-white text-zinc-900'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{transferProgress.kind === 'export' ? '导出项目' : '导入项目'}</div>
            <div className={`mt-0.5 truncate ${isDark ? 'text-white/50' : 'text-zinc-500'}`}>{transferProgress.label}</div>
          </div>
          <div className={isDark ? 'text-white/55' : 'text-zinc-500'}>{percent}%</div>
        </div>
        <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
          <div
            className={transferProgress.kind === 'export' ? 'h-full rounded-full bg-emerald-400' : 'h-full rounded-full bg-sky-400'}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  };

  const renderRecentCard = (canvas: CanvasListItem, compact = false) => {
    const isDeleting = deletingRecentId === canvas.id;
    const isEditing = editingRecentId === canvas.id;
    const isBusy = isDeleting || copyingRecentId === canvas.id || exportingRecentId === canvas.id;
    const previewUrl = getRecentPreviewUrl(canvas);
    const createdText = formatProjectTime(canvas.createdAt);
    const updatedText = formatProjectTime(canvas.updatedAt);
    return (
      <div
        key={canvas.id}
        className={`group relative overflow-visible rounded-xl border text-left transition ${
          isDark
            ? 'border-white/10 bg-white/[0.035] hover:bg-white/[0.07]'
            : 'border-black/10 bg-white/70 hover:bg-white'
        }`}
        onContextMenu={(e) => {
          e.preventDefault();
          setRecentMenu({ x: e.clientX, y: e.clientY, canvas });
        }}
      >
        <button
          type="button"
          onClick={() => openRecentCanvas(canvas.id)}
          className="block w-full text-left"
          disabled={isEditing}
        >
          <div className={`aspect-video overflow-hidden ${isDark ? 'bg-white/5' : 'bg-black/[0.04]'}`}>
            {previewUrl ? (
              canvas.previewKind === 'video' ? (
                <video src={previewUrl} className="h-full w-full object-cover" muted draggable={false} />
              ) : (
                <img src={previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
              )
            ) : (
              <div className="flex h-full items-center justify-center">
                <img src={logoUrl} alt="" className={compact ? 'h-8 w-8 opacity-45' : 'h-9 w-9 opacity-45'} draggable={false} />
              </div>
            )}
          </div>
        </button>
        <div className={`${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'} flex items-center gap-2`}>
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <input
                autoFocus
                value={editingRecentName}
                onChange={(e) => setEditingRecentName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRenameRecent();
                  if (e.key === 'Escape') {
                    setEditingRecentId(null);
                    setEditingRecentName('');
                  }
                }}
                onBlur={() => void submitRenameRecent()}
                className={`h-5 w-full rounded border px-1.5 text-xs font-medium outline-none ${
                  isDark ? 'border-white/20 bg-zinc-900 text-white' : 'border-black/20 bg-white text-zinc-900'
                }`}
              />
            ) : (
              <div className={`truncate text-xs font-medium ${isDark ? 'text-white/78' : 'text-zinc-800'}`}>{canvas.name}</div>
            )}
            <div className={`mt-0.5 text-[10px] ${isDark ? 'text-white/35' : 'text-zinc-500'}`}>{canvas.nodeCount} 个节点</div>
            <div className={`mt-1 space-y-0.5 text-[10px] leading-tight ${isDark ? 'text-white/28' : 'text-zinc-400'}`}>
              <div className="truncate">创建 {createdText}</div>
              <div className="truncate">修改 {updatedText}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center self-end opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setRecentMenu({
                  x: Math.min(rect.right - 144, window.innerWidth - 156),
                  y: rect.bottom + 6,
                  canvas,
                });
              }}
              disabled={isBusy}
              className={`flex h-7 w-7 items-center justify-center rounded-full disabled:cursor-wait disabled:opacity-50 ${
                isDark ? 'text-white/62 hover:bg-white/12 hover:text-white' : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-950'
              }`}
              title="项目选项"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderNewProjectCard = () => (
    <button
      type="button"
      onClick={handleCreateProject}
      disabled={creatingProject || canvasLoading || backendStatus !== 'ok' || importingProject}
      className={`group flex min-h-[245px] flex-col overflow-hidden rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
        isDark
          ? 'border-white/12 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.07]'
          : 'border-black/10 bg-white/70 hover:border-black/16 hover:bg-white'
      }`}
    >
      <div
        className={`flex aspect-video w-full items-center justify-center border-b border-dashed ${
          isDark ? 'border-white/12 bg-white/[0.025]' : 'border-black/10 bg-zinc-100/70'
        }`}
      >
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full transition ${
            isDark
              ? 'bg-white/10 text-white/72 group-hover:bg-white/16 group-hover:text-white'
              : 'bg-zinc-900 text-white group-hover:bg-black'
          }`}
        >
          <Plus size={20} />
        </div>
      </div>
      <div className="px-3 py-2.5">
        <div className={`text-xs font-medium ${isDark ? 'text-white/82' : 'text-zinc-800'}`}>
          {creatingProject ? '正在新建...' : '新建项目'}
        </div>
        <div className={`mt-1 text-[10px] ${isDark ? 'text-white/34' : 'text-zinc-500'}`}>空白画布</div>
      </div>
    </button>
  );

  const renderRecentContextMenu = () => {
    if (!recentMenu) return null;
    const { canvas } = recentMenu;
    const menuClass = isDark
      ? 'border-white/10 bg-zinc-950/96 text-white'
      : 'border-black/10 bg-white/98 text-zinc-900';
    const itemClass = isDark
      ? 'hover:bg-white/10 text-white/80'
      : 'hover:bg-black/5 text-zinc-700';
    return (
      <>
        <button
          type="button"
          className="fixed inset-0 z-[95] cursor-default"
          aria-label="关闭最近使用菜单"
          onClick={() => {
            setRecentMenu(null);
          }}
        />
        <div
          className={`fixed z-[96] w-40 overflow-hidden rounded-xl border p-1 text-xs shadow-2xl ${menuClass}`}
          style={{
            left: Math.max(8, Math.min(recentMenu.x, window.innerWidth - 168)),
            top: Math.max(8, Math.min(recentMenu.y, window.innerHeight - 190)),
            backdropFilter: 'blur(18px)',
          }}
        >
          <button
            type="button"
            onClick={() => openRecentCanvas(canvas.id)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${itemClass}`}
          >
            <ExternalLink size={13} />
            打开
          </button>
          <button
            type="button"
            onClick={() => startRenameRecent(canvas)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${itemClass}`}
          >
            <Edit2 size={13} />
            重命名
          </button>
          <button
            type="button"
            onClick={() => void copyRecentProject(canvas)}
            disabled={copyingRecentId === canvas.id}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left disabled:cursor-wait disabled:opacity-50 ${itemClass}`}
          >
            <CopyIcon size={13} />
            {copyingRecentId === canvas.id ? '复制中' : '复制项目'}
          </button>
          <button
            type="button"
            onClick={() => void exportRecentProject(canvas)}
            disabled={exportingRecentId === canvas.id}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left disabled:cursor-wait disabled:opacity-50 ${itemClass}`}
          >
            <DownloadIcon size={13} />
            {exportingRecentId === canvas.id ? '导出中' : '导出项目'}
          </button>
          <div className={isDark ? 'my-1 h-px bg-white/10' : 'my-1 h-px bg-black/10'} />
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteRecent(canvas);
              setRecentMenu(null);
            }}
            disabled={deletingRecentId === canvas.id}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left disabled:cursor-wait disabled:opacity-50 ${
              isDark ? 'hover:bg-red-500/15 text-red-300' : 'hover:bg-red-50 text-red-600'
            }`}
          >
            <Trash2 size={13} />
            {deletingRecentId === canvas.id ? '正在删除' : '删除'}
          </button>
        </div>
      </>
    );
  };

  if (!projectStarted) {
    return (
      <div className={`h-screen overflow-hidden ${isDark ? 'bg-zinc-950 text-white' : 'bg-zinc-50 text-zinc-900'}`}>
        {renderDownloadNotice()}
        {renderUpdateNotice()}
        {renderTransferProgress()}
        <input
          ref={importProjectInputRef}
          type="file"
          accept=".imade-project.json,application/json"
          className="hidden"
          onChange={(e) => void handleImportProjectFile(e.currentTarget.files?.[0])}
        />
        <aside
          className={`absolute left-0 top-0 flex h-full w-[72px] flex-col items-center border-r px-3 py-4 ${
            isDark ? 'border-white/10 bg-black/18' : 'border-black/8 bg-white/72'
          }`}
        >
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isDark ? 'bg-white/10' : 'bg-zinc-900 text-white'}`}>
            <FolderOpen size={18} />
          </div>
          <div className="mt-5 flex flex-1 flex-col items-center gap-2">
            <button
              type="button"
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                isDark ? 'bg-white/10 text-white' : 'bg-zinc-900 text-white'
              }`}
              title="项目"
            >
              <FolderOpen size={17} />
            </button>
            <button
              type="button"
              onClick={() => importProjectInputRef.current?.click()}
              disabled={importingProject || creatingProject || backendStatus !== 'ok'}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isDark ? 'text-white/62 hover:bg-white/10 hover:text-white' : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-900'
              }`}
              title="导入项目"
            >
              <Upload size={17} />
            </button>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${isDark ? 'text-white/62 hover:bg-white/10 hover:text-white' : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-900'}`}
              title="设置"
            >
              <Settings size={17} />
            </button>
            <button
              onClick={toggleTheme}
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${isDark ? 'text-white/62 hover:bg-white/10 hover:text-white' : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-900'}`}
              title={`切换到${isDark ? '浅色' : '深色'}模式`}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </aside>
        <main className="ml-[72px] h-full overflow-y-auto px-6 py-7 2xl:px-10">
          <div className="w-full">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-[26px] font-semibold tracking-normal">项目</h1>
                <div className={`mt-2 flex items-center gap-2 text-xs ${isDark ? 'text-white/42' : 'text-zinc-500'}`}>
                  <span>{projectName}</span>
                  <span className={isDark ? 'text-white/20' : 'text-zinc-300'}>/</span>
                  <span>
                    {backendStatus === 'ok' ? '准备就绪' : backendStatus === 'checking' ? '正在连接服务...' : '服务未连接'}
                  </span>
                  <span className={isDark ? 'text-white/20' : 'text-zinc-300'}>/</span>
                  <span>共 {visibleRecentCanvases.length} 个项目</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => importProjectInputRef.current?.click()}
                  disabled={importingProject || creatingProject || backendStatus !== 'ok'}
                  className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isDark
                      ? 'border-white/12 bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white'
                      : 'border-black/10 bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950'
                  }`}
                >
                  <Upload size={14} />
                  {importingProject ? '导入中' : '导入项目'}
                </button>
              </div>
            </div>
            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <div className={`text-sm font-medium ${isDark ? 'text-white/76' : 'text-zinc-800'}`}>全部项目</div>
                {hasMoreRecentCanvases && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecentMoreOpen(true);
                      setRecentMenu(null);
                    }}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${
                      isDark ? 'text-white/55 hover:bg-white/10 hover:text-white' : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-800'
                    }`}
                  >
                    查看更多
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 2xl:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                {renderNewProjectCard()}
                {recentCanvases.map((canvas) => renderRecentCard(canvas))}
              </div>
            </div>
          </div>
        </main>
        {recentMoreOpen && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center px-5">
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-black/35"
              aria-label="关闭更多最近使用"
              onClick={() => {
                setRecentMoreOpen(false);
                setRecentMenu(null);
              }}
            />
            <div
              className={`relative z-[91] max-h-[78vh] w-[min(900px,calc(100vw-40px))] overflow-hidden rounded-2xl border shadow-2xl ${
                isDark ? 'border-white/10 bg-zinc-950/96 text-white' : 'border-black/10 bg-white/98 text-zinc-900'
              }`}
              style={{ backdropFilter: 'blur(20px)' }}
            >
              <div className={`flex items-center justify-between border-b px-4 py-3 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                <div>
                  <div className="text-sm font-semibold">最近使用</div>
                  <div className={`mt-0.5 text-[11px] ${isDark ? 'text-white/40' : 'text-zinc-500'}`}>
                    最多显示 {RECENT_MORE_LIMIT} 个项目
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRecentMoreOpen(false);
                    setRecentMenu(null);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    isDark ? 'hover:bg-white/10 text-white/70' : 'hover:bg-black/5 text-zinc-600'
                  }`}
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="max-h-[calc(78vh-68px)] overflow-y-auto p-4">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                  {moreRecentCanvases.map((canvas) => renderRecentCard(canvas, true))}
                </div>
              </div>
            </div>
          </div>
        )}
        {renderRecentContextMenu()}
        {confirmDeleteRecent && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center px-5">
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-black/45"
              aria-label="取消删除项目"
              onClick={() => setConfirmDeleteRecent(null)}
            />
            <div
              className={`relative z-[111] w-[min(420px,calc(100vw-40px))] rounded-2xl border p-6 shadow-2xl ${
                isDark ? 'border-white/10 bg-[#111111] text-white' : 'border-black/10 bg-white text-zinc-900'
              }`}
            >
              <div className="text-base font-semibold">确定删除此项目？</div>
              <div className={`mt-3 text-sm leading-6 ${isDark ? 'text-white/62' : 'text-zinc-600'}`}>
                所选项目「{confirmDeleteRecent.name}」将被永久删除且无法恢复。
              </div>
              <div className="mt-7 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteRecent(null)}
                  className={`h-9 rounded-lg border px-5 text-sm ${
                    isDark ? 'border-white/12 text-white/80 hover:bg-white/10' : 'border-black/10 text-zinc-700 hover:bg-black/5'
                  }`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRecentNow(confirmDeleteRecent.id)}
                  disabled={deletingRecentId === confirmDeleteRecent.id}
                  className="h-9 rounded-lg bg-red-500 px-5 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-wait disabled:opacity-60"
                >
                  {deletingRecentId === confirmDeleteRecent.id ? '删除中' : '删除'}
                </button>
              </div>
            </div>
          </div>
        )}
        <ApiSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${isDark ? 'bg-zinc-950 text-white' : 'bg-zinc-50 text-zinc-900'}`}>
      <header
        className={`flex items-center justify-between px-4 py-2 border-b ${
          isDark ? 'bg-zinc-900 border-white/10' : 'bg-white border-black/10'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void returnToStartPage()}
            disabled={savingCanvas}
            className={`flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-50 ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title="返回启动页"
          >
            <img src={logoUrl} alt="" className="h-6 w-6" draggable={false} />
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10 text-white/80' : 'hover:bg-black/5 text-zinc-700'}`}
            title={menuOpen ? '关闭菜单' : '打开菜单'}
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
          <h1 className="text-sm font-semibold tracking-wide">{projectName}</h1>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10 text-white/60' : 'bg-black/5 text-zinc-500'}`}>
            v{appVersion}
          </span>
          <div
            className={`flex items-center gap-1.5 text-[11px] ${
              backendStatus === 'ok'
                ? 'text-emerald-400'
                : backendStatus === 'error'
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }`}
          >
            {backendStatus === 'ok' ? <Wifi size={12} /> : <WifiOff size={12} />}
            {backendStatus === 'ok' && '后端已连接'}
            {backendStatus === 'error' && '后端未连接'}
            {backendStatus === 'checking' && '检测中...'}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={saveCanvasNow}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title={savingCanvas ? '已保存' : '保存画布'}
          >
            <Save size={16} />
          </button>
          <button
            onClick={openSharedFolder}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title="共享文件"
          >
            <FolderOpen size={16} />
          </button>
          <button
            onClick={openNetdisk}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title="网盘"
          >
            <Cloud size={16} />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title="设置"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={toggleTheme}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title={`切换到${isDark ? '浅色' : '深色'}模式`}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {menuOpen && (
          <>
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="关闭菜单"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute left-3 top-3 z-40">
              <Sidebar
                floating
                appName={projectName}
                appVersion={appVersion}
                hiddenGroups={['input', 'core']}
                onAddNode={(type) => {
                  addNodeRef.current?.(type);
                  setMenuOpen(false);
                }}
              />
            </div>
          </>
        )}

        <ErrorBoundary fallbackTitle="画布渲染出错，已被错误边界捕获">
          <Canvas onAddNodeRef={addNodeRef} onSaveRef={saveCanvasRef} interactionMode={interactionMode} />
        </ErrorBoundary>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
          <div
            className={`pointer-events-auto relative flex items-center gap-2 rounded-full border px-2.5 py-2 ${
              isDark ? 'border-white/10 bg-zinc-950/84' : 'border-black/10 bg-white/90'
            }`}
            style={{ backdropFilter: 'blur(18px)', boxShadow: '0 18px 60px rgba(0,0,0,.34)' }}
          >
            {toolMenuOpen && (
              <div
                className={`absolute bottom-[58px] left-0 w-32 overflow-hidden rounded-2xl border p-1.5 ${
                  isDark ? 'border-white/10 bg-zinc-950/95' : 'border-black/10 bg-white/95'
                }`}
                style={{ backdropFilter: 'blur(18px)', boxShadow: '0 18px 44px rgba(0,0,0,.35)' }}
              >
                <button
                  onClick={() => selectTool('select')}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs ${
                    interactionMode === 'select'
                      ? isDark ? 'bg-white/14 text-white' : 'bg-black/10 text-zinc-900'
                      : isDark ? 'text-white/70 hover:bg-white/10' : 'text-zinc-600 hover:bg-black/5'
                  }`}
                >
                  <MousePointer2 size={14} />
                  选择
                </button>
                <button
                  onClick={() => selectTool('move')}
                  className={`mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs ${
                    interactionMode === 'move'
                      ? isDark ? 'bg-white/14 text-white' : 'bg-black/10 text-zinc-900'
                      : isDark ? 'text-white/70 hover:bg-white/10' : 'text-zinc-600 hover:bg-black/5'
                  }`}
                >
                  <Hand size={14} />
                  移动
                </button>
              </div>
            )}

            <button
              onPointerDown={beginToolPress}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onContextMenu={(e) => {
                e.preventDefault();
                setToolMenuOpen(true);
              }}
              title="长按选择工具"
              className={`flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-full p-0 transition ${
                isDark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-black/8 text-zinc-800 hover:bg-black/10'
              }`}
            >
              <ActiveToolIcon size={18} />
            </button>

            {BOTTOM_CORE_NODES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  onClick={() => addNodeRef.current?.(item.type)}
                  title={item.label}
                  className={`flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-full p-0 transition ${
                    isDark ? 'text-white/82 hover:bg-white/10' : 'text-zinc-700 hover:bg-black/5'
                  }`}
                  style={{ color: item.accent }}
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <ApiSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {renderDownloadNotice()}
      {renderUpdateNotice()}
    </div>
  );
}

export default App;
