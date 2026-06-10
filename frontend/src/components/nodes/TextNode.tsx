import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';

const DEFAULT_FONT = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const PLACEHOLDER_TEXT = '输入文字';

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
const makeGradientCss = (d: any, solidColor: string) => {
  const fallback = [
    { color: d?.gradientFrom || solidColor, alpha: clampPercent(d?.gradientFromAlpha ?? 100), position: 0 },
    { color: d?.gradientMiddle || d?.gradientFrom || solidColor, alpha: clampPercent(d?.gradientMiddleAlpha ?? 100), position: 50 },
    { color: d?.gradientTo || '#ffffff', alpha: clampPercent(d?.gradientToAlpha ?? 100), position: 100 },
  ];
  const raw = Array.isArray(d?.gradientStops) ? d.gradientStops : fallback;
  const stops = raw
    .map((stop: GradientStop, index: number) => ({
      color: String(stop?.color || fallback[index]?.color || solidColor),
      alpha: clampPercent(stop?.alpha ?? fallback[index]?.alpha ?? 100),
      position: clampPercent(stop?.position ?? fallback[index]?.position ?? (index === 0 ? 0 : 100)),
    } satisfies NormalizedGradientStop))
    .sort((a: NormalizedGradientStop, b: NormalizedGradientStop) => a.position - b.position);
  const usable: NormalizedGradientStop[] = stops.length >= 2 ? stops : fallback;
  return `linear-gradient(${Number(d?.gradientAngle ?? 90)}deg, ${usable.map((stop: NormalizedGradientStop) => `${colorWithAlpha(stop.color, stop.alpha)} ${stop.position}%`).join(', ')})`;
};

function measureTextBox(params: {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}) {
  const value = params.text.length > 0 ? params.text : PLACEHOLDER_TEXT;
  const lines = value.split(/\r?\n/);
  const fontSize = Math.max(8, params.fontSize);
  const linePx = Math.max(fontSize, fontSize * params.lineHeight);
  let maxWidth = 0;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${params.fontWeight} ${fontSize}px ${params.fontFamily}`;
      for (const line of lines) {
        const raw = line.length > 0 ? line : ' ';
        const spacing = Math.max(0, raw.length - 1) * params.letterSpacing;
        maxWidth = Math.max(maxWidth, ctx.measureText(raw).width + spacing);
      }
    }
  }

  if (!maxWidth) {
    maxWidth = Math.max(...lines.map((line) => Math.max(1, line.length) * fontSize * 0.58));
  }

  return {
    w: Math.max(12, Math.ceil(maxWidth + 2)),
    h: Math.max(12, Math.ceil(linePx * Math.max(1, lines.length) + 2)),
  };
}

const TextNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const d = data as any;
  const text = (d?.prompt as string) || '';
  const fontFamily = d?.fontFamily || DEFAULT_FONT;
  const fontWeight = Number(d?.fontWeight || 600);
  const fontSize = Number(d?.fontSize || 48);
  const lineHeight = Number(d?.lineHeight || 1.12);
  const letterSpacing = Number(d?.letterSpacing || 0);
  const color = d?.color || (isDark ? '#ffffff' : '#111111');
  const colorMode = d?.colorMode === 'gradient' ? 'gradient' : 'solid';
  const gradientText = colorMode === 'gradient'
    ? makeGradientCss(d, color)
    : '';
  const textAlign = (d?.textAlign || 'left') as CSSProperties['textAlign'];
  const [editing, setEditing] = useState(false);
  const measuredSize = useMemo(
    () => measureTextBox({ text, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing }),
    [text, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing]
  );
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({
    w: Math.max(12, Number(d?.textW || measuredSize.w)),
    h: Math.max(12, Number(d?.textH || measuredSize.h)),
  }));
  const hasText = text.trim().length > 0;
  const showEditor = selected && editing;

  useEffect(() => {
    setSize(measuredSize);
    const currentW = Number(d?.textW || 0);
    const currentH = Number(d?.textH || 0);
    if (Math.abs(currentW - measuredSize.w) > 1 || Math.abs(currentH - measuredSize.h) > 1) {
      update({ textW: measuredSize.w, textH: measuredSize.h });
    }
  }, [measuredSize.w, measuredSize.h, d?.textW, d?.textH, update]);

  const textStyle: CSSProperties = {
    fontFamily,
    fontWeight,
    fontSize,
    lineHeight,
    letterSpacing,
    color,
    WebkitTextFillColor: colorMode === 'gradient' ? 'transparent' : color,
    ...(colorMode === 'gradient'
      ? {
          backgroundImage: gradientText,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
        }
      : null),
    textAlign,
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    margin: 0,
  };

  return (
    <div
      className="imade-text-layer relative bg-transparent"
      style={{
        width: size.w,
        height: size.h,
        border: 0,
        borderRadius: 0,
        boxShadow: 'none',
        outline: 0,
        overflow: 'visible',
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {selected && (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              border: '1px solid #38bdf8',
              borderRadius: 0,
              boxShadow: 'none',
              zIndex: 2,
            }}
          />
        </>
      )}

      {showEditor ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => update({ prompt: e.target.value })}
          onBlur={() => setEditing(false)}
          placeholder={PLACEHOLDER_TEXT}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="nodrag nowheel absolute inset-0 resize-none bg-transparent p-0 outline-none"
          style={{
            ...textStyle,
            backgroundImage: 'none',
            WebkitBackgroundClip: 'initial',
            backgroundClip: 'initial',
            WebkitTextFillColor: color,
            width: '100%',
            height: '100%',
            border: 0,
            borderRadius: 0,
            boxShadow: 'none',
            overflow: 'hidden',
          }}
        />
      ) : (
        <div
          className="absolute inset-0 bg-transparent"
          style={{
            ...textStyle,
            color: hasText ? color : (isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)'),
            WebkitTextFillColor: hasText
              ? (colorMode === 'gradient' ? 'transparent' : color)
              : (isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)'),
            overflow: 'hidden',
          }}
        >
          {hasText ? text : PLACEHOLDER_TEXT}
        </div>
      )}
    </div>
  );
};

export default memo(TextNode);
