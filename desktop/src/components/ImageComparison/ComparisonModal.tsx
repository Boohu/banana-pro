import React, { useState, useRef, useCallback } from 'react';
import { X, Columns2, Maximize, Download, Copy, RefreshCw, ImagePlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getImageUrl } from '@/services/api';
import { useConfigStore } from '@/store/configStore';
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

function ImageSlider({ leftSrc, rightSrc }: { leftSrc: string; rightSrc: string }) {
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
        原图
      </div>
      <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/60 text-xs font-semibold text-white">
        生成结果
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

function RefImagesSection() {
  const { t } = useTranslation();
  const refFiles = useConfigStore((s) => s.refFiles);
  if (refFiles.length === 0) return null;
  return (
    <>
      <div className="h-px bg-border my-4" />
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-fg-primary">{t('参考图', '参考图')}（{refFiles.length} 张）</h4>
        <div className="flex gap-2">
          {refFiles.map((file, i) => (
            <div key={i} className="w-16 h-16 rounded-lg overflow-hidden bg-surface-tertiary shrink-0">
              <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function ComparisonModal({ image, onClose, originalImageUrl, onPrev, onNext, onRegenerate, onUseAsRef }: ComparisonModalProps) {
  const { t } = useTranslation();
  const refFiles = useConfigStore((s) => s.refFiles);
  // 原图来源：外部传入 > configStore 参考图 > 无
  const hasOriginal = Boolean(originalImageUrl) || refFiles.length > 0;
  const [viewMode, setViewMode] = useState<ViewMode>(hasOriginal ? 'compare' : 'result');

  const imageUrl = image.url || getImageUrl(image.filePath);
  // 对比原图
  const [refObjectUrl, setRefObjectUrl] = useState<string | null>(null);
  React.useEffect(() => {
    if (originalImageUrl) {
      setRefObjectUrl(null); // 外部传入时不需要 objectUrl
      return;
    }
    if (refFiles.length > 0) {
      const url = URL.createObjectURL(refFiles[0]);
      setRefObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setRefObjectUrl(null);
  }, [refFiles, originalImageUrl]);
  const originalUrl = originalImageUrl || refObjectUrl || imageUrl;

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
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 从 URL 提取实际文件后缀
      const ext = imageUrl.match(/\.\w+$/)?.[0] || '.png';
      a.download = `generated-${image.id}${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
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
              {t('对比', '对比')}
            </button>
            <button
              onClick={() => setViewMode('result')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors',
                viewMode === 'result' ? 'bg-primary/15 text-primary' : 'text-fg-muted hover:text-fg-secondary'
              )}
            >
              <Maximize className="w-3.5 h-3.5" />
              {t('结果大图', '结果大图')}
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
              <ImageSlider leftSrc={originalUrl} rightSrc={imageUrl} />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-4">
                <img src={imageUrl} alt="result" className="max-w-full max-h-full object-contain rounded-lg" />
              </div>
            )}
          </div>
        </div>

        {/* Right: details */}
        <div className="w-80 shrink-0 flex flex-col p-6 overflow-y-auto border-l border-border">
          <h3 className="text-base font-semibold text-fg-primary mb-4">{t('图片详情', '图片详情')}</h3>

          {/* Info rows */}
          <div className="space-y-2.5 text-sm">
            {image.width > 0 && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('尺寸', '尺寸')}</span>
                <span className="text-fg-primary font-mono">{image.width} × {image.height}</span>
              </div>
            )}
            {image.fileSize > 0 && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('文件大小', '文件大小')}</span>
                <span className="text-fg-primary font-mono">{(image.fileSize / 1024 / 1024).toFixed(1)} MB</span>
              </div>
            )}
            {image.mimeType && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('格式', '格式')}</span>
                <span className="text-fg-primary">{image.mimeType.split('/')[1]?.toUpperCase()}</span>
              </div>
            )}
            {image.createdAt && (
              <div className="flex justify-between">
                <span className="text-fg-muted">{t('生成时间', '生成时间')}</span>
                <span className="text-fg-primary text-xs">{new Date(image.createdAt).toLocaleString('zh-CN')}</span>
              </div>
            )}
          </div>

          {/* Reference images */}
          <RefImagesSection />

          {/* Prompt */}
          {image.prompt && (
            <>
              <div className="h-px bg-border my-4" />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-fg-primary">{t('使用的提示词', '使用的提示词')}</h4>
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
                {t('保存', '保存')}
              </button>
              <button onClick={handleCopy} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors">
                <Copy className="w-4 h-4" />
                {copySuccess ? t('已复制', '已复制') : t('复制提示词', '复制提示词')}
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
                {t('重新生成', '重新生成')}
              </button>
              <button
                onClick={handleUseAsRef}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-surface-tertiary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
                {t('用作参考图', '用作参考图')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
