import { useEffect, useState } from 'react';
import { Check, Edit2, Plus, Trash2, X, FolderOpen, Loader2 } from 'lucide-react';
import { useCanvasStore } from '../stores/canvas';
import { useThemeStore } from '../stores/theme';

export default function CanvasManager() {
  const { theme } = useThemeStore();
  const { canvases, activeId, loading, loadCanvases, createCanvas, deleteCanvas, renameCanvas, setActive } =
    useCanvasStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadCanvases();
  }, [loadCanvases]);

  const isDark = theme === 'dark';

  const handleCreate = async () => {
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

  const handleDelete = async (id: string) => {
    await deleteCanvas(id);
    setConfirmDelete(null);
  };

  return (
    <div
      className={`w-56 flex flex-col border-r ${
        isDark ? 'bg-zinc-950 border-white/10' : 'bg-zinc-100 border-black/10'
      }`}
    >
      {/* 头部 */}
      <div className={`px-3 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-white/10' : 'border-black/10'
      }`}>
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className={isDark ? 'text-white/70' : 'text-zinc-700'} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${
            isDark ? 'text-white/70' : 'text-zinc-700'
          }`}>
            画布
          </span>
          <span className={`text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-500'}`}>
            {canvases.length}
          </span>
        </div>
        <button
          onClick={handleCreate}
          className={`p-1 rounded-md ${
            isDark ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-black/10 text-zinc-700'
          }`}
          title="新建画布"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide">
        {loading && (
          <div className={`flex items-center gap-2 px-2 py-3 text-xs ${
            isDark ? 'text-white/40' : 'text-zinc-500'
          }`}>
            <Loader2 size={12} className="animate-spin" /> 加载中...
          </div>
        )}
        {!loading && canvases.length === 0 && (
          <div className={`text-center py-6 text-xs ${isDark ? 'text-white/40' : 'text-zinc-500'}`}>
            <div className="text-2xl mb-1">📄</div>
            <p>还没有画布</p>
            <button
              onClick={handleCreate}
              className="mt-2 px-3 py-1 rounded-md bg-emerald-500/20 text-emerald-300 text-[11px] hover:bg-emerald-500/30"
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
              className={`group rounded-md px-2 py-1.5 cursor-pointer text-xs transition-colors ${
                isActive
                  ? isDark
                    ? 'bg-white/10 text-white'
                    : 'bg-black/10 text-zinc-900'
                  : isDark
                    ? 'text-white/70 hover:bg-white/5'
                    : 'text-zinc-700 hover:bg-black/5'
              }`}
            >
              {isEditing ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitEdit();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={submitEdit}
                    className={`flex-1 px-1.5 py-0.5 rounded text-xs outline-none border ${
                      isDark ? 'bg-zinc-800 border-white/20 text-white' : 'bg-white border-black/20'
                    }`}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className={`text-[10px] ${isDark ? 'text-white/30' : 'text-zinc-400'}`}>
                      {c.nodeCount} 个节点
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                    {needConfirm ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(c.id);
                          }}
                          className="p-0.5 rounded hover:bg-red-500/20 text-red-400"
                          title="确认删除"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(null);
                          }}
                          className={`p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(c.id, c.name);
                          }}
                          className={`p-0.5 rounded ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                          title="重命名"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDelete(c.id);
                          }}
                          className={`p-0.5 rounded ${isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-100 text-red-600'}`}
                          title="删除"
                        >
                          <Trash2 size={11} />
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
    </div>
  );
}
