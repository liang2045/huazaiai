import type { Edge, Node } from '@xyflow/react';

/**
 * 工作流模板预设
 * - 一键生成常见的节点连线组合
 * - id 在生成时会被替换成时间戳前缀,避免重复
 */

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  build: () => { nodes: Node[]; edges: Edge[] };
}

const dx = 320; // 节点横向间距
const dy = 200; // 节点纵向间距
const baseX = 80;
const baseY = 80;

function uid(seed: string) {
  return `${seed}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeNode(type: string, col: number, row: number, data: Record<string, any> = {}): Node {
  return {
    id: uid(type),
    type,
    position: { x: baseX + col * dx, y: baseY + row * dy },
    data,
  };
}

function makeEdge(source: string, target: string): Edge {
  return {
    id: uid('e'),
    source,
    target,
  };
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: 'tpl-text-to-image',
    name: '文生图',
    description: 'Text → Image,最简单的图像生成流水线',
    build() {
      const t = makeNode('text', 0, 0, { text: '一只在月光下的角色,极简卡通风格' });
      const img = makeNode('image', 1, 0);
      return { nodes: [t, img], edges: [makeEdge(t.id, img.id)] };
    },
  },
  {
    id: 'tpl-image-to-video',
    name: '图生视频',
    description: 'Text → Image → Video,从提示词到视频',
    build() {
      const t = makeNode('text', 0, 0, { text: '海浪轻轻拍打沙滩,慢动作' });
      const img = makeNode('image', 1, 0);
      const vid = makeNode('video', 2, 0);
      return {
        nodes: [t, img, vid],
        edges: [makeEdge(t.id, img.id), makeEdge(img.id, vid.id)],
      };
    },
  },
  {
    id: 'tpl-llm-rewrite',
    name: 'LLM 提示词扩写',
    description: 'Text → LLM 扩写 → Image,让模型先把粗略想法写丰富',
    build() {
      const t = makeNode('text', 0, 0, { text: '一只赛博朋克风格的角色' });
      const llm = makeNode('llm', 1, 0, {
        systemPrompt: '你是图像提示词工程师,把用户的粗略想法扩写成详细的英文 SD 提示词,只输出英文提示词。',
      });
      const img = makeNode('image', 2, 0);
      return {
        nodes: [t, llm, img],
        edges: [makeEdge(t.id, llm.id), makeEdge(llm.id, img.id)],
      };
    },
  },
  {
    id: 'tpl-storyboard',
    name: '三视图分镜',
    description: 'Text → 多角度 3D → 分镜网格,角色多角度展开',
    build() {
      const t = makeNode('text', 0, 0, { text: '一位戴着耳机的少女角色设计' });
      const ma = makeNode('multi-angle-3d', 1, 0, { preset: 'multi-angle-3d' });
      const sb = makeNode('storyboard-grid', 2, 0);
      return {
        nodes: [t, ma, sb],
        edges: [makeEdge(t.id, ma.id), makeEdge(ma.id, sb.id)],
      };
    },
  },
  {
    id: 'tpl-suno',
    name: 'AI 音频',
    description: 'Text → Suno 音频,从歌词到音乐',
    build() {
      const t = makeNode('text', 0, 0, {
        text: '[Verse]\n月光洒在海面上\n角色在跳舞\n\n[Chorus]\n冰冷的世界 温暖的心',
      });
      const a = makeNode('audio', 1, 0);
      return { nodes: [t, a], edges: [makeEdge(t.id, a.id)] };
    },
  },
];
