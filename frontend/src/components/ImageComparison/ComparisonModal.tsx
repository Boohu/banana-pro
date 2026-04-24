import React, { useState, useRef, useCallback } from 'react';
import { X, Columns2, Maximize, Download, Copy, RefreshCw, ImagePlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getImageUrl } from '@/services/api';
import { useConfigStore } from '@/store/configStore';
import { toast } from '@/store/toastStore';
import type { GeneratedImage } from '@/types';

type ViewMode = 'compare' | 'result';

interface ComparisonModalProps {
  image: GeneratedImage;
  onClose: () => void;
  originalImageUrl?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onRegenerate?: () => void;
  onUseAsRef?: () => void;
}

function ImageSlider({ leftSrc, rightSrc, leftLabel, rightLabel }: { leftSrc: string; rightSrc: string; leftLabel?: string; rightLabel?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const dragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current || !dragging.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pos);
  }, []);

  const handleMouseDown = () => { dragging.current = true; };
  const handleMouseUp = () => { dragging.current = false; };
  const handleMouseMove = (e: React.MouseEvent) => handleMove(e.clientX);
  const handleTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden cursor-col-resize select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    >
      {/* Right (result) - full background */}
      <img src={rightSrc} alt="result" className="absolute inset-0 w-full h-full object-contain" />

      {/* Left (original) - clipped */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
        <img src={leftSrc} alt="original" className="absolute inset-0 w-full h-full object-contain" style={{ width: containerRef.current?.offsetWidth || '100%' }} />
      </div>

      {/* Labels */}
      <div className="absolute top-4 left-4 px-3 py-1.5 rounded-lg bg-black/60 text-xs font-semibold text-white">
        {leftLabel || 'Original'}
      </div>
      <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/60 text-xs font-semibold text-white">
        {rightLabel || 'Generated'}
      </div>

      {/* Slider line */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${sliderPos}%` }} />

      {/* Slider handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing z-10"
        style={{ left: `${sliderPos}%` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
      >
        <Columns2 className="w-4 h-4 text-gray-700" />
      </div>
    </div>
  );
}

function RefImagesSection({ image }: { image?: GeneratedImage }) {
  const { t } = useTranslation();
  // 当查看一个具体任务时，只看该任务自带的参考图；没有就什么都不显示
  // 不要 fallback 到 configStore.refFiles（那是下一次生成的参考图，和当前查看的任务无关）
  const taskOriginalUrl = (image as any)?.originalImageUrl ||
    ((image as any)?.originalImagePath ? getImageUrl((image as any).originalImagePath) : '');

  if (!taskOriginalUrl) return null;

  return (
    <>
      <div className="h-px bg-border my-4" />
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-fg-primary">{t('comparison.refImages')}（1 张）</h4>
        <div className="flex gap-2">
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-surface-tertiary shrink-0">
            <img src={taskOriginalUrl} alt="" className="w-full h-full object-cover" />
          </div>
        </div>
      </div>
    </>
  );
}

export function ComparisonModal({ image, onClose, originalImageUrl, onPrev, onNext, onRegenerate, onUseAsRef }: ComparisonModalProps) {
  const { t } = useTranslation();
  // 原图来源：外部 prop > 任务自带（image.originalImageUrl/Path） > 无
  // 不再 fallback 到 configStore.refFiles（那属于下次生成的配置，和当前查看的任务无关）
  const taskOriginalUrl = (image as any).originalImageUrl || ((image as any).originalImagePath ? getImageUrl((image as any).originalImagePath) : '');
  const effectiveOriginalUrl = originalImageUrl || taskOriginalUrl || '';
  const hasOriginal = Boolean(effectiveOriginalUrl);
  const [viewMode, setViewMode] = useState<ViewMode>(hasOriginal ? 'compare' : 'result');

  const imageUrl = image.url || getImageUrl(image.filePath);
  const originalUrl = effectiveOriginalUrl || imageUrl;

  // 键盘快捷键：左右切换
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPrev, onNext, onClose]);

  const [copySuccess, setCopySuccess] = useState(false);

  const handleDownload = async () => {
    if (!imageUrl) return;
    const ext = imageUrl.match(/\.\w+$/)?.[0] || '.png';
    const defaultName = `generated-${image.id}${ext}`;
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

    if (isTauri) {
      // 桌面端：Tauri 原生保存对话框 + 记忆上次目录
      try {
        // @ts-ignore Tauri 运行时解析
        const { save } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
        const lastDir = localStorage.getItem('banana-last-save-dir') || '';
        const defaultPath = lastDir ? `${lastDir}/${defaultName}` : defaultName;
        const destPath = await save({
          defaultPath,
          filters: [{ name: 'Image', extensions: [ext.replace('.', '')] }],
          title: '保存图片',
        });
        if (!destPath) return; // 用户取消

        // 根据 url 分流：
        // - 公网 http(s) URL → invoke download_file_to_path (Rust reqwest 更稳)
        // - 本地资源（asset://, http://asset.localhost, http://tauri.localhost, blob:, data: 等）
        //   → 前端 fetch blob → Tauri fs writeFile
        //   注意：macOS 的 Tauri 用 asset://localhost/...，Windows 的 WebView2 用 http://asset.localhost/...
        const isLocalAsset =
          /^(asset:|tauri:|blob:|data:)/i.test(imageUrl) ||
          /^https?:\/\/(asset|tauri)\.localhost(\/|$|:)/i.test(imageUrl);
        const isRemoteHttp = !isLocalAsset && /^https?:\/\//i.test(imageUrl);
        if (isRemoteHttp) {
          // @ts-ignore
          const { invoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
          await invoke('download_file_to_path', { url: imageUrl, destPath });
        } else {
          const res = await fetch(imageUrl);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const bytes = new Uint8Array(await (await res.blob()).arrayBuffer());
          // @ts-ignore
          const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
          await writeFile(destPath as string, bytes);
        }

        // 记录上次目录（兼容 / 和 \ 分隔符）
        const dir = String(destPath).replace(/\/[^/]+$/, '').replace(/\\[^\\]+$/, '');
        if (dir) localStorage.setItem('banana-last-save-dir', dir);
        toast.success('已保存到 ' + destPath);
      } catch (err) {
        console.error('[ComparisonModal] 保存失败:', err);
        toast.error('保存失败：' + (err instanceof Error ? err.message : String(err)));
      }
      return;
    }

    // Web 端：浏览器下载
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ComparisonModal] 下载失败:', err);
      toast.error('下载失败');
    }
  };

  const handleCopy = async () => {
    const prompt = image.prompt || '';
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    } catch (err) {
      console.error('[ComparisonModal] 复制提示词失败:', err);
    }
  };

  const handleUseAsRef = async () => {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const refExt = imageUrl.match(/\.\w+$/)?.[0] || '.png';
      const file = new File([blob], `generated-${image.id}${refExt}`, { type: blob.type });
      useConfigStore.getState().addRefFiles([file]);
      onClose();
      // 如果有外部回调也调一下
      onUseAsRef?.();
    } catch (err) {
      console.error('[ComparisonModal] 用作参考图失败:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-surface-secondary rounded-2xl w-[1100px] max-w-[90vw] h-[720px] max-h-[85vh] flex overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Left: comparison area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center gap-3 px-5 py-3">
            <button
              onClick={() => setViewMode('compare')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors',
                viewMode === 'compare' ? 'bg-primary/15 text-primary' : 'text-fg-muted hover:text-fg-secondary'
              )}
            >
              <Columns2 className="w-3.5 h-3.5" />
              {t('comparison.compare')}
            </button>
            <button
              onClick={() => setViewMode('result')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors',
                viewMode === 'result' ? 'bg-primary/15 text-primary' : 'text-fg-muted hover:text-fg-secondary'
              )}
            >
              <Maximize className="w-3.5 h-3.5" />
              {t('comparison.result')}
            </button>
            <div className="flex-1" />
            {/* 上一张/下一张 */}
            {(onPrev || onNext) && (
              <div className="flex items-center gap-1">
                <button
                  onClick={onPrev}
                  disabled={!onPrev}
                  className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-fg-secondary hover:text-fg-primary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={onNext}
                  disabled={!onNext}
                  className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-fg-secondary hover:text-fg-primary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-fg-secondary hover:text-fg-primary">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Image area */}
          <div className="flex-1 min-h-0 bg-surface-primary">
            {viewMode === 'compare' ? (
              <ImageSlider leftSrc={originalUrl} rightSrc={imageUrl} leftLabel={t('comparison.original')} rightLabel={t('comparison.generated')} />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-4">
                <img src={imageUrl} alt="result" className="max-w-full max-h-full object-contain rounded-lg" />
              </div>
            )}
          </div>
        </div>

        {/* Right: details */}
        <div className="w-80 shrink-0 flex flex-col p-6 overflow-y-auto border-l border-border">
          <h3 className="text-base font-semibold text-fg-primary mb-4">{t('comparison.imageDetails')}</h3>

          {/* Info rows */}
          <div className="space-y-2.5 text-sm">
            {image.width > 0 && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('comparison.dimensions')}</span>
                <span className="text-fg-primary font-mono">{image.width} × {image.height}</span>
              </div>
            )}
            {image.fileSize > 0 && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('comparison.fileSize')}</span>
                <span className="text-fg-primary font-mono">{(image.fileSize / 1024 / 1024).toFixed(1)} MB</span>
              </div>
            )}
            {image.mimeType && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('comparison.format')}</span>
                <span className="text-fg-primary">{image.mimeType.split('/')[1]?.toUpperCase()}</span>
              </div>
            )}
            {image.createdAt && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('comparison.generatedAt')}</span>
                <span className="text-fg-primary text-xs">{new Date(image.createdAt).toLocaleString('zh-CN')}</span>
              </div>
            )}
          </div>

          {/* Reference images */}
          <RefImagesSection image={image} />

          {/* Prompt */}
          {image.prompt && (
            <>
              <div className="h-px bg-border my-4" />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-fg-primary">{t('comparison.usedPrompt')}</h4>
                <div className="bg-surface-tertiary rounded-lg p-3">
                  <p className="text-xs text-fg-secondary leading-relaxed break-words">{image.prompt}</p>
                </div>
              </div>
            </>
          )}

          <div className="flex-1" />

          {/* Actions */}
          <div className="h-px bg-border my-4" />
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                <Download className="w-4 h-4" />
                {t('comparison.save')}
              </button>
              <button onClick={handleCopy} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors">
                <Copy className="w-4 h-4" />
                {copySuccess ? t('comparison.copied') : t('comparison.copyPrompt')}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { onRegenerate?.(); onClose(); }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm transition-colors',
                  onRegenerate ? 'text-fg-secondary hover:text-fg-primary cursor-pointer' : 'text-fg-muted/50 cursor-not-allowed'
                )}
                disabled={!onRegenerate}
              >
                <RefreshCw className="w-4 h-4" />
                {t('comparison.regenerate')}
              </button>
              <button
                onClick={handleUseAsRef}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
                {t('comparison.useAsRef')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
