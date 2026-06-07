import type { NodeMeta } from '../types/canvas';

/**
 * 节点元数据注册表
 * 严格对齐 features.json 中的 24 个保留节点
 * 图标使用 lucide-react 名称(运行时由 Sidebar 动态查找)
 */
export const NODE_REGISTRY: NodeMeta[] = [
  // ========== Input 输出素材(2) ==========
  { type: 'upload', label: '上传素材', category: 'input', description: '图像 / 视频 / 音频 三合一上传(自适应输出端口)', icon: 'Upload', color: 'emerald' },
  { type: 'output', label: '输出素材', category: 'auxiliary', description: '起于上游任意节点的 文本/图像/视频/音频 结果预览(原始宽高比 + 文本双击编辑)', icon: 'MonitorPlay', color: 'teal', hidden: true },

  // ========== Core 核心节点(6) ==========
  { type: 'text', label: '文本', category: 'core', description: '提示词文本节点', icon: 'Type', color: 'sky' },
  { type: 'image', label: '图像', category: 'core', description: 'GPT Image 2 / Nano Banana Pro / Nano Banana 2 (多 TAB 模型切换)', icon: 'Image', color: 'amber' },
  { type: 'video', label: '视频', category: 'core', description: 'Veo 3.1 / Grok Video', icon: 'Video', color: 'rose' },
  { type: 'seedance', label: 'SD2.0', category: 'core', description: 'Seedance 2.0 视频分镜', icon: 'Film', color: 'fuchsia' },
  { type: 'audio', label: '音频', category: 'core', description: 'Suno V5.5 全模式(生成/翻唱/续写)', icon: 'Music', color: 'violet' },
  { type: 'llm', label: 'LLM', category: 'core', description: 'GPT-5 / Claude 4.5 / Gemini 2.5(独立 Key)', icon: 'Brain', color: 'emerald' },

  // ========== RH RunningHub 节点(3) ==========
  { type: 'runninghub', label: 'RunningHub', category: 'rh', description: 'RH 工作流主节点', icon: 'Workflow', color: 'cyan', hidden: true },
  // RH 钱包应用：复用 RunningHubNode 实现，但提交时使用独立的 RH 企业级共享 APIKEY（settings.rhWalletApiKey）
  { type: 'runninghub-wallet', label: 'RH钱包应用', category: 'rh', description: 'RH 钱包应用工作流（需配置 RH 企业级共享 APIKEY）', icon: 'Wallet', color: 'violet', hidden: true },
  // RH 配置节点从 v1.1.x 起隐藏（参数注入已可由 RunningHub 节点内表单代替，hidden:true 仅从 Sidebar 隐藏，保留老画布节点越。需重启删除 hidden 即可）
  { type: 'rh-config', label: 'RH 配置', category: 'rh', description: 'RH 工作流参数注入', icon: 'Settings2', color: 'cyan', hidden: true },

  // ========== Special 特殊节点(5) ==========
  // 以下五个节点暂时隐藏不展示 (hidden: true) —— 需要重新启用时删除 hidden 即可。
  { type: 'multi-angle-3d', label: '多角度 3D', category: 'special', description: '3D 多视角生成', icon: 'Box', color: 'indigo', hidden: true },
  { type: 'panorama-720', label: '720 全景', category: 'special', description: '720° 全景图', icon: 'Globe', color: 'indigo', hidden: true },
  { type: 'portrait-preset', label: '肖像模板', category: 'special', description: '肖像专用流程', icon: 'UserSquare2', color: 'indigo', hidden: true },
  { type: 'portrait-metadata', label: '肖像元数据', category: 'special', description: '肖像参数管理', icon: 'FileText', color: 'indigo', hidden: true },
  { type: 'storyboard-grid', label: '分镜网格', category: 'special', description: '分镜九宫格布局', icon: 'LayoutGrid', color: 'indigo', hidden: true },

  // ========== Utility 工具节点(9) ==========
  // 其中 6 个暂时隐藏: drawing-board / browser / image-compare / frame-extractor / remove-bg / upscale
  { type: 'drawing-board', label: '画框', category: 'core', description: '类似 Figma 画板，可设置分辨率并容纳生成图像', icon: 'Frame', color: 'amber' },
  { type: 'browser', label: '浏览器', category: 'utility', description: '网页内嵌', icon: 'Globe2', color: 'orange', hidden: true },
  { type: 'image-compare', label: '图片对比', category: 'utility', description: '前后对比', icon: 'GitCompare', color: 'orange', hidden: true },
  { type: 'frame-extractor', label: '抽帧', category: 'utility', description: '视频抽帧', icon: 'Scissors', color: 'orange', hidden: true },
  { type: 'resize', label: '尺寸调整', category: 'utility', description: '图像尺寸调整', icon: 'Maximize2', color: 'orange' },
  { type: 'combine', label: '合并', category: 'utility', description: '图像合并', icon: 'Combine', color: 'orange' },
  { type: 'remove-bg', label: '抠图', category: 'utility', description: '去除背景', icon: 'Eraser', color: 'orange', hidden: true },
  { type: 'upscale', label: '放大', category: 'utility', description: '图像放大', icon: 'ZoomIn', color: 'orange', hidden: true },
  { type: 'grid-crop', label: '九宫格', category: 'utility', description: '网格切图', icon: 'Grid3x3', color: 'orange' },

  // ========== Auxiliary 辅助节点(5) ==========
  // 其中 2 个暂时隐藏: edit / video-output
  { type: 'edit', label: '编辑', category: 'auxiliary', description: '图像编辑/局部', icon: 'Edit3', color: 'slate', hidden: true },
  { type: 'idea', label: '灵感', category: 'auxiliary', description: '灵感记录', icon: 'Lightbulb', color: 'slate' },
  { type: 'bp', label: 'BP 蓝图', category: 'auxiliary', description: 'Blueprint 蓝图', icon: 'Map', color: 'slate' },
  { type: 'relay', label: '中继', category: 'auxiliary', description: '数据中转', icon: 'ArrowRightLeft', color: 'slate' },
  { type: 'video-output', label: '视频输出', category: 'auxiliary', description: '视频结果展示', icon: 'MonitorPlay', color: 'slate', hidden: true },

  // ========== Toolbox 工具箱(2) ==========
  { type: 'cinematic', label: '电影感', category: 'toolbox', description: '影视化效果', icon: 'Clapperboard', color: 'pink' },
  { type: 'video-motion', label: '视频运镜', category: 'toolbox', description: '运镜参数', icon: 'Camera', color: 'pink' },
  { type: 'custom-tool', label: '自定义工具', category: 'toolbox', description: '自定义按钮名称和提示词', icon: 'SlidersHorizontal', color: 'slate' },
];

// 按分类分组,便于 Sidebar 渲染 (在这里过滤 hidden 节点 —— 它们仍在 NODE_REGISTRY 中保证节点类型注册)
export const NODE_GROUPS: Record<string, { label: string; nodes: NodeMeta[] }> = {
  input: { label: '素材资源', nodes: NODE_REGISTRY.filter((n) => n.category === 'input' && !n.hidden) },
  core: { label: '核心节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'core' && !n.hidden) },
  rh: { label: 'RH', nodes: NODE_REGISTRY.filter((n) => n.category === 'rh' && !n.hidden) },
  special: { label: '特殊节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'special' && !n.hidden) },
  utility: { label: '工具节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'utility' && !n.hidden) },
  auxiliary: { label: '辅助节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'auxiliary' && !n.hidden) },
  toolbox: { label: '工具箱', nodes: NODE_REGISTRY.filter((n) => n.category === 'toolbox' && !n.hidden) },
};

// 通过 type 反查 meta
export function getNodeMeta(type: string): NodeMeta | undefined {
  return NODE_REGISTRY.find((n) => n.type === type);
}
