/**
 * 滚轮拦截工具 —— 阻止节点内可滚动元素（input / textarea / select / [contenteditable]）
 * 上的 wheel 事件冒泡到 ReactFlow 画布，避免触发画布缩放，让用户能在文本框内
 * 用鼠标滚轮自然滚动文本内容。
 *
 * 设计原则：
 * - 只在元素自身上挂 listener（capture + bubble 双拦截）
 * - 仅 stopPropagation()，不 preventDefault()，保证浏览器原生滚动行为不丢
 * - 同元素只挂一次（用 __wheelBlocked 标记位）
 */

const WHEEL_FLAG = '__wheelBlocked';

export function attachWheelBlock(el: HTMLElement | null) {
  if (!el) return;
  if ((el as any)[WHEEL_FLAG]) return;
  (el as any)[WHEEL_FLAG] = true;
  const handler = (e: WheelEvent) => {
    e.stopPropagation();
  };
  el.addEventListener('wheel', handler, { passive: false, capture: false });
  el.addEventListener('wheel', handler, { passive: false, capture: true });
}

/**
 * 选择器：所有需要拦截 wheel 的元素类型。
 * 注意 select 也加入：浏览器在 select 上滚轮会切换选项，但同样会冒泡触发画布缩放。
 */
const TARGET_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/**
 * 给容器内当前已存在的目标元素全部挂上 wheel 拦截。
 */
function attachExisting(root: ParentNode) {
  const list = root.querySelectorAll<HTMLElement>(TARGET_SELECTOR);
  list.forEach(attachWheelBlock);
}

/**
 * 在画布根节点上安装一个 MutationObserver，自动给所有节点（含未来增删的）
 * 内部的 input / textarea / select / contenteditable 元素挂载 wheel 拦截。
 *
 * 返回一个清理函数，组件卸载时调用以断开监听。
 */
export function installGlobalWheelBlockObserver(root: HTMLElement | Document = document): () => void {
  // 先处理已有元素
  attachExisting(root);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        // 节点本体若就是目标
        if (n.matches?.(TARGET_SELECTOR)) attachWheelBlock(n);
        // 节点内部的目标
        attachExisting(n);
      });
    }
  });

  const target: Node = root instanceof Document ? root.body : root;
  observer.observe(target, { childList: true, subtree: true });

  return () => observer.disconnect();
}
