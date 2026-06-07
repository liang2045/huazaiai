import { useCallback, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';

/**
 * 画布撤销/重做历史栈
 * - 不直接接管 nodes/edges 的 useState,而是提供 capture / undo / redo 接口
 * - 由 Canvas.tsx 在合适时机调用 capture(防抖、拖拽结束等)
 * - 容量上限 50 步,超出后丢弃最旧
 */

export interface CanvasSnapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

function clone(s: CanvasSnapshot): CanvasSnapshot {
  // structuredClone 可用于复杂对象(包含 data 的任意结构)
  if (typeof structuredClone === 'function') {
    return structuredClone(s);
  }
  return JSON.parse(JSON.stringify(s));
}

function equal(a: CanvasSnapshot | null, b: CanvasSnapshot | null) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useCanvasHistory(
  applySnapshot: (snap: CanvasSnapshot) => void
) {
  const pastRef = useRef<CanvasSnapshot[]>([]);
  const futureRef = useRef<CanvasSnapshot[]>([]);
  const lastRef = useRef<CanvasSnapshot | null>(null);
  // 是否正在执行 undo/redo,防止 capture 二次入栈
  const restoringRef = useRef(false);
  const [, setVersion] = useState(0);

  const reset = useCallback((init?: CanvasSnapshot) => {
    pastRef.current = [];
    futureRef.current = [];
    lastRef.current = init ? clone(init) : null;
    setVersion((v) => v + 1);
  }, []);

  /**
   * 主动捕获一帧历史。
   * 内部会与 lastRef 比对,变化才入栈;一次 capture 同时会清空 future 栈。
   */
  const capture = useCallback((snap: CanvasSnapshot) => {
    if (restoringRef.current) return;
    if (equal(lastRef.current, snap)) return;
    if (lastRef.current) {
      pastRef.current.push(clone(lastRef.current));
      if (pastRef.current.length > MAX_HISTORY) {
        pastRef.current.shift();
      }
    }
    lastRef.current = clone(snap);
    futureRef.current = [];
    setVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prev = pastRef.current.pop()!;
    if (lastRef.current) {
      futureRef.current.push(clone(lastRef.current));
    }
    lastRef.current = clone(prev);
    restoringRef.current = true;
    try {
      applySnapshot(clone(prev));
    } finally {
      // 等下一帧再放开,避免因 setNodes 同步触发的 capture
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    }
    setVersion((v) => v + 1);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop()!;
    if (lastRef.current) {
      pastRef.current.push(clone(lastRef.current));
    }
    lastRef.current = clone(next);
    restoringRef.current = true;
    try {
      applySnapshot(clone(next));
    } finally {
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    }
    setVersion((v) => v + 1);
  }, [applySnapshot]);

  return {
    capture,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
