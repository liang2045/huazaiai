/**
 * iMade 节点类型定义
 * 与 features.json 节点清单严格对齐(24 节点 + 4 已弃)
 */

// 节点类型(25 种保留 = 24 + upload)
export type NodeType =
  // Core (8)
  | 'text'
  | 'image'
  | 'video'
  | 'seedance'
  | 'audio'
  | 'llm'
  | 'runninghub'
  | 'runninghub-wallet'
  | 'rh-config'
  // Special (5)
  | 'multi-angle-3d'
  | 'panorama-720'
  | 'portrait-preset'
  | 'portrait-metadata'
  | 'storyboard-grid'
  // Utility (9)
  | 'drawing-board'
  | 'browser'
  | 'image-compare'
  | 'frame-extractor'
  | 'resize'
  | 'combine'
  | 'remove-bg'
  | 'upscale'
  | 'grid-crop'
  // Auxiliary (5)
  | 'edit'
  | 'idea'
  | 'bp'
  | 'relay'
  | 'video-output'
  // Toolbox (2)
  | 'cinematic'
  | 'video-motion'
  | 'custom-tool'
  // Input/Output 素材 (2) - 上传素材(图像/视频/音频三合一) + 输出素材(文本/图像/视频/音频预览)
  | 'upload'
  | 'output';

// 节点分类
export type NodeCategory =
  | 'core'
  | 'rh'
  | 'special'
  | 'utility'
  | 'auxiliary'
  | 'toolbox'
  | 'input';

// 节点元数据(用于 Sidebar 展示)
export interface NodeMeta {
  type: NodeType;
  label: string;
  category: NodeCategory;
  description: string;
  icon: string; // lucide-react 图标名
  color: string; // tailwind 色阶
  /**
   * 是否在 UI 入口暂时隐藏(Sidebar 节点列表 + 端口拖出候选选择器)。
   * 节点本身仍然在 NODE_REGISTRY 中注册到 nodeTypes,以保证已存在画布数据加载与渲染兼容,
   * 仅从用户主动添加入口中移除。设为 true 即等价于「暂时不展示」。
   */
  hidden?: boolean;
}

// 画布节点数据(xyflow Node.data)
export interface CanvasNodeData {
  label?: string;
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  model?: string;
  status?: 'idle' | 'generating' | 'success' | 'error';
  error?: string;
  // 通用扩展字段
  [key: string]: any;
}

// 画布列表项(后端返回)
export interface CanvasListItem {
  id: string;
  name: string;
  nodeCount: number;
  previewUrl?: string;
  previewKind?: 'image' | 'video' | '';
  createdAt: number;
  updatedAt: number;
}

// 画布完整数据
export interface CanvasData {
  nodes: any[];
  edges: any[];
  viewport: { x: number; y: number; zoom: number };
}

// API Key 设置(对应后端 settings)
export interface ApiSettings {
  // 三套通用 Key
  zhenzhenApiKey: string;
  zhenzhenBaseUrl: string; // 锁定 https://ai.t8star.org
  rhApiKey: string;
  rhBaseUrl: string; // https://www.runninghub.cn
  // RH 钱包应用专用 APIKEY（RH 企业级共享 APIKEY）——
  // 仅供 runninghub-wallet 节点提交使用，不会被默认 RunningHub 节点调用
  rhWalletApiKey: string;
  llmApiKey: string;
  llmBaseUrl: string; // 锁定 https://ai.t8star.org
  // 分类 API Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey?: string;
  nanoBananaApiKey?: string;
  mjApiKey?: string;
  veoApiKey?: string;
  grokApiKey?: string;
  seedanceApiKey?: string;
  sunoApiKey?: string;
  sharedFolderPath?: string;
  netdiskUrl?: string;
  downloadDir?: string;
  preferences?: {
    theme?: 'dark' | 'light';
    language?: string;
  };
}
