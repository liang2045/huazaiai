import { useEffect, useState } from 'react';
import { Cloud, Eye, EyeOff, FolderOpen, KeyRound, Loader2, RefreshCw, Save, Trash2, Wifi, X } from 'lucide-react';
import { useApiKeysStore, DEFAULT_ZHENZHEN_BASE, RH_BASE } from '../stores/apiKeys';
import { useThemeStore } from '../stores/theme';
import type { ApiSettings } from '../types/canvas';
import { apiUrl } from '../services/apiBase';

interface ApiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type KeyField =
  | 'zhenzhenApiKey'
  | 'llmApiKey'
  | 'gptImageApiKey'
  | 'nanoBananaApiKey'
  | 'mjApiKey'
  | 'veoApiKey'
  | 'grokApiKey'
  | 'seedanceApiKey'
  | 'sunoApiKey'
  | 'rhApiKey'
  | 'rhWalletApiKey';

interface KeySpec {
  field: KeyField;
  label: string;
  desc: string;
  tone: string;
}

const COMMON_KEYS: KeySpec[] = [
  { field: 'zhenzhenApiKey', label: '模型服务 API Key', desc: '通用后备，用于图像、视频、音频生成', tone: '#b8ab8d' },
  { field: 'llmApiKey', label: 'LLM 独立 API Key', desc: '用于 LLM / Vision', tone: '#9fb4aa' },
];

const RH_KEYS: KeySpec[] = [
  { field: 'rhApiKey', label: 'RunningHub API Key', desc: '用于 RunningHub 工作流节点', tone: '#67e8f9' },
  { field: 'rhWalletApiKey', label: 'RH 钱包 API Key', desc: '用于 RH 钱包应用节点', tone: '#c4b5fd' },
];

const CLASSIFIED_KEYS: KeySpec[] = [
  { field: 'gptImageApiKey', label: 'gpt-image 系列', desc: 'GPT 图像任务专用', tone: '#b6a0a3' },
  { field: 'nanoBananaApiKey', label: 'nano-banana 系列', desc: 'Nano Banana 图像任务专用', tone: '#bdb395' },
  { field: 'mjApiKey', label: 'mj 系列', desc: 'Midjourney 任务专用', tone: '#aaa3b4' },
  { field: 'veoApiKey', label: 'veo 系列', desc: 'Veo 视频任务专用', tone: '#9faab6' },
  { field: 'grokApiKey', label: 'grok 系列', desc: 'Grok 视频任务专用', tone: '#b3a18f' },
  { field: 'seedanceApiKey', label: 'seedance 系列', desc: 'Seedance 视频任务专用', tone: '#9fb4b0' },
  { field: 'sunoApiKey', label: 'suno 系列', desc: 'Suno 音乐任务专用', tone: '#b2a0aa' },
];

const ALL_FIELDS: KeyField[] = [
  ...COMMON_KEYS.map((k) => k.field),
  ...CLASSIFIED_KEYS.map((k) => k.field),
  ...RH_KEYS.map((k) => k.field),
];

const emptyMap = (): Record<KeyField, string> => ({
  zhenzhenApiKey: '',
  llmApiKey: '',
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  rhApiKey: '',
  rhWalletApiKey: '',
});

const emptyShow = (): Record<KeyField, boolean> => ({
  zhenzhenApiKey: false,
  llmApiKey: false,
  gptImageApiKey: false,
  nanoBananaApiKey: false,
  mjApiKey: false,
  veoApiKey: false,
  grokApiKey: false,
  seedanceApiKey: false,
  sunoApiKey: false,
  rhApiKey: false,
  rhWalletApiKey: false,
});

type CacheStats = {
  totalSize: number;
  totalFiles: number;
  byDir: Record<string, { path: string; files: number; size: number }>;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const normalizeUrlInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
};

export default function ApiSettingsModal({ open, onClose }: ApiSettingsModalProps) {
  const { theme } = useThemeStore();
  const { settings, loading, error, load, save, loaded } = useApiKeysStore();
  const isDark = theme === 'dark';

  const [inputs, setInputs] = useState<Record<KeyField, string>>(emptyMap());
  const [shows, setShows] = useState<Record<KeyField, boolean>>(emptyShow());
  const [zhenzhenBaseUrl, setZhenzhenBaseUrl] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [rhBaseUrl, setRhBaseUrl] = useState('');
  const [sharedFolderPath, setSharedFolderPath] = useState('');
  const [netdiskUrl, setNetdiskUrl] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  useEffect(() => {
    if (!open) return;
    setInputs(emptyMap());
    setShows(emptyShow());
    setZhenzhenBaseUrl(settings.zhenzhenBaseUrl || DEFAULT_ZHENZHEN_BASE);
    setLlmBaseUrl(settings.llmBaseUrl || settings.zhenzhenBaseUrl || DEFAULT_ZHENZHEN_BASE);
    setRhBaseUrl(settings.rhBaseUrl || RH_BASE);
    setSharedFolderPath(settings.sharedFolderPath || '');
    setNetdiskUrl(settings.netdiskUrl || '');
    setDownloadDir(settings.downloadDir || '');
    setCacheMessage('');
    void loadCacheStats();
    setSaved(false);
  }, [open, settings.zhenzhenBaseUrl, settings.llmBaseUrl, settings.rhBaseUrl, settings.sharedFolderPath, settings.netdiskUrl, settings.downloadDir]);

  if (!open) return null;

  const setInputAt = (f: KeyField, v: string) => {
    setInputs((prev) => ({ ...prev, [f]: v }));
  };

  const handleToggleShow = (f: KeyField) => {
    setShows((prev) => ({ ...prev, [f]: !prev[f] }));
  };

  const handleSave = async () => {
    const patch: Partial<ApiSettings> = {};
    for (const f of ALL_FIELDS) {
      const v = inputs[f].trim();
      if (!v) continue;
      (patch as any)[f] = v;
    }
    const normalizedZhenzhenBaseUrl = normalizeUrlInput(zhenzhenBaseUrl);
    const normalizedLlmBaseUrl = normalizeUrlInput(llmBaseUrl);
    const normalizedRhBaseUrl = normalizeUrlInput(rhBaseUrl);
    if (normalizedZhenzhenBaseUrl && normalizedZhenzhenBaseUrl !== (settings.zhenzhenBaseUrl || DEFAULT_ZHENZHEN_BASE)) {
      patch.zhenzhenBaseUrl = normalizedZhenzhenBaseUrl;
    }
    if (normalizedLlmBaseUrl && normalizedLlmBaseUrl !== (settings.llmBaseUrl || settings.zhenzhenBaseUrl || DEFAULT_ZHENZHEN_BASE)) {
      patch.llmBaseUrl = normalizedLlmBaseUrl;
    }
    if (normalizedRhBaseUrl && normalizedRhBaseUrl !== (settings.rhBaseUrl || RH_BASE)) {
      patch.rhBaseUrl = normalizedRhBaseUrl;
    }
    if (sharedFolderPath.trim() !== (settings.sharedFolderPath || '')) {
      patch.sharedFolderPath = sharedFolderPath.trim();
    }
    if (netdiskUrl.trim() !== (settings.netdiskUrl || '')) {
      patch.netdiskUrl = netdiskUrl.trim();
    }
    if (downloadDir.trim() !== (settings.downloadDir || '')) {
      patch.downloadDir = downloadDir.trim();
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    await save(patch);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 700);
  };

  const toMaskedDisplay = (v?: string): string => {
    if (!v) return '';
    const s = String(v);
    if (/^\*{2,}/.test(s)) return s;
    return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
  };

  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isDark
      ? 'border-white/20 bg-zinc-950 text-white placeholder:text-white/45 focus:border-white/55'
      : 'border-zinc-300 bg-white text-zinc-950 placeholder:text-zinc-500 focus:border-zinc-700'
  }`;
  const labelCls = isDark ? 'text-white/86' : 'text-zinc-900';
  const hintCls = isDark ? 'text-white/62' : 'text-zinc-600';
  const panelCls = isDark ? 'border-white/15 bg-zinc-950/55' : 'border-zinc-200 bg-zinc-50';

  const renderKey = (spec: KeySpec, fallbackHint = false) => {
    const f = spec.field;
    const rawVal = (settings as any)[f] as string | undefined;
    const hasSaved = !!rawVal;
    return (
      <div key={f} className={`rounded-xl border p-3 ${panelCls}`}>
        <label className={`flex items-center gap-2 text-sm font-medium ${labelCls}`}>
          <span className="h-2 w-2 rounded-full" style={{ background: spec.tone }} />
          <span>{spec.label}</span>
          {hasSaved && (
            <span className="ml-auto rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
              已保存 {toMaskedDisplay(rawVal)}
            </span>
          )}
        </label>
        <div className={`mt-1 text-[11px] ${hintCls}`}>
          {spec.desc}{fallbackHint && !hasSaved ? '，留空使用通用 Key' : ''}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type={shows[f] ? 'text' : 'password'}
            value={inputs[f]}
            onChange={(e) => setInputAt(f, e.target.value)}
            placeholder={hasSaved ? '留空保持不变，输入新值覆盖' : '请输入 API Key'}
            className={inputCls}
            autoComplete="off"
          />
          <button
            onClick={() => handleToggleShow(f)}
            className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title={shows[f] ? '隐藏输入内容' : '显示输入内容'}
          >
            {shows[f] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
    );
  };

  const chooseDownloadDir = async () => {
    const result = await window.imade?.chooseDirectory?.();
    if (result?.ok && result.path) setDownloadDir(result.path);
  };

  async function loadCacheStats() {
    try {
      const res = await fetch(apiUrl('/api/files/cache-stats'));
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) setCacheStats(json.data);
    } catch {
      // cache stats are best-effort.
    }
  }

  const cleanCache = async () => {
    setCacheBusy(true);
    setCacheMessage('');
    try {
      const res = await fetch(apiUrl('/api/files/cache-cleanup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      const removedFiles = Number(json.data?.removedFiles || 0);
      const removedSize = Number(json.data?.removedSize || 0);
      setCacheStats(json.data?.summary || null);
      setCacheMessage(`已清理 ${removedFiles} 个文件，释放 ${formatBytes(removedSize)}`);
    } catch (err) {
      setCacheMessage(`清理失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCacheBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <div
        className={`flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl ${
          isDark ? 'border-white/10 bg-zinc-900' : 'border-black/10 bg-white'
        }`}
      >
        <div className={`flex items-center gap-3 border-b px-5 py-4 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
          <KeyRound size={18} className={isDark ? 'text-white/80' : 'text-zinc-700'} />
          <div className="flex-1">
            <h2 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>设置</h2>
            <p className={`mt-0.5 text-xs ${hintCls}`}>模型服务、共享文件夹、网盘和 API Key 管理</p>
          </div>
          <button
            onClick={onClose}
            className={`h-8 w-8 rounded-full flex items-center justify-center ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <FolderOpen size={15} /> 共享文件
            </div>
            <input
              value={sharedFolderPath}
              onChange={(e) => setSharedFolderPath(e.target.value)}
              placeholder="例如 D:\\共享文件 或 F:\\素材库"
              className={inputCls}
            />
          </div>

          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <Cloud size={15} /> 网盘
            </div>
            <input
              value={netdiskUrl}
              onChange={(e) => setNetdiskUrl(e.target.value)}
              placeholder="例如 https://pan.example.com"
              className={inputCls}
            />
          </div>

          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <Wifi size={15} /> 模型服务 Base URL
            </div>
            <input
              value={zhenzhenBaseUrl}
              onChange={(e) => setZhenzhenBaseUrl(e.target.value)}
              placeholder={DEFAULT_ZHENZHEN_BASE}
              className={inputCls}
            />
            <div className={`mt-1.5 text-[11px] ${hintCls}`}>用于图像、视频、音频等模型服务；无协议时保存为 https://</div>
          </div>

          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <Wifi size={15} /> LLM Base URL
            </div>
            <input
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder={zhenzhenBaseUrl || DEFAULT_ZHENZHEN_BASE}
              className={inputCls}
            />
            <div className={`mt-1.5 text-[11px] ${hintCls}`}>用于 LLM / Vision；留默认时可与模型服务 Base URL 保持一致</div>
          </div>

          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <FolderOpen size={15} /> 下载目录
            </div>
            <div className="flex items-center gap-2">
              <input
                value={downloadDir}
                onChange={(e) => setDownloadDir(e.target.value)}
                placeholder="首次下载时也可以选择目录"
                className={inputCls}
              />
              <button
                type="button"
                onClick={chooseDownloadDir}
                className={`h-9 shrink-0 rounded-lg px-3 text-xs ${isDark ? 'bg-white/8 text-white/75 hover:bg-white/12' : 'bg-black/5 text-zinc-700 hover:bg-black/10'}`}
              >
                选择
              </button>
            </div>
          </div>

          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <Trash2 size={15} /> 缓存与输出
              <button
                type="button"
                onClick={() => void loadCacheStats()}
                className={`ml-auto flex h-7 w-7 items-center justify-center rounded-full ${isDark ? 'hover:bg-white/10 text-white/65' : 'hover:bg-black/5 text-zinc-600'}`}
                title="刷新"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className={`mb-3 text-xs ${hintCls}`}>
              {cacheStats
                ? `${cacheStats.totalFiles} 个文件 · ${formatBytes(cacheStats.totalSize)}`
                : '正在统计缓存目录...'}
            </div>
            {cacheStats && (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {Object.entries(cacheStats.byDir).map(([key, item]) => (
                  <div key={key} className={`rounded-lg border px-2 py-1.5 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-black/10 bg-white'}`}>
                    <div className={`text-[10px] uppercase ${hintCls}`}>{key}</div>
                    <div className={`mt-0.5 text-xs font-semibold ${labelCls}`}>{formatBytes(item.size)}</div>
                    <div className={`truncate text-[10px] ${hintCls}`}>{item.files} 个文件</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={cacheBusy}
                onClick={cleanCache}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs disabled:opacity-50 ${
                  isDark ? 'bg-red-500/12 text-red-200 hover:bg-red-500/18' : 'bg-red-50 text-red-700 hover:bg-red-100'
                }`}
              >
                {cacheBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                清理 7 天前未引用文件
              </button>
              {cacheMessage && <span className={`text-[11px] ${hintCls}`}>{cacheMessage}</span>}
            </div>
          </div>

          <div className={`rounded-xl border p-3 ${panelCls}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${labelCls}`}>
              <Wifi size={15} /> RunningHub Base URL
            </div>
            <input
              value={rhBaseUrl}
              onChange={(e) => setRhBaseUrl(e.target.value)}
              placeholder={RH_BASE}
              className={inputCls}
            />
            <div className={`mt-1.5 text-[11px] ${hintCls}`}>用于 RunningHub/RH 工作流接口；无协议时保存为 https://</div>
          </div>

          {COMMON_KEYS.map((spec) => renderKey(spec))}
          {RH_KEYS.map((spec) => renderKey(spec))}

          <div className={`border-t pt-4 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
            <div className={`mb-1 text-xs font-bold ${labelCls}`}>分类独立 API Key</div>
            <div className={`mb-3 text-[11px] ${hintCls}`}>可选配置，未填写时自动使用模型服务通用 Key。</div>
            <div className="space-y-3">{CLASSIFIED_KEYS.map((spec) => renderKey(spec, true))}</div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className={`flex items-center justify-end gap-2 border-t px-5 py-3 ${isDark ? 'border-white/10 bg-white/[0.02]' : 'border-black/10 bg-black/[0.02]'}`}>
          <button
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm ${isDark ? 'text-white/75 hover:bg-white/10' : 'text-zinc-700 hover:bg-black/5'}`}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
            style={{
              background: isDark ? '#f3f0e8' : '#111111',
              color: isDark ? '#090909' : '#f5f5f5',
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : saved ? '已保存' : <Save size={14} />}
            {!loading && !saved && '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
