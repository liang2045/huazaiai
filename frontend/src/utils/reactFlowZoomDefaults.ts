import { ReactFlow } from '@xyflow/react';

// ReactFlow 默认缩放范围偏窄；真实分辨率图片按 naturalWidth/naturalHeight 显示后，
// 2K/4K 图像需要更大的缩放范围才能在画布中舒适编排。
// 这里在应用入口最早执行，给所有未显式设置 minZoom/maxZoom 的 ReactFlow 实例注入默认值。
const currentDefaults = (ReactFlow as any).defaultProps || {};

(ReactFlow as any).defaultProps = {
  ...currentDefaults,
  minZoom: currentDefaults.minZoom ?? 0.01,
  maxZoom: currentDefaults.maxZoom ?? 4,
  zoomOnScroll: currentDefaults.zoomOnScroll ?? true,
  zoomOnPinch: currentDefaults.zoomOnPinch ?? true,
};
