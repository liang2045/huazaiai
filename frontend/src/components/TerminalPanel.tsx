import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal as TerminalIcon, X, Trash2, Filter } from 'lucide-react';
import { useLogStore, type LogLevel } from '../stores/logs';
import { useThemeStore } from '../stores/theme';

const LEVELS: LogLevel[] = ['info', 'success', 'warn', 'error', 'debug'];

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export default function TerminalPanel() {
  const open = useLogStore((s) => s.open);
  const entries = useLogStore((s) => s.entries);
  const setOpen = useLogStore((s) => s.setOpen);
  const clear = useLogStore((s) => s.clear);
  const { theme, style } = useThemeStore();
  const isPixel = style === 'pixel';
  const isDark = theme === 'dark';

  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.level === filter)),
    [entries, filter],
  );

  // 自动滚动到底部
  useEffect(() => {
    if (!open || !autoScroll) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered, open, autoScroll]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  // ============ 像素/糖果风 ============
  if (isPixel) {
    return (
      <div className="absolute left-3 right-3 bottom-3 z-30 select-none pointer-events-auto">
        <div
          className="px-card overflow-hidden flex flex-col"
          style={{ height: 'min(48vh, 420px)' }}
        >
          {/* 顶部条 */}
          <div className="flex items-center justify-between px-3 py-2 bg-[var(--px-mint)] border-b-2 border-[var(--px-ink)]">
            <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--px-ink)]">
              <TerminalIcon size={14} />
              终端 / Logs
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-yellow)]">
                {entries.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* 筛选 */}
              <div className="flex items-center gap-1 mr-2">
                <Filter size={11} className="text-[var(--px-ink)]" />
                {(['all', ...LEVELS] as Array<LogLevel | 'all'>).map((lv) => (
                  <button
                    key={lv}
                    onClick={() => setFilter(lv)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border-2 border-[var(--px-ink)] font-bold ${
                      filter === lv
                        ? lv === 'error'
                          ? 'bg-[var(--px-pink)] text-[var(--px-ink)]'
                          : lv === 'success'
                            ? 'bg-[var(--px-mint-deep)] text-white'
                            : lv === 'warn'
                              ? 'bg-[var(--px-yellow)] text-[var(--px-ink)]'
                              : 'bg-[var(--px-ink)] text-[var(--px-surface)]'
                        : 'bg-[var(--px-surface)] text-[var(--px-ink-soft)]'
                    }`}
                  >
                    {lv === 'all' ? '全部' : lv}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-[10px] text-[var(--px-ink-soft)] mr-2">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                跟随
              </label>
              <button
                onClick={clear}
                className="px-btn px-btn--icon px-btn--ghost"
                title="清空日志"
              >
                <Trash2 size={12} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-btn px-btn--icon px-btn--ghost"
                title="关闭终端 (Esc)"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          {/* 日志体 */}
          <div
            ref={bodyRef}
            className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-[1.5] bg-[var(--px-surface)]"
            style={{ wordBreak: 'break-all' }}
          >
            {filtered.length === 0 ? (
              <div className="text-center text-[var(--px-ink-soft)] py-6">暂无日志</div>
            ) : (
              filtered.map((e) => (
                <div key={e.id} className="flex gap-2 px-1 py-0.5 hover:bg-[var(--px-muted)] rounded">
                  <span className="text-[var(--px-ink-soft)] shrink-0">{fmtTime(e.ts)}</span>
                  <span
                    className={`shrink-0 px-1 rounded text-[10px] font-bold uppercase ${
                      e.level === 'error'
                        ? 'bg-[var(--px-pink)] text-[var(--px-ink)]'
                        : e.level === 'success'
                          ? 'bg-[var(--px-mint-deep)] text-white'
                          : e.level === 'warn'
                            ? 'bg-[var(--px-yellow)] text-[var(--px-ink)]'
                            : e.level === 'debug'
                              ? 'bg-[var(--px-muted)] text-[var(--px-ink-soft)]'
                              : 'bg-[var(--px-ink)] text-[var(--px-surface)]'
                    }`}
                  >
                    {e.level}
                  </span>
                  {e.source && (
                    <span className="shrink-0 text-[var(--px-mint-deep)]">[{e.source}]</span>
                  )}
                  <span className="text-[var(--px-ink)] whitespace-pre-wrap">{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============ 科技风(默认) ============
  const baseBg = isDark ? 'bg-zinc-950/95 border-white/10' : 'bg-white/95 border-black/10';
  const headBg = isDark ? 'bg-zinc-900/90 border-white/10' : 'bg-zinc-100 border-black/10';
  const textMuted = isDark ? 'text-zinc-400' : 'text-zinc-500';
  const textNormal = isDark ? 'text-zinc-100' : 'text-zinc-800';
  return (
    <div className="absolute left-3 right-3 bottom-3 z-30 select-none pointer-events-auto">
      <div
        className={`flex flex-col rounded-lg shadow-2xl backdrop-blur border ${baseBg} overflow-hidden`}
        style={{ height: 'min(48vh, 420px)' }}
      >
        <div className={`flex items-center justify-between px-3 py-2 border-b ${headBg}`}>
          <div className={`flex items-center gap-2 text-xs font-semibold ${textNormal}`}>
            <TerminalIcon size={13} className="text-emerald-400" />
            <span>终端 · Logs</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
              {entries.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 mr-2">
              <Filter size={11} className={textMuted} />
              {(['all', ...LEVELS] as Array<LogLevel | 'all'>).map((lv) => (
                <button
                  key={lv}
                  onClick={() => setFilter(lv)}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    filter === lv
                      ? lv === 'error'
                        ? 'bg-rose-500/20 text-rose-300'
                        : lv === 'success'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : lv === 'warn'
                            ? 'bg-amber-500/20 text-amber-300'
                            : lv === 'debug'
                              ? 'bg-purple-500/20 text-purple-300'
                              : isDark
                                ? 'bg-white/15 text-white'
                                : 'bg-zinc-800 text-white'
                      : isDark
                        ? 'text-zinc-400 hover:bg-white/10'
                        : 'text-zinc-500 hover:bg-black/10'
                  }`}
                >
                  {lv === 'all' ? '全部' : lv}
                </button>
              ))}
            </div>
            <label className={`flex items-center gap-1 text-[10px] ${textMuted} mr-2`}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              跟随
            </label>
            <button
              onClick={clear}
              className={`p-1 rounded ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-black/10 text-zinc-600'}`}
              title="清空日志"
            >
              <Trash2 size={12} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className={`p-1 rounded ${isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-black/10 text-zinc-600'}`}
              title="关闭终端 (Esc)"
            >
              <X size={13} />
            </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          className={`flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-[1.6] ${
            isDark ? 'bg-black/40 text-zinc-200' : 'bg-zinc-50 text-zinc-800'
          }`}
          style={{ wordBreak: 'break-all' }}
        >
          {filtered.length === 0 ? (
            <div className={`text-center py-6 ${textMuted}`}>暂无日志</div>
          ) : (
            filtered.map((e) => (
              <div
                key={e.id}
                className={`flex gap-2 px-1 py-0.5 rounded ${
                  isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'
                }`}
              >
                <span className={`shrink-0 ${textMuted}`}>{fmtTime(e.ts)}</span>
                <span
                  className={`shrink-0 px-1 rounded text-[10px] font-bold uppercase ${
                    e.level === 'error'
                      ? 'bg-rose-500/25 text-rose-300'
                      : e.level === 'success'
                        ? 'bg-emerald-500/25 text-emerald-300'
                        : e.level === 'warn'
                          ? 'bg-amber-500/25 text-amber-300'
                          : e.level === 'debug'
                            ? 'bg-purple-500/25 text-purple-300'
                            : 'bg-sky-500/25 text-sky-300'
                  }`}
                >
                  {e.level}
                </span>
                {e.source && <span className="shrink-0 text-emerald-400">[{e.source}]</span>}
                <span className="whitespace-pre-wrap">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
