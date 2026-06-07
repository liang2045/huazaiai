import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * PortraitMetadataNode - 肖像元数据
 * 角色档案:姓名/年龄/性别/外貌/服饰/性格/背景
 * 输出 prompt(英文模板),供下游 ImageNode 引用
 */
const COLOR = '#818cf8';

interface PortraitMeta {
  name?: string;
  age?: string;
  gender?: string;
  appearance?: string;
  outfit?: string;
  personality?: string;
  background?: string;
}

const FIELDS: { key: keyof PortraitMeta; label: string; placeholder: string }[] = [
  { key: 'name', label: '姓名', placeholder: '如:角色 iMade' },
  { key: 'age', label: '年龄', placeholder: '如:20s, 中年' },
  { key: 'gender', label: '性别', placeholder: '男 / 女 / 其他' },
  { key: 'appearance', label: '外貌', placeholder: '发型、眼睛、肤色...' },
  { key: 'outfit', label: '服饰', placeholder: '上衣、裤装、配饰...' },
  { key: 'personality', label: '性格', placeholder: '开朗、内向、神秘...' },
  { key: 'background', label: '背景', placeholder: '设定、职业、故事...' },
];

const buildPrompt = (m: PortraitMeta): string => {
  const parts: string[] = [];
  if (m.name) parts.push(`Character: ${m.name}`);
  if (m.gender) parts.push(`Gender: ${m.gender}`);
  if (m.age) parts.push(`Age: ${m.age}`);
  if (m.appearance) parts.push(`Appearance: ${m.appearance}`);
  if (m.outfit) parts.push(`Outfit: ${m.outfit}`);
  if (m.personality) parts.push(`Personality: ${m.personality}`);
  if (m.background) parts.push(`Background: ${m.background}`);
  return parts.join(', ');
};

const PortraitMetadataNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = (p.data as PortraitMeta) || {};

  const onField = useCallback(
    (key: keyof PortraitMeta, val: string) => {
      const next = { ...d, [key]: val };
      update({ ...next, prompt: buildPrompt(next) });
    },
    [update, d]
  );

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 280,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(129,140,248,.2)` : undefined,
      }}
    >
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(129,140,248,.2)', color: '#c7d2fe', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <FileText size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">肖像元数据</div>
          <div className="text-[10px] text-white/40">{d.name || '未命名'}</div>
        </div>
      </div>

      <div className="p-2.5 space-y-1.5 max-h-80 overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="text-[10px] text-white/50 block mb-0.5">{f.label}</label>
            <input
              value={d[f.key] || ''}
              onChange={(e) => onField(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder-white/30 outline-none focus:border-white/30"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default memo(PortraitMetadataNode);
