import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Check, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

// 裁剪 modal：用户在原图上拉一个矩形，确认后输出该区域的 PNG Blob
// 实现自带，不引入第三方裁剪库
//
// 坐标系：state 里的 crop = { x, y, w, h } 都是「图片像素」坐标（不是屏幕坐标），
// 渲染时按容器自适应缩放（contain）换算成屏幕坐标。

export interface CropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 8 个把手，nw/n/ne/w/e/sw/s/se；每个把手只影响对应边
type Handle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

const MIN_CROP_PX = 16; // 最小裁剪边长（图片像素）

export function RembgCropModal({ file, onCancel, onConfirm }: CropModalProps) {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // 加载文件 → blob URL → 拿到 naturalWidth/Height
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    const img = new Image();
    img.onload = () => {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      setCrop({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 监听容器 resize
  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (el) setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [imgSize]);

  // 显示尺寸 / 偏移（contain）
  const display = (() => {
    if (!imgSize || !containerSize.w || !containerSize.h) return null;
    const scale = Math.min(containerSize.w / imgSize.w, containerSize.h / imgSize.h);
    const dispW = imgSize.w * scale;
    const dispH = imgSize.h * scale;
    return {
      scale,
      dispW,
      dispH,
      offsetX: (containerSize.w - dispW) / 2,
      offsetY: (containerSize.h - dispH) / 2,
    };
  })();

  // 把图片像素坐标换算为屏幕坐标
  const toScreen = (c: CropRect) => {
    if (!display) return { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: display.offsetX + c.x * display.scale,
      top: display.offsetY + c.y * display.scale,
      width: c.w * display.scale,
      height: c.h * display.scale,
    };
  };

  // 拖动主体（平移裁剪框）
  const handleBodyDrag = useCallback((e: React.MouseEvent) => {
    if (!crop || !imgSize || !display) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...crop };
    const onMove = (ev: MouseEvent) => {
      const dxPx = (ev.clientX - startX) / display.scale;
      const dyPx = (ev.clientY - startY) / display.scale;
      let nx = Math.round(orig.x + dxPx);
      let ny = Math.round(orig.y + dyPx);
      nx = Math.max(0, Math.min(imgSize.w - orig.w, nx));
      ny = Math.max(0, Math.min(imgSize.h - orig.h, ny));
      setCrop({ ...orig, x: nx, y: ny });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [crop, imgSize, display]);

  // 拖动把手
  const handleHandleDrag = useCallback((handle: Handle) => (e: React.MouseEvent) => {
    if (!crop || !imgSize || !display) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...crop };
    const onMove = (ev: MouseEvent) => {
      const dxPx = (ev.clientX - startX) / display.scale;
      const dyPx = (ev.clientY - startY) / display.scale;
      let nx = orig.x;
      let ny = orig.y;
      let nw = orig.w;
      let nh = orig.h;
      if (handle.includes('w')) {
        const newX = Math.max(0, Math.min(orig.x + orig.w - MIN_CROP_PX, orig.x + dxPx));
        nw = orig.x + orig.w - newX;
        nx = newX;
      }
      if (handle.includes('e')) {
        const newW = Math.max(MIN_CROP_PX, Math.min(imgSize.w - orig.x, orig.w + dxPx));
        nw = newW;
      }
      if (handle.includes('n')) {
        const newY = Math.max(0, Math.min(orig.y + orig.h - MIN_CROP_PX, orig.y + dyPx));
        nh = orig.y + orig.h - newY;
        ny = newY;
      }
      if (handle.includes('s')) {
        const newH = Math.max(MIN_CROP_PX, Math.min(imgSize.h - orig.y, orig.h + dyPx));
        nh = newH;
      }
      setCrop({
        x: Math.round(nx),
        y: Math.round(ny),
        w: Math.round(nw),
        h: Math.round(nh),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [crop, imgSize, display]);

  // 重置到全图
  const handleReset = () => {
    if (imgSize) setCrop({ x: 0, y: 0, w: imgSize.w, h: imgSize.h });
  };

  // 确认 → canvas crop → blob → File
  const handleConfirm = async () => {
    if (!crop || !imgSize) return;
    if (crop.w === imgSize.w && crop.h === imgSize.h && crop.x === 0 && crop.y === 0) {
      // 没改裁剪：直接用原 file
      onConfirm(file);
      return;
    }
    const img = new Image();
    img.src = imageUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    const cropped = new File([blob], `${baseName}-crop.png`, { type: 'image/png' });
    onConfirm(cropped);
  };

  const screenRect = crop ? toScreen(crop) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85"
      onClick={onCancel}
    >
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-medium text-white">裁剪区域</div>
        <div className="flex items-center gap-2 text-xs text-white/70">
          {crop && imgSize && (
            <>
              <span className="font-mono">
                {crop.w} × {crop.h}
              </span>
              <span>·</span>
              <span className="font-mono">
                {Math.round((crop.w * crop.h * 100) / (imgSize.w * imgSize.h))}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 图片 */}
        {display && imageUrl && (
          <img
            src={imageUrl}
            alt="source"
            draggable={false}
            className="absolute pointer-events-none select-none"
            style={{
              left: display.offsetX,
              top: display.offsetY,
              width: display.dispW,
              height: display.dispH,
            }}
          />
        )}

        {/* 暗色蒙版（裁剪框外） — 用 4 个矩形覆盖 */}
        {display && screenRect && (
          <>
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{ left: 0, top: 0, right: 0, height: screenRect.top }}
            />
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{ left: 0, top: screenRect.top + screenRect.height, right: 0, bottom: 0 }}
            />
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{ left: 0, top: screenRect.top, width: screenRect.left, height: screenRect.height }}
            />
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{
                left: screenRect.left + screenRect.width,
                top: screenRect.top,
                right: 0,
                height: screenRect.height,
              }}
            />
          </>
        )}

        {/* 裁剪框 */}
        {screenRect && (
          <div
            className="absolute border-2 border-primary cursor-move"
            style={{
              left: screenRect.left,
              top: screenRect.top,
              width: screenRect.width,
              height: screenRect.height,
            }}
            onMouseDown={handleBodyDrag}
          >
            {/* 三分线（参考线） */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-0 right-0 top-1/3 h-px bg-white/30" />
              <div className="absolute left-0 right-0 top-2/3 h-px bg-white/30" />
              <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/30" />
              <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/30" />
            </div>
            {/* 8 个把手 */}
            {(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as Handle[]).map((h) => (
              <div
                key={h}
                onMouseDown={handleHandleDrag(h)}
                className={cn(
                  'absolute w-3 h-3 bg-primary border border-white rounded-sm',
                  h === 'nw' && 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
                  h === 'n' && 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
                  h === 'ne' && 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
                  h === 'w' && 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
                  h === 'e' && 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
                  h === 'sw' && 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
                  h === 's' && 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
                  h === 'se' && 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/80 hover:bg-white/10 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          重置全图
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/80 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Check className="w-4 h-4" />
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  );
}
