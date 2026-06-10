import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Handle, NodeResizeControl, Position, useViewport, type NodeProps, type ResizeParams } from '@xyflow/react';
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
const clampPercent = (value: unknown, fallback = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};
const colorWithAlpha = (color: string, alphaPercent: unknown = 100) => {
  const alpha = clampPercent(alphaPercent) / 100;
  const value = color || '#111111';
  const short = /^#([0-9a-f]{3})$/i.exec(value.trim());
  const long = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!short && !long) return value;
  const raw = short ? short[1].split('').map((ch) => ch + ch).join('') : long![1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
};
type GradientStop = { id?: string; color?: string; alpha?: number; position?: number };
type NormalizedGradientStop = { color: string; alpha: number; position: number };
const makeBackground = (d: any) => {
  if (d?.backgroundMode === 'gradient') {
    const solid = d?.backgroundColor || '#ffffff';
    const fallback = [
      { color: d?.backgroundGradientFrom || solid, alpha: clampPercent(d?.backgroundGradientFromAlpha ?? 100), position: 0 },
      { color: d?.backgroundGradientMiddle || d?.backgroundGradientFrom || solid, alpha: clampPercent(d?.backgroundGradientMiddleAlpha ?? 100), position: 50 },
      { color: d?.backgroundGradientTo || '#dbeafe', alpha: clampPercent(d?.backgroundGradientToAlpha ?? 100), position: 100 },
    ];
    const raw = Array.isArray(d?.backgroundGradientStops) ? d.backgroundGradientStops : fallback;
    const stops = raw
      .map((stop: GradientStop, index: number) => ({
        color: String(stop?.color || fallback[index]?.color || solid),
        alpha: clampPercent(stop?.alpha ?? fallback[index]?.alpha ?? 100),
        position: clampPercent(stop?.position ?? fallback[index]?.position ?? (index === 0 ? 0 : 100)),
      } satisfies NormalizedGradientStop))
      .sort((a: NormalizedGradientStop, b: NormalizedGradientStop) => a.position - b.position);
    const usable: NormalizedGradientStop[] = stops.length >= 2 ? stops : fallback;
    const angle = Number(d?.backgroundGradientAngle ?? 90);
    return `linear-gradient(${Number.isFinite(angle) ? angle : 90}deg, ${usable.map((stop: NormalizedGradientStop) => `${colorWithAlpha(stop.color, stop.alpha)} ${stop.position}%`).join(', ')})`;
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
  const { zoom: viewportZoom } = useViewport();
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
  const sizeLabel = `${frameSize.w}×${frameSize.h}`;
  const displayName = !frameName || /^画框$|^\d+\s*[×x]\s*\d+$/i.test(frameName)
    ? sizeLabel
    : `${frameName} · ${sizeLabel}`;
  const stableOverlayZoom = Math.max(viewportZoom || 1, 0.01);
  const stableOverlayScale = Math.min(24, Math.max(1, 1 / stableOverlayZoom));

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
    update({ frameW: next.w, frameH: next.h, resolutionW: next.w, resolutionH: next.h });
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
        className="absolute left-0 z-30 flex h-7 max-w-full items-center gap-1.5 text-[13px] font-medium leading-[18px]"
        title="长按名称可移动画框，双击可修改名称"
        style={{
          top: `${-30 / stableOverlayZoom}px`,
          transform: `scale(${stableOverlayScale})`,
          transformOrigin: 'top left',
        }}
      >
        <Frame size={14} className="shrink-0 text-zinc-500 dark:text-white/65" />
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
            className="max-w-[260px] truncate text-left text-[13px] leading-[18px] text-zinc-700 dark:text-white/85"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftName(frameName);
              setEditingName(true);
            }}
          >
            {displayName}
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
