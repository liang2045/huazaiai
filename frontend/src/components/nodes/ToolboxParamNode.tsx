import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Edit3, Film, Plus, Save, SlidersHorizontal, Sparkles, Wand2 } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

interface Preset {
  id: string;
  label: string;
  text: string;
}

const CINEMATIC_PRESETS: Preset[] = [
  { id: 'soft-light', label: '柔光', text: 'soft cinematic lighting, golden hour, gentle shadows' },
  { id: 'noir', label: '黑色电影', text: 'film noir style, high contrast, hard shadows, monochrome' },
  { id: 'dreamy', label: '梦幻', text: 'dreamy soft focus, pastel palette, ethereal glow' },
  { id: 'epic', label: '史诗', text: 'epic cinematic shot, dramatic lighting, ultra wide, IMAX' },
  { id: 'vintage', label: '复古胶片', text: 'vintage 35mm film grain, faded colors, kodak portra' },
  { id: 'cyberpunk', label: '赛博朋克', text: 'cyberpunk neon city, rain reflections, blade runner mood' },
];

const MOTION_PRESETS: Preset[] = [
  { id: 'static', label: '静止', text: 'static shot, locked camera, no movement' },
  { id: 'pan-l', label: '左摇', text: 'slow pan to the left, smooth camera movement' },
  { id: 'pan-r', label: '右摇', text: 'slow pan to the right, smooth camera movement' },
  { id: 'zoom-in', label: '推进', text: 'slow zoom in, gradually closer to subject' },
  { id: 'zoom-out', label: '拉远', text: 'slow zoom out, revealing wider scene' },
  { id: 'orbit', label: '环绕', text: 'orbit around the subject, 360 degree shot' },
  { id: 'dolly', label: '推轨', text: 'dolly forward through the scene' },
  { id: 'aerial', label: '航拍', text: 'aerial drone shot, descending from above' },
];

const DEFAULT_CUSTOM_TOOLS: Preset[] = [
  { id: 'custom-1', label: '自定义工具', text: 'custom prompt' },
];

const CUSTOM_TOOLS_STORAGE_KEY = 'imade.customTools.v1';

function normalizeCustomTools(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      id: typeof item?.id === 'string' && item.id ? item.id : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : 'Custom Tool',
      text: typeof item?.text === 'string' ? item.text : '',
    }))
    .filter((item) => item.id && item.label);
}

function loadSavedCustomTools(): Preset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOOLS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeCustomTools(JSON.parse(raw));
  } catch {
    return [];
  }
}

function saveCustomTools(tools: Preset[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CUSTOM_TOOLS_STORAGE_KEY, JSON.stringify(tools));
  window.dispatchEvent(new Event('imade:custom-tools-updated'));
}


const ToolboxParamNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = p.data as any;
  const kind: 'cinematic' | 'video-motion' | 'custom-tool' | string = d?.kind || 'cinematic';
  const selectedId: string | undefined = d?.presetId;
  const prompt: string = d?.prompt || '';
  const [savedCustomTools, setSavedCustomTools] = useState<Preset[]>(() => loadSavedCustomTools());
  const nodeCustomTools = useMemo(() => normalizeCustomTools(d?.customTools), [d?.customTools]);
  const customTools: Preset[] =
    savedCustomTools.length > 0 ? savedCustomTools : nodeCustomTools.length > 0 ? nodeCustomTools : DEFAULT_CUSTOM_TOOLS;
  const editingId: string | undefined = d?.editingToolId;
  const editorOpen = d?.editorOpen === true;
  const draftLabel: string = d?.draftLabel ?? '';
  const draftPrompt: string = d?.draftPrompt ?? '';

  useEffect(() => {
    const handleToolsUpdated = () => setSavedCustomTools(loadSavedCustomTools());
    window.addEventListener('imade:custom-tools-updated', handleToolsUpdated);
    return () => window.removeEventListener('imade:custom-tools-updated', handleToolsUpdated);
  }, []);

  useEffect(() => {
    if (kind !== 'custom-tool') return;
    if (savedCustomTools.length > 0 || nodeCustomTools.length === 0) return;
    saveCustomTools(nodeCustomTools);
    setSavedCustomTools(nodeCustomTools);
  }, [kind, nodeCustomTools, savedCustomTools.length]);

  const meta = useMemo(() => {
    if (kind === 'video-motion') {
      return {
        title: '视频运镜',
        subtitle: '点击按钮输出运镜提示词',
        icon: <Film size={13} />,
        presets: MOTION_PRESETS,
        color: '#a78bfa',
        bg: 'rgba(167,139,250,.2)',
        text: '#ddd6fe',
        shadow: 'rgba(167,139,250,.2)',
        chipActive: 'bg-violet-500/30 text-violet-100 border-violet-400/40',
      };
    }
    if (kind === 'custom-tool') {
      return {
        title: '自定义工具',
        subtitle: '按钮和提示词',
        icon: <SlidersHorizontal size={13} />,
        presets: customTools,
        color: '#d4d4d0',
        bg: 'rgba(255,255,255,.08)',
        text: '#f4f3ee',
        shadow: 'rgba(0,0,0,.25)',
        chipActive: 'bg-white/15 text-white border-white/25',
      };
    }
    return {
      title: '电影感预设',
      subtitle: '点击按钮输出风格提示词',
      icon: <Wand2 size={13} />,
      presets: CINEMATIC_PRESETS,
      color: '#f472b6',
      bg: 'rgba(244,114,182,.2)',
      text: '#fbcfe8',
      shadow: 'rgba(244,114,182,.2)',
      chipActive: 'bg-pink-500/30 text-pink-100 border-pink-400/40',
    };
  }, [customTools, kind]);

  const handleSelect = (preset: Preset) => {
    update({ presetId: preset.id, prompt: preset.text });
  };

  const openEditor = (tool?: Preset) => {
    const target = tool || customTools.find((item) => item.id === selectedId) || customTools[0];
    update({
      customTools,
      editorOpen: true,
      editingToolId: target?.id,
      draftLabel: target?.label || '',
      draftPrompt: target?.text || '',
    });
  };

  const handleAddCustom = () => {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    update({
      customTools,
      editorOpen: true,
      editingToolId: id,
      draftLabel: `工具 ${customTools.length + 1}`,
      draftPrompt: '',
      presetId: id,
      prompt: '',
    });
  };

  const handleSaveCustom = () => {
    const id = editingId || selectedId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const label = draftLabel.trim() || '自定义工具';
    const text = draftPrompt.trim();
    const exists = customTools.some((tool) => tool.id === id);
    const nextTools = exists
      ? customTools.map((tool) => (tool.id === id ? { ...tool, label, text } : tool))
      : [...customTools, { id, label, text }];
    saveCustomTools(nextTools);
    setSavedCustomTools(nextTools);
    update({
      customTools: nextTools,
      editorOpen: false,
      editingToolId: undefined,
      draftLabel: label,
      draftPrompt: text,
      presetId: id,
      prompt: text,
    });
    window.setTimeout(() => window.dispatchEvent(new Event('imade:force-save')), 50);
  };

  const selectedLabel =
    kind === 'custom-tool'
      ? customTools.find((tool) => tool.id === selectedId)?.label || '提示词'
      : '提示词';

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: kind === 'custom-tool' ? 270 : 240,
        borderColor: p.selected ? meta.color : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${meta.color}, 0 16px 32px ${meta.shadow}` : undefined,
      }}
    >
      <Handle type="source" position={Position.Right} style={{ background: meta.color, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: meta.bg, color: meta.text, boxShadow: `inset 0 0 0 1px ${meta.color}` }}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{meta.title}</div>
          <div className="text-[10px] text-white/40 truncate">{meta.subtitle}</div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        {kind === 'custom-tool' && (
          <div className="flex gap-1.5">
            <button
              onClick={handleAddCustom}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10"
            >
              <Plus size={11} />
              增加
            </button>
            <button
              onClick={() => openEditor()}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/75 hover:bg-white/10"
            >
              <Edit3 size={11} />
              编辑
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {meta.presets.map((ps) => (
            <button
              key={ps.id}
              onClick={() => handleSelect(ps)}
              className={`py-1 px-1.5 rounded text-[11px] transition-colors border truncate ${
                selectedId === ps.id
                  ? meta.chipActive
                  : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
              }`}
              title={ps.text}
            >
              {ps.label}
            </button>
          ))}
        </div>

        {prompt && (
          <div className="text-[10px] text-white/60 bg-white/5 border border-white/10 rounded px-2 py-1.5 leading-relaxed">
            <div className="flex items-center gap-1 text-white/40 mb-0.5">
              <Sparkles size={9} /> {selectedLabel}
            </div>
            <span className="break-all">{prompt}</span>
          </div>
        )}
      </div>

      {kind === 'custom-tool' && editorOpen && (
        <div
          className="absolute left-full top-12 z-50 ml-3 w-[280px] rounded-xl border border-white/12 bg-zinc-950/96 p-3 shadow-2xl"
          style={{ backdropFilter: 'blur(16px)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-xs font-semibold text-white">编辑工具</div>
          <input
            value={draftLabel}
            onChange={(e) => update({ draftLabel: e.target.value })}
            placeholder="按钮标题"
            className="mb-2 w-full rounded-md bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30 nodrag nowheel"
          />
          <textarea
            value={draftPrompt}
            onChange={(e) => update({ draftPrompt: e.target.value })}
            placeholder="输出提示词"
            className="h-24 w-full resize-none rounded-md bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30 nodrag nowheel"
          />
          <button
            onClick={handleSaveCustom}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white hover:bg-white/15"
          >
            <Save size={12} />
            保存
          </button>
        </div>
      )}
    </div>
  );
};

export default memo(ToolboxParamNode);
