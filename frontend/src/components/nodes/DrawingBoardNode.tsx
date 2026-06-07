import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Handle, NodeResizeControl, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Frame } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';

const COLOR = '#d7ccb3';
const MIN_W = 48;
const MIN_H = 48;
// 真实分辨率图像会按 naturalWidth/naturalHeight 显示，默认画框需要给 2K/4K 图像留足编排空间。
// 在上一版 12000×8000 基础上再扩大 2 倍。
const DEFAULT_W = 800;
const DEFAULT_H = 800;
const LEGACY_DEFAULT_W = 840;
const LEGACY_DEFAULT_H = 560;
const PREVIOUS_DEFAULT_W = 1200;
const PREVIOUS_DEFAULT_H = 800;
const LARGE_DEFAULT_W = 12000;
const LARGE_DEFAULT_H = 8000;
const RESIZE_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const makeBackground = (d: any) => {
  if (d?.backgroundMode === 'gradient') {
    const from = d?.backgroundGradientFrom || '#ffffff';
    const to = d?.backgroundGradientTo || '#dbeafe';
    const angle = Number(d?.backgroundGradientAngle ?? 90);
    return `linear-gradient(${Number.isFinite(angle) ? angle : 90}deg, ${from}, ${to})`;
  }
  return d?.backgroundColor || 'rgba(128,128,128,.12)';
};

const shouldUpgradeDefaultFrame = (w: number, h: number) =>
  !w ||
  !h ||
  (w === LEGACY_DEFAULT_W && h === LEGACY_DEFAULT_H) ||
  (w === PREVIOUS_DEFAULT_W && h === PREVIOUS_DEFAULT_H) ||
  (w === LARGE_DEFAULT_W && h === LARGE_DEFAULT_H);

const DrawingBoardNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const { theme, style } = useThemeStore();
  const handleThemeClass = style === 'pixel'
    ? `imade-frame-resize-handle--pixel-${theme === 'dark' ? 'dark' : 'light'}`
    : `imade-frame-resize-handle--tech-${theme === 'dark' ? 'dark' : 'light'}`;
  const d = p.data as any;
  const frameName = String(d?.name || '画框');
  const rawFrameW = Number(d?.frameW || 0);
  const rawFrameH = Number(d?.frameH || 0);
  const initialFrame = shouldUpgradeDefaultFrame(rawFrameW, rawFrameH)
    ? { w: DEFAULT_W, h: DEFAULT_H }
    : { w: Math.max(MIN_W, rawFrameW), h: Math.max(MIN_H, rawFrameH) };
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(frameName);
  const [frameSize, setFrameSize] = useState(initialFrame);

  useEffect(() => {
    const next = shouldUpgradeDefaultFrame(rawFrameW, rawFrameH)
      ? { w: DEFAULT_W, h: DEFAULT_H }
      : { w: Math.max(MIN_W, rawFrameW), h: Math.max(MIN_H, rawFrameH) };
    if (next.w !== frameSize.w || next.h !== frameSize.h) {
      setFrameSize(next);
    }
    if (shouldUpgradeDefaultFrame(rawFrameW, rawFrameH)) {
      update({ frameW: DEFAULT_W, frameH: DEFAULT_H, resolutionW: DEFAULT_W, resolutionH: DEFAULT_H });
    }
  }, [rawFrameW, rawFrameH, frameSize.w, frameSize.h, update]);

  const handleResize = (_e: unknown, params: ResizeParams) => {
    const next = {
      w: Math.max(MIN_W, Math.round(params.width)),
      h: Math.max(MIN_H, Math.round(params.height)),
    };
    setFrameSize(next);
    update({ frameW: next.w, frameH: next.h });
  };

  const commitName = () => {
    const next = draftName.trim() || '画框';
    update({ name: next });
    setDraftName(next);
    setEditingName(false);
  };

  return (
    <div
      className="imade-frame-node relative rounded-none bg-transparent"
      style={{
        width: frameSize.w,
        height: frameSize.h,
        overflow: 'visible',
        border: 0,
        outline: 0,
        boxShadow: 'none',
      }}
    >
      <div
        className="absolute left-0 top-[-28px] z-30 flex h-6 max-w-full items-center gap-1.5 text-[11px] font-medium"
        title="长按名称可移动画框，双击可修改名称"
      >
        <Frame size={12} className="shrink-0 text-zinc-500 dark:text-white/55" />
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setDraftName(frameName);
                setEditingName(false);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nowheel h-6 w-32 rounded-none border border-sky-400 bg-white px-1 text-[11px] text-zinc-950 outline-none dark:bg-zinc-950 dark:text-white"
          />
        ) : (
          <button
            type="button"
            className="max-w-[220px] truncate text-left text-zinc-700 dark:text-white/75"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftName(frameName);
              setEditingName(true);
            }}
          >
            {frameName}
          </button>
        )}
      </div>

      <div
        className="imade-frame-surface absolute inset-0 rounded-none"
        style={{
          background: makeBackground(d),
          border: p.selected ? `1px solid ${COLOR}` : '1px solid rgba(128,128,128,.34)',
          outline: p.selected ? `1px solid ${COLOR}` : 'none',
          outlineOffset: 0,
          boxShadow: 'none',
          overflow: 'hidden',
        }}
      />

      {p.selected &&
        RESIZE_POSITIONS.map((position) => (
          <NodeResizeControl
            key={position}
            position={position}
            keepAspectRatio={false}
            minWidth={MIN_W}
            minHeight={MIN_H}
            onResize={handleResize}
            className={`imade-frame-resize-handle imade-frame-resize-handle--${position} ${handleThemeClass}`}
            style={{ ['--imade-resize-accent' as any]: COLOR } as CSSProperties}
          />
        ))}

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: COLOR, border: 0, opacity: p.selected ? 1 : 0, pointerEvents: p.selected ? 'all' : 'none' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: COLOR, border: 0, opacity: p.selected ? 1 : 0, pointerEvents: p.selected ? 'all' : 'none' }}
      />
    </div>
  );
};

export default memo(DrawingBoardNode);
