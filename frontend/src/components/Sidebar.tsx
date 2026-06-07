import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { NODE_GROUPS } from '../config/nodeRegistry';

import type { NodeMeta, NodeType } from '../types/canvas';
import { useThemeStore } from '../stores/theme';
import { useCanvasStore } from '../stores/canvas';
const COLOR_HEX: Record<string, string> = {
  sky: '#93999d',
  amber: '#aaa28f',
  rose: '#a59797',
  fuchsia: '#99929d',
  violet: '#9895a1',
  emerald: '#8f9e96',
  cyan: '#8f9d9e',
  indigo: '#9295a1',
  orange: '#a4988b',
  pink: '#a0969a',
  teal: '#909e9a',
  slate: '#9e9e98',
};

interface SidebarProps {
  onAddNode: (type: NodeType) => void;
  appName?: string;
  appVersion?: string;
  hiddenGroups?: string[];
  floating?: boolean;
}

export default function Sidebar({ onAddNode, appName = 'iMade', appVersion = '', hiddenGroups = [], floating = false }: SidebarProps) {
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [keyword, setKeyword] = useState('');

  // 画布管理(整合到节点侧边栏顶部)
  const {
    canvases,
    activeId,
    loading: canvasLoading,
    loadCanvases,
    createCanvas,
    deleteCanvas,
    renameCanvas,
    setActive,
  } = useCanvasStore();
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadCanvases();
  }, [loadCanvases]);

  const handleCreateCanvas = async () => {
    const name = `画布 ${canvases.length + 1}`;
    await createCanvas(name);
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const submitEdit = async () => {
    if (editingId && editingName.trim()) {
      await renameCanvas(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  const handleDeleteCanvas = async (id: string) => {
    await deleteCanvas(id);
    setConfirmDelete(null);
  };

  const toggle = (key: string) => setCollapsed((s) => ({ ...s, [key]: !s[key] }));

  const renderNode = (n: NodeMeta) => {
    const Icon = (Icons as any)[n.icon] || Icons.Box;
    const colorHex = COLOR_HEX[n.color] || COLOR_HEX.slate;
    return (
      <button
        key={n.type}
        onClick={() => onAddNode(n.type)}
        title={n.description}
        className={`w-full text-left flex items-center gap-2 px-2 py-1.5 transition-colors text-xs ${
          isPixel
            ? 'px-row'
            : `rounded-md ${
                isDark
                  ? 'hover:bg-white/10 text-zinc-200'
                  : 'hover:bg-black/5 text-zinc-800'
              }`
        }`}
      >
        <span
          className={`w-6 h-6 flex items-center justify-center flex-shrink-0 ${
            isPixel ? 'rounded-[6px] border-2' : 'rounded'
          }`}
          style={
            isPixel
              ? {
                  background: colorHex,
                  color: '#1A1410',
                  borderColor: '#1A1410',
                }
              : {
                  background: colorHex + '22',
                  color: colorHex,
                  boxShadow: `inset 0 0 0 1px ${colorHex}55`,
                }
          }
        >
          <Icon size={13} />
        </span>
        <span className="flex-1 min-w-0 truncate">{n.label}</span>
      </button>
    );
  };

  // 搜索过滤
  const filterNodes = (nodes: NodeMeta[]) => {
    if (!keyword.trim()) return nodes;
    const k = keyword.toLowerCase();
    return nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(k) ||
        n.type.toLowerCase().includes(k) ||
        n.description.toLowerCase().includes(k)
    );
  };

  return (
    <div
      className={`${floating ? 'w-[300px] max-h-[calc(100vh-72px)] rounded-xl border shadow-2xl' : 'w-64 border-r'} flex flex-col overflow-hidden ${
        isPixel
          ? 'px-panel'
          : isDark
            ? 'bg-zinc-900/95 border-white/10'
            : 'bg-white/95 border-black/10'
      }`}
      style={floating ? { backdropFilter: 'blur(18px)', boxShadow: '0 24px 80px rgba(0,0,0,.45)' } : undefined}
    >
      {/* 画布管理(可折叠) */}
      <div
        className={`border-b ${
          isPixel ? 'border-[#1A1410]/80' : isDark ? 'border-white/10' : 'border-black/10'
        }`}
      >
        <div
          className={`flex items-center gap-1 px-2 py-2 ${
            isPixel ? '' : isDark ? 'text-white/70' : 'text-zinc-700'
          }`}
        >
          <button
            onClick={() => setCanvasPanelOpen((v) => !v)}
            className={`flex items-center gap-1 flex-1 text-left text-[11px] font-semibold uppercase tracking-wider ${
              isPixel
                ? 'px-group-title'
                : isDark
                  ? 'hover:text-white'
                  : 'hover:text-zinc-900'
            }`}
          >
            {canvasPanelOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderOpen size={12} />
            <span>画布</span>
            <span className="opacity-60 ml-1 normal-case">{canvases.length}</span>
          </button>
          <button
            onClick={handleCreateCanvas}
            className={
              isPixel
                ? 'px-btn px-btn--icon px-btn--mint'
                : `p-1 rounded-md ${
                    isDark
                      ? 'hover:bg-white/10 text-white/70 hover:text-white'
                      : 'hover:bg-black/10 text-zinc-700'
                  }`
            }
            title="新建画布"
          >
            <Plus size={13} />
          </button>
        </div>
        {canvasPanelOpen && (
          <div className="px-2 pb-2 max-h-56 overflow-y-auto space-y-0.5 scrollbar-hide">
            {canvasLoading && (
              <div
                className={`flex items-center gap-2 px-2 py-2 text-[11px] ${
                  isPixel ? '' : isDark ? 'text-white/40' : 'text-zinc-500'
                }`}
              >
                <Loader2 size={12} className="animate-spin" /> 加载中...
              </div>
            )}
            {!canvasLoading && canvases.length === 0 && (
              <div
                className={`text-center py-3 text-[11px] ${
                  isPixel ? '' : isDark ? 'text-white/40' : 'text-zinc-500'
                }`}
              >
                <p>还没有画布</p>
                <button
                  onClick={handleCreateCanvas}
                  className={
                    isPixel
                      ? 'mt-1.5 px-btn px-btn--sm px-btn--mint'
                      : 'mt-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] hover:bg-emerald-500/30'
                  }
                >
                  + 新建第一个画布
                </button>
              </div>
            )}
            {canvases.map((c) => {
              const isActive = c.id === activeId;
              const isEditing = editingId === c.id;
              const needConfirm = confirmDelete === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => !isEditing && setActive(c.id)}
                  className={`group px-2 py-1 cursor-pointer text-[11px] transition-colors ${
                    isPixel
                      ? `px-row ${isActive ? 'is-active' : ''}`
                      : `rounded-md ${
                          isActive
                            ? isDark
                              ? 'bg-white/10 text-white'
                              : 'bg-black/10 text-zinc-900'
                            : isDark
                              ? 'text-white/70 hover:bg-white/5'
                              : 'text-zinc-700 hover:bg-black/5'
                        }`
                  }`}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={submitEdit}
                      className={`w-full px-1.5 py-0.5 rounded text-[11px] outline-none border ${
                        isDark
                          ? 'bg-zinc-800 border-white/20 text-white'
                          : 'bg-white border-black/20'
                      }`}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{c.name}</div>
                        <div
                          className={`text-[10px] ${
                            isDark ? 'text-white/30' : 'text-zinc-400'
                          }`}
                        >
                          {c.nodeCount} 个节点
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                        {needConfirm ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCanvas(c.id);
                              }}
                              className="p-0.5 rounded hover:bg-red-500/20 text-red-400"
                              title="确认删除"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDelete(null);
                              }}
                              className={`p-0.5 rounded ${
                                isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                              }`}
                            >
                              <X size={11} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(c.id, c.name);
                              }}
                              className={`p-0.5 rounded ${
                                isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                              }`}
                              title="重命名"
                            >
                              <Edit2 size={10} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDelete(c.id);
                              }}
                              className={`p-0.5 rounded ${
                                isDark
                                  ? 'hover:bg-red-500/20 text-red-400'
                                  : 'hover:bg-red-100 text-red-600'
                              }`}
                              title="删除"
                            >
                              <Trash2 size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 搜索框 */}
      <div
        className={`p-2 border-b ${
          isPixel ? 'border-[#1A1410]/80' : isDark ? 'border-white/10' : 'border-black/10'
        }`}
      >
        <div
          className={`flex items-center gap-2 px-2 py-1.5 ${
            isPixel
              ? 'px-input rounded-[10px]'
              : `rounded-md ${isDark ? 'bg-white/5' : 'bg-black/5'}`
          }`}
        >
          <Search size={14} className="opacity-60" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索节点..."
            className={`flex-1 bg-transparent outline-none text-xs ${
              isPixel
                ? ''
                : isDark
                  ? 'text-white placeholder:text-white/30'
                  : 'text-zinc-900 placeholder:text-zinc-400'
            }`}
          />
        </div>
      </div>

      {/* 节点分组列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide">
        {Object.entries(NODE_GROUPS).map(([key, group]) => {
          if (hiddenGroups.includes(key)) return null;
          const visible = filterNodes(group.nodes);
          if (visible.length === 0) return null;
          const isCollapsed = collapsed[key];
          return (
            <div key={key} className="mb-1">
              <button
                onClick={() => toggle(key)}
                className={`w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                  isPixel
                    ? 'px-group-title'
                    : isDark
                      ? 'text-white/50 hover:text-white/80'
                      : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="flex-1 text-left">{group.label}</span>
                <span className="opacity-60">{visible.length}</span>
              </button>
              {!isCollapsed && <div className="space-y-0.5 mt-0.5">{visible.map(renderNode)}</div>}
            </div>
          );
        })}
      </div>

      {/* 底部版本信息 */}
      <div
        className={`px-3 py-2 border-t text-[10px] ${
          isPixel
            ? 'border-[#1A1410]/80'
            : isDark
              ? 'border-white/10 text-white/30'
              : 'border-black/10 text-zinc-400'
        }`}
      >
        {isPixel ? (
          <span className="px-chip px-chip--muted">{appName}{appVersion ? ` · v${appVersion}` : ''}</span>
        ) : (
          <>{appName}{appVersion ? ` · v${appVersion}` : ''}</>
        )}
      </div>
    </div>
  );
}
