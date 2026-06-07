import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import * as Icons from 'lucide-react';
import { getNodeMeta } from '../../config/nodeRegistry';

// 节点配色表(避免 Tailwind 动态 class 不生效)
const COLOR_MAP: Record<string, { bg: string; text: string; ring: string }> = {
  sky: { bg: 'rgba(14,165,233,.18)', text: '#7dd3fc', ring: 'rgba(14,165,233,.4)' },
  amber: { bg: 'rgba(245,158,11,.2)', text: '#fcd34d', ring: 'rgba(245,158,11,.45)' },
  rose: { bg: 'rgba(244,63,94,.2)', text: '#fda4af', ring: 'rgba(244,63,94,.45)' },
  fuchsia: { bg: 'rgba(217,70,239,.2)', text: '#f0abfc', ring: 'rgba(217,70,239,.45)' },
  violet: { bg: 'rgba(139,92,246,.2)', text: '#c4b5fd', ring: 'rgba(139,92,246,.45)' },
  emerald: { bg: 'rgba(16,185,129,.2)', text: '#6ee7b7', ring: 'rgba(16,185,129,.45)' },
  cyan: { bg: 'rgba(6,182,212,.2)', text: '#67e8f9', ring: 'rgba(6,182,212,.45)' },
  indigo: { bg: 'rgba(99,102,241,.2)', text: '#a5b4fc', ring: 'rgba(99,102,241,.45)' },
  orange: { bg: 'rgba(249,115,22,.2)', text: '#fdba74', ring: 'rgba(249,115,22,.45)' },
  pink: { bg: 'rgba(236,72,153,.2)', text: '#f9a8d4', ring: 'rgba(236,72,153,.45)' },
  slate: { bg: 'rgba(100,116,139,.25)', text: '#cbd5e1', ring: 'rgba(100,116,139,.5)' },
};

/**
 * 通用占位节点
 * Phase 1: 仅展示节点类型 + 元数据(为 Phase 2/3 真正接入业务功能做铺垫)
 */
const PlaceholderNode = ({ data, type, selected }: NodeProps) => {
  const meta = getNodeMeta(type as string);
  const label = (data as any)?.label || meta?.label || type;
  const description = meta?.description || '';
  const iconName = meta?.icon || 'Box';
  // 动态查找 lucide-react 图标
  const IconComp = (Icons as any)[iconName] || Icons.Box;
  const colorKey = meta?.color || 'slate';
  const color = COLOR_MAP[colorKey] || COLOR_MAP.slate;

  return (
    <div
      className={`relative rounded-xl border-2 transition-all min-w-[180px] ${
        selected
          ? 'border-white shadow-2xl shadow-white/20'
          : 'border-white/20 hover:border-white/40'
      }`}
      style={{
        background: 'rgba(20, 20, 22, 0.92)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-white/60 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-white/60 !border-0" />

      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: color.bg, color: color.text, boxShadow: `inset 0 0 0 1px ${color.ring}` }}
        >
          <IconComp size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{label}</div>
          <div className="text-[10px] text-white/40 truncate">{type}</div>
        </div>
      </div>

      {/* 内容描述 */}
      <div className="px-3 py-2">
        <p className="text-xs text-white/60 leading-relaxed">{description}</p>
        <div className="mt-2 text-[10px] text-white/30">
          Phase 1 占位 · 业务逻辑将于 Phase 2/3 接入
        </div>
      </div>
    </div>
  );
};

export default memo(PlaceholderNode);
