/**
 * 节点端口语义注册表(连接类型校验核心)
 *
 * 设计目标:
 *   每个节点声明它的"输入需要什么"与"输出提供什么"。
 *   连接时只允许 source.outputs 与 target.inputs 有交集才能连。
 *   特殊类型 'any' 表示透传,与任何类型互通(用于 relay 中继)。
 *   upload 节点是动态的:输出根据 data.uploadType 决定,未上传时视为通用占位。
 *
 * 端口类型(PortType):
 *   - text:     文本/提示词 (data.prompt)
 *   - image:    图像 URL (data.imageUrl)
 *   - video:    视频 URL (data.videoUrl)
 *   - audio:    音频 URL (data.audioUrl)
 *   - metadata: 结构化元数据(肖像/参数包)
 *   - config:   配置参数(rh-config 注入)
 *   - any:      透传(中继)
 */
import type { Node } from '@xyflow/react';

export type PortType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'metadata'
  | 'config'
  | 'any';

export interface NodePorts {
  /** 该节点能接受的输入类型集合 */
  inputs: PortType[];
  /** 该节点能产出的输出类型集合 */
  outputs: PortType[];
}

/**
 * 节点端口注册表(覆盖全部 24 + upload 共 25 种节点)
 * 与 features.json 节点清单严格对齐
 */
export const NODE_PORTS: Record<string, NodePorts> = {
  // ========== Core ==========
  text: { inputs: [], outputs: ['text'] },
  image: { inputs: ['text', 'image'], outputs: ['image'] },
  video: { inputs: ['text', 'image'], outputs: ['video'] },
  // SD2.0 (Seedance 2.0) 同时支持:
  //   text  → prompt
  //   image → reference_image / first_frame / last_frame
  //   video → reference_video (上游视频节点 / SD2.0 节点 都可作为输入)
  //   audio → reference_audio
  seedance: { inputs: ['text', 'image', 'video', 'audio'], outputs: ['video'] },
  audio: { inputs: ['text', 'audio'], outputs: ['audio'] },
  llm: { inputs: ['text', 'image'], outputs: ['text'] },

  // ========== RH ==========
  runninghub: { inputs: ['text', 'image', 'video', 'audio', 'config'], outputs: ['image', 'video'] },
  // RH 钱包应用：端口语义与 runninghub 一致，仅是提交时使用独立 APIKEY
  'runninghub-wallet': { inputs: ['text', 'image', 'video', 'audio', 'config'], outputs: ['image', 'video'] },
  // RhConfigNode 阶段 B 通用化：可接受任意上游节点产出的
  // text / image / video / audio（提交时由 RunningHubNode 负责调 /upload-asset 转 fileName）
  'rh-config': { inputs: ['text', 'image', 'video', 'audio'], outputs: ['config'] },

  // ========== Special ==========
  'multi-angle-3d': { inputs: ['text', 'image'], outputs: ['image'] },
  'panorama-720': { inputs: ['text'], outputs: ['image'] },
  'portrait-preset': { inputs: ['text', 'image', 'metadata'], outputs: ['image'] },
  'portrait-metadata': { inputs: ['image'], outputs: ['metadata'] },
  'storyboard-grid': { inputs: ['image'], outputs: ['image'] },

  // ========== Utility ==========
  'drawing-board': { inputs: ['image'], outputs: ['image'] },
  browser: { inputs: [], outputs: ['text', 'image'] },
  'image-compare': { inputs: ['image'], outputs: [] },
  'frame-extractor': { inputs: ['video'], outputs: ['image'] },
  resize: { inputs: ['image'], outputs: ['image'] },
  combine: { inputs: ['image'], outputs: ['image'] },
  'remove-bg': { inputs: ['image'], outputs: ['image'] },
  upscale: { inputs: ['image'], outputs: ['image'] },
  'grid-crop': { inputs: ['image'], outputs: ['image'] },

  // ========== Auxiliary ==========
  edit: { inputs: ['text', 'image'], outputs: ['image'] },
  idea: { inputs: [], outputs: ['text'] },
  bp: { inputs: ['text'], outputs: ['text'] },
  // relay 中继:任意进任意出(透传)
  relay: { inputs: ['any'], outputs: ['any'] },
  'video-output': { inputs: ['video'], outputs: [] },

  // ========== Toolbox ==========
  cinematic: { inputs: [], outputs: ['text'] },
  'video-motion': { inputs: [], outputs: ['text'] },
  'custom-tool': { inputs: [], outputs: ['text'] },

  // ========== 上传素材节点 (NEW) ==========
  // 动态:由 data.uploadType 决定具体输出。未上传时 outputs=[],不允许连出。
  upload: { inputs: [], outputs: [] },

  // ========== 输出素材节点 (NEW) ==========
  // 任意上游节点的 文本/图像/视频/音频 都可连入；同时作为中继节点可继续向下游透传 (any)。
  output: { inputs: ['text', 'image', 'video', 'audio', 'any'], outputs: ['any'] },

  // ========== 组容器 (NEW) ==========
  // groupBox 自身不接收外部输入 (无 target handle),
  // 但右侧 source handle 可以把「组内所有节点的聚合输出 (any)」一次性传给组外节点。
  groupBox: { inputs: [], outputs: ['any'] },
};

/**
 * 取节点的输入端口类型(返回该节点能接收的 PortType 列表)。
 */
export function getNodeInputs(node: Node | null | undefined): PortType[] {
  if (!node || !node.type) return [];
  const ports = NODE_PORTS[node.type];
  return ports?.inputs ?? [];
}

/**
 * 取节点的输出端口类型(对 upload 做动态解析)。
 */
export function getNodeOutputs(node: Node | null | undefined): PortType[] {
  if (!node || !node.type) return [];

  // upload 节点根据 data.uploadType 动态决定输出类型
  if (node.type === 'upload') {
    const uploadType = (node.data as any)?.uploadType as
      | 'image'
      | 'video'
      | 'audio'
      | undefined;
    if (uploadType === 'image') return ['image'];
    if (uploadType === 'video') return ['video'];
    if (uploadType === 'audio') return ['audio'];
    // 未上传时不暴露任何输出类型
    return [];
  }

  const ports = NODE_PORTS[node.type];
  return ports?.outputs ?? [];
}

/**
 * 端口类型集合是否兼容(any 透传 + 交集判定)
 */
export function arePortsCompatible(
  sourceOutputs: PortType[],
  targetInputs: PortType[]
): boolean {
  if (sourceOutputs.length === 0 || targetInputs.length === 0) return false;
  // any 透传:任一侧带 any 即兼容
  if (sourceOutputs.includes('any') || targetInputs.includes('any')) return true;
  // 取交集
  return sourceOutputs.some((t) => targetInputs.includes(t));
}

/**
 * 主校验函数:给 ReactFlow 的 isValidConnection 直接复用。
 *
 * @param source 源节点
 * @param target 目标节点
 * @returns true=允许连接 / false=拒绝
 */
export function isConnectionValid(
  source: Node | null | undefined,
  target: Node | null | undefined
): boolean {
  if (!source || !target) return false;
  if (source.id === target.id) return false; // 不允许自连
  const sOut = getNodeOutputs(source);
  const tIn = getNodeInputs(target);
  return arePortsCompatible(sOut, tIn);
}

/**
 * 端口类型 → 颜色映射(用于 Handle 颜色与 UI 提示)
 */
export const PORT_COLOR: Record<PortType, string> = {
  text: '#7dd3fc',     // sky-300
  image: '#fcd34d',    // amber-300
  video: '#fda4af',    // rose-300
  audio: '#c4b5fd',    // violet-300
  metadata: '#67e8f9', // cyan-300
  config: '#a5b4fc',   // indigo-300
  any: '#cbd5e1',      // slate-300
};

/**
 * 端口类型中文标签
 */
export const PORT_LABEL: Record<PortType, string> = {
  text: '文本',
  image: '图像',
  video: '视频',
  audio: '音频',
  metadata: '元数据',
  config: '配置',
  any: '任意',
};
