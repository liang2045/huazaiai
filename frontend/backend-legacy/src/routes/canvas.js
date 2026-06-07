// 画布数据 CRUD 路由(Phase 0 占位,Phase 1 完整实现)
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = express.Router();

// 工具函数
function loadCanvasList() {
  if (!fs.existsSync(config.CANVAS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(config.CANVAS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCanvasList(list) {
  fs.writeFileSync(config.CANVAS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function getCanvasFile(id) {
  return path.join(config.DATA_DIR, `canvas_${id}.json`);
}

function pickPreview(data) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  for (const node of nodes) {
    const d = node && node.data ? node.data : {};
    if (d.imageUrl) return { previewUrl: d.imageUrl, previewKind: 'image' };
    if (Array.isArray(d.imageUrls) && d.imageUrls[0]) return { previewUrl: d.imageUrls[0], previewKind: 'image' };
    if (d.videoUrl) return { previewUrl: d.videoUrl, previewKind: 'video' };
  }
  return { previewUrl: '', previewKind: '' };
}

// GET /api/canvas — 获取画布列表
router.get('/', (_req, res) => {
  const list = loadCanvasList();
  res.json({ success: true, data: list });
});

// POST /api/canvas — 创建画布
router.post('/', (req, res) => {
  const list = loadCanvasList();
  const id = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const canvas = {
    id,
    name: req.body?.name || '未命名画布',
    nodeCount: 0,
    previewUrl: '',
    previewKind: '',
    createdAt: now,
    updatedAt: now,
  };
  list.push(canvas);
  saveCanvasList(list);
  // 初始化空画布数据
  fs.writeFileSync(
    getCanvasFile(id),
    JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, null, 2),
    'utf-8'
  );
  res.json({ success: true, data: canvas });
});

// GET /api/canvas/:id — 获取单个画布数据
router.get('/:id', (req, res) => {
  const file = getCanvasFile(req.params.id);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ success: false, error: '画布不存在' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: '读取失败: ' + e.message });
  }
});

// PUT /api/canvas/:id — 更新画布数据(防空数据覆盖)
router.put('/:id', (req, res) => {
  const file = getCanvasFile(req.params.id);
  const incoming = req.body;
  // 防空数据覆盖保护
  if (
    !incoming ||
    !Array.isArray(incoming.nodes) ||
    (incoming.nodes.length === 0 && fs.existsSync(file))
  ) {
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null;
    if (existing && Array.isArray(existing.nodes) && existing.nodes.length > 0) {
      console.warn(`⚠ 拒绝空数据覆盖画布 ${req.params.id}(原 ${existing.nodes.length} 节点)`);
      return res.status(400).json({ success: false, error: '拒绝空数据覆盖' });
    }
  }
  fs.writeFileSync(file, JSON.stringify(incoming, null, 2), 'utf-8');
  // 更新列表元数据
  const list = loadCanvasList();
  const item = list.find((x) => x.id === req.params.id);
  if (item) {
    item.nodeCount = incoming.nodes?.length || 0;
    const preview = pickPreview(incoming);
    item.previewUrl = preview.previewUrl;
    item.previewKind = preview.previewKind;
    item.updatedAt = Date.now();
    saveCanvasList(list);
  }
  res.json({ success: true });
});

// DELETE /api/canvas/:id
router.delete('/:id', (req, res) => {
  const list = loadCanvasList();
  const filtered = list.filter((x) => x.id !== req.params.id);
  saveCanvasList(filtered);
  const file = getCanvasFile(req.params.id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

// PATCH /api/canvas/:id/name — 重命名
router.patch('/:id/name', (req, res) => {
  const list = loadCanvasList();
  const item = list.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '画布不存在' });
  item.name = req.body?.name || item.name;
  item.updatedAt = Date.now();
  saveCanvasList(list);
  res.json({ success: true, data: item });
});

module.exports = router;
