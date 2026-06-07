import { useEffect, useRef, useState } from 'react';
import {
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  Trash2,
  Download,
  Upload,
  Sparkles,
  HelpCircle,
  X,
  Play,
  Square,
  Magnet,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import { useLogStore } from '../stores/logs';
import { CANVAS_TEMPLATES, type CanvasTemplate } from '../config/canvasTemplates';

interface CanvasToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  clipboardCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: () => void;
  onApplyTemplate: (tpl: CanvasTemplate) => void;
  // 批量运行
  onRunAll: () => void;
  onCancelRun: () => void;
  isRunning: boolean;
  batchTotal: number;
  batchDone: number;
  // 吸附开关
  snapEnabled: boolean;
  onToggleSnap: () => void;
}

export default function CanvasToolbar({
  canUndo,
  canRedo,
  selectedCount,
  clipboardCount,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDelete,
  onExport,
  onImport,
  onApplyTemplate,
  onRunAll,
  onCancelRun,
  isRunning,
  batchTotal,
  batchDone,
  snapEnabled,
  onToggleSnap,
}: CanvasToolbarProps) {
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const termOpen = useLogStore((s) => s.open);
  const termUnread = useLogStore((s) => s.unread);
  const toggleTerm = useLogStore((s) => s.toggleOpen);
  const [tplOpen, setTplOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const tplRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭模板下拉
  useEffect(() => {
    if (!tplOpen) return;
    const onClick = (e: MouseEvent) => {
      if (tplRef.current && !tplRef.current.contains(e.target as Node)) {
        setTplOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [tplOpen]);

  const baseBtn = isPixel
    ? 'relative flex items-center justify-center w-8 h-8 rounded-full transition-colors hover:bg-[var(--px-muted)] text-[var(--px-ink)]'
    : `relative flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
        isDark ? 'text-zinc-200 hover:bg-white/10' : 'text-zinc-700 hover:bg-black/5'
      }`;
  const disabledCls = 'opacity-30 cursor-not-allowed pointer-events-none';
  const sep = isPixel
    ? 'w-px self-stretch mx-1 bg-[var(--px-ink)]/30'
    : `w-px self-stretch mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`;

  const containerCls = isPixel
    ? 'flex items-center gap-0.5 px-2 py-1 px-card'
    : `flex items-center gap-0.5 px-1.5 py-1 rounded-lg shadow-lg border ${
        isDark ? 'bg-zinc-900 border-white/10' : 'bg-white border-black/10'
      }`;
  const templatePanelCls = isPixel
    ? 'absolute right-0 mt-1.5 w-64 px-card overflow-hidden'
    : `absolute right-0 mt-1.5 w-64 rounded-lg shadow-xl border overflow-hidden ${
        isDark ? 'bg-[#18181b] border-white/12 text-white' : 'bg-white border-black/10 text-zinc-950'
      }`;
  const templateTitleCls = isPixel
    ? 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider px-group-title bg-[var(--px-muted)] border-b-2 border-[var(--px-ink)]'
    : `px-3 py-2 text-[11px] font-semibold uppercase tracking-wider border-b ${
        isDark ? 'border-white/10 bg-[#202024] text-white/72' : 'border-black/10 bg-zinc-50 text-zinc-600'
      }`;
  const templateItemCls = isPixel
    ? 'w-full text-left px-3 py-2 hover:bg-[var(--px-muted)]'
    : `w-full text-left px-3 py-2 transition ${
        isDark ? 'text-white hover:bg-white/10' : 'text-zinc-900 hover:bg-zinc-100'
      }`;
  const templateDescCls = isPixel
    ? 'text-[10px] mt-0.5 text-[var(--px-ink-soft)]'
    : `text-[10px] mt-0.5 leading-4 ${isDark ? 'text-white/62' : 'text-zinc-500'}`;

  const runningCls = isPixel
    ? isRunning
      ? 'bg-[var(--px-mint)] text-[var(--px-ink)] hover:bg-[var(--px-mint)]'
      : 'text-[var(--px-mint-deep)] hover:bg-[var(--px-mint)]/40'
    : isRunning
      ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25'
      : isDark
      ? 'text-emerald-300 hover:bg-emerald-500/15'
      : 'text-emerald-600 hover:bg-emerald-500/10';

  return (
    <div className="absolute top-3 right-3 z-20 flex items-start gap-2 select-none">
      <div className={containerCls}>
        {/* 批量运行 */}
        {isRunning ? (
          <button
            className={`${baseBtn} ${runningCls}`}
            onClick={onCancelRun}
            title={`停止批量运行 (${batchDone}/${batchTotal})`}
          >
            <Square size={14} fill="currentColor" />
            {batchTotal > 0 && (
              <span
                className={
                  isPixel
                    ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-yellow)] text-[var(--px-ink)] font-bold'
                    : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded bg-emerald-500 text-black'
                }
              >
                {batchDone}/{batchTotal}
              </span>
            )}
          </button>
        ) : (
          <button
            className={`${baseBtn} ${runningCls}`}
            onClick={onRunAll}
            title="批量运行画布（拓扑顺序串行可执行节点）"
          >
            <Play size={15} fill="currentColor" />
          </button>
        )}

        {/* 吸附开关 */}
        <button
          className={`${baseBtn} ${
            snapEnabled
              ? isPixel
                ? 'bg-[var(--px-yellow)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-amber-300 bg-amber-500/15'
                  : 'text-amber-600 bg-amber-500/10'
              : ''
          }`}
          onClick={onToggleSnap}
          title={snapEnabled ? '关闭网格吸附 + 对齐辅助线' : '开启网格吸附 + 对齐辅助线'}
        >
          <Magnet size={15} />
        </button>

        <div className={sep} />

        {/* Undo / Redo */}
        <button
          className={`${baseBtn} ${!canUndo ? disabledCls : ''}`}
          onClick={onUndo}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className={`${baseBtn} ${!canRedo ? disabledCls : ''}`}
          onClick={onRedo}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>

        <div className={sep} />

        {/* Copy / Paste / Delete */}
        <button
          className={`${baseBtn} ${selectedCount === 0 ? disabledCls : ''}`}
          onClick={onCopy}
          title={`复制选中节点 (Ctrl+C)${selectedCount > 0 ? ` · ${selectedCount} 个` : ''}`}
        >
          <Copy size={16} />
          {selectedCount > 0 && (
            <span
              className={
                isPixel
                  ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-pink)] text-[var(--px-ink)] font-bold'
                  : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded bg-amber-500 text-black'
              }
            >
              {selectedCount}
            </span>
          )}
        </button>
        <button
          className={`${baseBtn} ${clipboardCount === 0 ? disabledCls : ''}`}
          onClick={onPaste}
          title={`粘贴 (Ctrl+V)${clipboardCount > 0 ? ` · 剪贴板 ${clipboardCount} 个` : ''}`}
        >
          <ClipboardPaste size={16} />
        </button>
        <button
          className={`${baseBtn} ${selectedCount === 0 ? disabledCls : ''}`}
          onClick={onDelete}
          title="删除选中 (Delete)"
        >
          <Trash2 size={16} />
        </button>

        <div className={sep} />

        {/* Import / Export */}
        <button className={baseBtn} onClick={onImport} title="导入画布 JSON">
          <Upload size={16} />
        </button>
        <button className={baseBtn} onClick={onExport} title="导出画布 JSON">
          <Download size={16} />
        </button>

        <div className={sep} />

        {/* 模板 */}
        <div className="relative" ref={tplRef}>
          <button
            className={baseBtn}
            onClick={() => setTplOpen((v) => !v)}
            title="工作流模板"
          >
            <Sparkles size={16} />
          </button>
          {tplOpen && (
            <div
              className={templatePanelCls}
            >
              <div
                className={templateTitleCls}
              >
                选择模板插入画布
              </div>
              <div className="max-h-72 overflow-y-auto">
                {CANVAS_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      onApplyTemplate(tpl);
                      setTplOpen(false);
                    }}
                    className={templateItemCls}
                  >
                    <div className="text-xs font-medium">{tpl.name}</div>
                    <div className={templateDescCls}>
                      {tpl.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 帮助 */}
        <button
          className={baseBtn}
          onClick={() => setHelpOpen(true)}
          title="快捷键说明"
        >
          <HelpCircle size={16} />
        </button>

        {/* 终端 */}
        <button
          className={`${baseBtn} ${
            termOpen
              ? isPixel
                ? 'bg-[var(--px-mint)] text-[var(--px-ink)]'
                : isDark
                  ? 'text-emerald-300 bg-emerald-500/15'
                  : 'text-emerald-600 bg-emerald-500/10'
              : ''
          }`}
          onClick={toggleTerm}
          title={termOpen ? '关闭终端' : `打开终端${termUnread > 0 ? ` (${termUnread} 未读)` : ''}`}
        >
          <TerminalIcon size={15} />
          {!termOpen && termUnread > 0 && (
            <span
              className={
                isPixel
                  ? 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-pink)] text-[var(--px-ink)] font-bold'
                  : 'absolute -top-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded bg-rose-500 text-white'
              }
            >
              {termUnread}
            </span>
          )}
        </button>
      </div>

      {/* 帮助弹窗 */}
      {helpOpen && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center ${
            isPixel ? 'px-modal-mask' : 'bg-black/40'
          }`}
          onClick={() => setHelpOpen(false)}
        >
          <div
            className={
              isPixel
                ? 'w-[420px] px-card'
                : `w-[420px] rounded-lg shadow-2xl border ${
                    isDark ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-black/10 text-zinc-900'
                  }`
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                isPixel
                  ? 'border-[var(--px-ink)]'
                  : isDark
                    ? 'border-white/10'
                    : 'border-black/10'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <HelpCircle size={16} />
                快捷键说明
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className={
                  isPixel
                    ? 'px-btn px-btn--icon px-btn--ghost'
                    : `p-1 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`
                }
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-2 text-xs">
              {[
                ['Ctrl + Z', '撤销'],
                ['Ctrl + Shift + Z / Ctrl + Y', '重做'],
                ['Ctrl + C', '复制选中节点'],
                ['Ctrl + V', '粘贴节点(自动偏移)'],
                ['Ctrl + Shift + V', '连边粘贴(保留与原画布邻居的连接)'],
                ['Ctrl + D', '快速复制选中节点'],
                ['Delete / Backspace', '删除选中节点 / 连线'],
                ['Ctrl + A', '全选节点'],
                ['鼠标拖拽连接桩', '连接节点'],
                ['左键拖动空白', '平移画布'],
                ['Ctrl + 左键拖动', '框选多个节点'],
                ['右键点击节点 / 选区', '弹出菜单(组执行 / 打组)'],
                ['Ctrl + G', '选中多个节点后快捷打组'],
                ['打组后右上角 ▶', '执行组内所有节点'],
                ['打组后双击标题', '重命名节点组'],
                ['滚轮 / 触控板', '缩放画布'],
                ['空格 + 拖拽', '平移画布(备选)'],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className={`flex items-center justify-between px-3 py-1.5 rounded ${
                    isPixel
                      ? 'bg-[var(--px-muted)] border-2 border-[var(--px-ink)] rounded-[10px]'
                      : isDark
                        ? 'bg-white/5'
                        : 'bg-black/5'
                  }`}
                >
                  <kbd
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      isPixel
                        ? 'bg-[var(--px-surface)] border-2 border-[var(--px-ink)] text-[var(--px-ink)]'
                        : isDark
                          ? 'bg-white/10'
                          : 'bg-white border border-black/10'
                    }`}
                  >
                    {k}
                  </kbd>
                  <span
                    className={
                      isPixel
                        ? 'text-[var(--px-ink-soft)]'
                        : isDark
                          ? 'text-white/70'
                          : 'text-zinc-600'
                    }
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
