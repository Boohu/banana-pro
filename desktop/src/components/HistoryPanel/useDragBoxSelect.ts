import { useCallback, useEffect, useRef, useState } from 'react';
import { useHistoryStore } from '../../store/historyStore';

interface DragBoxState {
  startX: number; // 相对容器
  startY: number;
  initialIds: Set<string>;
  additive: boolean;
}

interface DragRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DRAG_THRESHOLD = 5; // px，移动距离小于此值视为点击不启动拖选
const EDGE_AUTO_SCROLL = 24; // 鼠标距容器边缘多少 px 内触发自动滚动
const EDGE_SCROLL_SPEED = 18; // 每帧滚动 px

interface Options {
  /** 是否启用（一般等同于 multiSelectMode） */
  enabled: boolean;
  /** 当前可见图片的有序 id 列表（仅这些 id 可被选中） */
  orderedIds: string[];
  /** 容器 ref（用于计算相对坐标 + 自动滚动） */
  containerRef: React.RefObject<HTMLElement>;
  /** 滚动容器 ref（virtualized list 的 outer element），可与 containerRef 不同 */
  scrollContainerRef?: React.RefObject<HTMLElement>;
}

/**
 * 拖动框选 hook：
 * - 在容器上 mousedown → 开始 drag（仅左键 + 非交互目标）
 * - mousemove 时更新选框 + hit-test 所有 [data-image-id] 元素与选框相交的部分
 * - mouseup 结束
 * - 拖到容器边缘自动滚动（如果提供了 scrollContainerRef）
 *
 * 返回事件 handler 和 dragRect（容器相对坐标，用于绘制选框）
 */
export function useDragBoxSelect({ enabled, orderedIds, containerRef, scrollContainerRef }: Options) {
  const setSelectedImageIds = useHistoryStore((s) => s.setSelectedImageIds);
  const dragStateRef = useRef<DragBoxState | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const orderedIdSetRef = useRef<Set<string>>(new Set(orderedIds));
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    orderedIdSetRef.current = new Set(orderedIds);
  }, [orderedIds]);

  // 鼠标位置（用于自动滚动循环）
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);

  // 命中测试 + 同步 selectedImageIds
  // 关键约束：虚拟列表里不可见的 cell 不在 DOM 中，无法 hit-test。
  // 因此始终保留 initialIds（拖动开始时已选的），只对**当前可见**的 cell 做 add/remove，
  // 不可见的（包括滚出去 / 不在当前页）保持原状不被误清。
  const updateSelection = useCallback(() => {
    const ds = dragStateRef.current;
    const container = containerRef.current;
    if (!ds || !container) return;
    const rect = dragRect;
    if (!rect) return;

    const containerRect = container.getBoundingClientRect();
    const selLeft = containerRect.left + rect.x;
    const selTop = containerRect.top + rect.y;
    const selRight = selLeft + rect.w;
    const selBottom = selTop + rect.h;

    const els = container.querySelectorAll<HTMLElement>('[data-image-id]');
    const hits = new Set<string>();
    const visible = new Set<string>();
    els.forEach((el) => {
      const id = el.dataset.imageId;
      if (!id || !orderedIdSetRef.current.has(id)) return;
      visible.add(id);
      const r = el.getBoundingClientRect();
      if (r.right > selLeft && r.left < selRight && r.bottom > selTop && r.top < selBottom) {
        hits.add(id);
      }
    });

    // 1) 始终以 initialIds 为基底（不在可见区的已选会自然保留）
    const next = new Set(ds.initialIds);

    // 2) 对每个可见 cell 决定 add / remove
    visible.forEach((id) => {
      if (hits.has(id)) {
        next.add(id);
      } else if (!ds.initialIds.has(id)) {
        // 仅清掉那些"本次拖动新加进来但鼠标已挪开"的可见 cell；
        // initialIds 里的已选项即使可见且不在当前框内，也保留（更直觉）。
        next.delete(id);
      }
    });

    setSelectedImageIds(next);
  }, [containerRef, dragRect, setSelectedImageIds]);

  useEffect(() => {
    if (dragStateRef.current && dragRect) {
      updateSelection();
    }
  }, [dragRect, updateSelection]);

  // 自动滚动循环：每帧检查鼠标位置，靠近边缘则滚动
  const tickAutoScroll = useCallback(() => {
    if (!dragStateRef.current) {
      animFrameRef.current = null;
      return;
    }
    const scrollEl = scrollContainerRef?.current;
    const pos = mousePosRef.current;
    if (scrollEl && pos) {
      const r = scrollEl.getBoundingClientRect();
      let dy = 0;
      if (pos.y < r.top + EDGE_AUTO_SCROLL) {
        dy = -EDGE_SCROLL_SPEED * (1 - (pos.y - r.top) / EDGE_AUTO_SCROLL);
      } else if (pos.y > r.bottom - EDGE_AUTO_SCROLL) {
        dy = EDGE_SCROLL_SPEED * (1 - (r.bottom - pos.y) / EDGE_AUTO_SCROLL);
      }
      if (dy !== 0) {
        scrollEl.scrollTop += dy;
        // 触发选框重新 hit-test：选框的 viewport 坐标变化（因 scroll）
        // 我们只需要重新跑 updateSelection；用 setDragRect(prev => prev) 触发依赖
        setDragRect((prev) => (prev ? { ...prev } : prev));
      }
    }
    animFrameRef.current = requestAnimationFrame(tickAutoScroll);
  }, [scrollContainerRef]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled) return;
    if (e.button !== 0) return;
    // 如果点击的是交互元素（按钮 / 链接 / checkbox），让原行为接管
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, [role="button"]')) return;

    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    dragStateRef.current = {
      startX: e.clientX - containerRect.left,
      startY: e.clientY - containerRect.top,
      initialIds: new Set(useHistoryStore.getState().selectedImageIds),
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    };
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    // 阻止文本选择等默认行为
    e.preventDefault();
    if (animFrameRef.current === null) {
      animFrameRef.current = requestAnimationFrame(tickAutoScroll);
    }
  }, [enabled, containerRef, tickAutoScroll]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const x = e.clientX - containerRect.left;
    const y = e.clientY - containerRect.top;
    mousePosRef.current = { x: e.clientX, y: e.clientY };

    const dx = x - ds.startX;
    const dy = y - ds.startY;
    if (!dragRect && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return;
    }
    setDragRect({
      x: Math.min(ds.startX, x),
      y: Math.min(ds.startY, y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    });
  }, [containerRef, dragRect]);

  const onMouseUp = useCallback(() => {
    const had = Boolean(dragStateRef.current && dragRect);
    dragStateRef.current = null;
    mousePosRef.current = null;
    setDragRect(null);
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    // 阻止下一个 click 冒泡（避免拖完一下立即触发 ImageCard 点击）
    if (had) {
      const block = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener('click', block, true);
      };
      window.addEventListener('click', block, true);
    }
  }, [dragRect]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [enabled, onMouseMove, onMouseUp]);

  // 卸载时清理 raf
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, []);

  return { onMouseDown, dragRect, isDragging: Boolean(dragRect) };
}
