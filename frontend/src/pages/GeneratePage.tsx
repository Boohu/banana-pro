import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Wand2, X, Plus, Loader2, AlertCircle, ImagePlus, ChevronDown, Info, Grid3X3, List, ChevronUp, FileJson, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConfigStore, getModelAspectRatios, getModelResolutions, modelSupportsAutoRatio, GPT_IMAGE_SIZE_OPTIONS, GPT_IMAGE_SIZE_OPTIONS_EDIT } from '@/store/configStore';
import { useModelStore } from '@/store/modelStore';
import { useApiKeyStore } from '@/store/apiKeyStore';
import { useGenerateStore } from '@/store/generateStore';
import { useGenerate } from '@/hooks/useGenerate';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { ImageGrid } from '@/components/GenerateArea/ImageGrid';
import { ProgressBar } from '@/components/GenerateArea/ProgressBar';
import { ComparisonModal } from '@/components/ImageComparison/ComparisonModal';
import { BatchActions } from '@/components/GenerateArea/BatchActions';
import { TaskQueuePanel } from '@/components/TaskQueue/TaskQueuePanel';
import { optimizePrompt } from '@/services/promptApi';
import { resolveActiveModel, syncActiveModelToBackend } from '@/services/activeModel';
import { getImageUrl } from '@/services/api';
import { toast } from '@/store/toastStore';
import type { GeneratedImage } from '@/types';

// ---- Left Config Panel (next to sidebar) ----
function LeftConfigPanel() {
  const { t } = useTranslation();
  const {
    prompt, setPrompt,
    imageModel, setImageModel, imageApiKey, imageSize, setImageSize,
    count, setCount,
    aspectRatio, setAspectRatio,
    refFiles, removeRefFile,
    enableRefImageCompression, setEnableRefImageCompression,
    selectedImageModelId, setSelectedImageModelId,
    imageQuality, setImageQuality,
    imageBackground, setImageBackground,
    imageOutputFormat, setImageOutputFormat,
    imageOutputCompression, setImageOutputCompression,
    gptImageSize, setGptImageSize,
  } = useConfigStore(useShallow((s) => ({
    prompt: s.prompt,
    setPrompt: s.setPrompt,
    imageModel: s.imageModel,
    setImageModel: s.setImageModel,
    imageApiKey: s.imageApiKey,
    imageSize: s.imageSize,
    setImageSize: s.setImageSize,
    count: s.count,
    setCount: s.setCount,
    aspectRatio: s.aspectRatio,
    setAspectRatio: s.setAspectRatio,
    refFiles: s.refFiles,
    removeRefFile: s.removeRefFile,
    enableRefImageCompression: s.enableRefImageCompression,
    setEnableRefImageCompression: s.setEnableRefImageCompression,
    selectedImageModelId: s.selectedImageModelId,
    setSelectedImageModelId: s.setSelectedImageModelId,
    imageQuality: s.imageQuality,
    setImageQuality: s.setImageQuality,
    imageBackground: s.imageBackground,
    setImageBackground: s.setImageBackground,
    imageOutputFormat: s.imageOutputFormat,
    setImageOutputFormat: s.setImageOutputFormat,
    imageOutputCompression: s.imageOutputCompression,
    setImageOutputCompression: s.setImageOutputCompression,
    gptImageSize: s.gptImageSize,
    setGptImageSize: s.setGptImageSize,
  })));
  // 订阅 chat 选择 + legacy 字段，让 chatReady 计算保持响应式
  const selectedChatModelId = useConfigStore((s) => s.selectedChatModelId);
  const chatApiKey = useConfigStore((s) => s.chatApiKey);
  const allModels = useModelStore((s) => s.models);
  const apiKeys = useApiKeyStore((s) => s.keys);
  const imageModels = useMemo(() => allModels.filter((m) => m.purpose === 'image'), [allModels]);
  const { generate } = useGenerate();
  const isSubmitting = useGenerateStore((s) => s.isSubmitting);
  const status = useGenerateStore((s) => s.status);
  const isGenerating = isSubmitting; // 只在提交请求时禁用，生成中允许提交新任务
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizingMode, setOptimizingMode] = useState<'normal' | 'json' | null>(null);
  const aspectRatios = getModelAspectRatios(imageModel);

  // 当前选中模型（配合密钥检查）
  const activeModel = useMemo(() => {
    if (!selectedImageModelId) return null;
    return imageModels.find((m) => m.id === selectedImageModelId) || null;
  }, [selectedImageModelId, imageModels]);
  const activeKey = useMemo(() => {
    if (!activeModel) return null;
    return apiKeys.find((k) => k.id === activeModel.apiKeyId) || null;
  }, [activeModel, apiKeys]);
  // 是否已配置可用的密钥：新架构优先，旧 imageApiKey 作为 fallback
  const isImageReady = Boolean((activeModel && activeKey?.apiKey) || imageApiKey);

  // chat（提示词优化）是否就绪：新架构 selectedChatModelId 优先，旧扁平字段 fallback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isChatReady = useMemo(() => Boolean(resolveActiveModel('chat')), [selectedChatModelId, chatApiKey, allModels, apiKeys]);

  // 当前模型名（用于过滤 aspect/resolution 选项）
  const activeModelName = activeModel?.name || imageModel;
  const resolutions = useMemo(() => getModelResolutions(activeModelName, refFiles.length > 0), [activeModelName, refFiles.length]);
  // 图生图 + 支持自动比例的模型 → aspectRatio 前加 'auto'
  const displayAspectRatios = useMemo(() => {
    const base = aspectRatios;
    if (refFiles.length > 0 && modelSupportsAutoRatio(activeModelName)) {
      return ['auto', ...base];
    }
    return base;
  }, [aspectRatios, refFiles.length, activeModelName]);

  // 模型/参考图切换后，保证当前 aspectRatio/imageSize 在合法集合里
  useEffect(() => {
    if (!displayAspectRatios.includes(aspectRatio)) {
      setAspectRatio(displayAspectRatios[0]);
    }
    if (!resolutions.includes(imageSize)) {
      setImageSize(resolutions[0]);
    }
  }, [displayAspectRatios, resolutions, aspectRatio, imageSize, setAspectRatio, setImageSize]);

  // 从「无参考图」→「有参考图」的瞬间：自动切到 auto（仅当模型支持）
  const prevHasRefRef = useRef(refFiles.length > 0);
  useEffect(() => {
    const hasRef = refFiles.length > 0;
    if (hasRef && !prevHasRefRef.current && modelSupportsAutoRatio(activeModelName)) {
      setAspectRatio('auto');
    }
    prevHasRefRef.current = hasRef;
  }, [refFiles.length, activeModelName, setAspectRatio]);

  // 选择透明背景时自动切到 PNG（JPEG 不支持透明，强制联动避免出空响应或白底图）
  useEffect(() => {
    if (imageBackground === 'transparent' && imageOutputFormat === 'jpeg') {
      setImageOutputFormat('png');
    }
  }, [imageBackground, imageOutputFormat, setImageOutputFormat]);

  const handleSelectImageModel = (id: string) => {
    setSelectedImageModelId(id);
    const m = imageModels.find((mm) => mm.id === id);
    if (m) setImageModel(m.name); // 双写，让其他未迁移代码继续读到正确模型名
  };

  const runOptimize = async (mode: 'normal' | 'json') => {
    const raw = prompt.trim();
    if (!raw) { toast.error('请先输入提示词'); return; }
    if (isOptimizing) return;

    // 优先用「模型管理」里 chat purpose 的活跃模型；没有则 fallback 到旧的扁平字段
    const resolved = resolveActiveModel('chat');
    if (!resolved) {
      toast.error('请先在设置中配置提示词优化（chat）模型');
      return;
    }

    setIsOptimizing(true);
    setOptimizingMode(mode);
    try {
      // 把当前活跃模型的 base/key/timeout 同步到后端 ProviderConfig
      const synced = await syncActiveModelToBackend('chat');
      if (!synced) {
        toast.error('提示词优化模型同步失败');
        return;
      }
      const res = await optimizePrompt({
        provider: synced.provider,
        model: synced.modelId,
        prompt: raw,
        response_format: mode === 'json' ? 'json' : undefined,
      });
      let nextPrompt = String(res?.prompt || '').trim();
      if (!nextPrompt) { toast.error('优化结果为空'); return; }
      if (mode === 'json') {
        try { nextPrompt = JSON.stringify(JSON.parse(nextPrompt), null, 2); } catch {}
      }
      setPrompt(nextPrompt);
      toast.success('提示词已优化');
    } catch (error: any) {
      const status = error?.response?.status;
      const backendMsg = error?.response?.data?.message || '';
      if (status === 400) {
        if (backendMsg.includes('Provider') || backendMsg.includes('provider') || backendMsg.includes('API Key')) {
          toast.error('请先在设置 → API 配置中配置提示词优化 API，并确保 API Key 正确');
        } else if (backendMsg.includes('model') || backendMsg.includes('模型')) {
          toast.error('提示词优化模型不可用，请在设置中检查模型名称');
        } else {
          toast.error(backendMsg || '请求参数错误，请检查提示词优化 API 配置');
        }
      } else if (status === 401 || status === 403) {
        toast.error('API Key 无效或已过期');
      } else {
        toast.error(backendMsg || error?.message || '优化失败，请检查网络和配置');
      }
    } finally {
      setIsOptimizing(false);
      setOptimizingMode(null);
    }
  };

  return (
    <aside className="w-80 shrink-0 bg-surface-secondary border-x border-border flex flex-col overflow-y-auto">
      <div className="flex flex-col gap-3.5 p-[18px] flex-1">
        <h3 className="text-[15px] font-semibold text-fg-primary">{t('config.title', '生成配置')}</h3>

        {/* Prompt */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-fg-secondary">{t('prompt.label', '提示词')}</label>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => runOptimize('normal')}
                disabled={isOptimizing}
                title={t('prompt.optimize', '优化提示词')}
                className={cn('p-1.5 rounded-lg transition-colors', isOptimizing ? 'opacity-50' : 'hover:bg-surface-tertiary')}
              >
                {isOptimizing && optimizingMode === 'normal' ? (
                  <Loader2 className="w-[18px] h-[18px] animate-spin text-primary" />
                ) : (
                  <Sparkles className="w-[18px] h-[18px] text-primary" />
                )}
              </button>
              <button
                onClick={() => runOptimize('json')}
                disabled={isOptimizing}
                title={t('prompt.optimizeJson', 'JSON 格式优化')}
                className={cn('p-1.5 rounded-lg transition-colors', isOptimizing ? 'opacity-50' : 'hover:bg-surface-tertiary')}
              >
                {isOptimizing && optimizingMode === 'json' ? (
                  <Loader2 className="w-[18px] h-[18px] animate-spin text-primary" />
                ) : (
                  <FileJson className="w-[18px] h-[18px] text-primary" />
                )}
              </button>
              {prompt && (
                <button
                  onClick={() => setPrompt('')}
                  title={t('清空', '清空')}
                  className="p-1.5 rounded-lg hover:bg-surface-tertiary transition-colors"
                >
                  <X className="w-[18px] h-[18px] text-fg-muted" />
                </button>
              )}
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey) && isImageReady && prompt.trim()) {
                e.preventDefault();
                generate();
              }
            }}
            placeholder={t('prompt.placeholder', '描述你想要生成的图片，例如：一只在星空下漫步的猫咪，赛博朋克风格...')}
            className="w-full h-44 rounded-[10px] bg-surface-tertiary border border-border px-3.5 py-3 text-[13px] text-fg-primary placeholder:text-fg-muted outline-none resize-none focus:border-primary transition-colors scrollbar-thin"
          />
        </div>

        {/* Reference images */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-fg-secondary">{t('参考图', '参考图')}</label>
            <span className="text-[11px] text-fg-muted">{refFiles.length} / 10</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {refFiles.map((file, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => removeRefFile(i)}
                  className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5 text-white" />
                </button>
              </div>
            ))}
            {refFiles.length < 10 && (
              <label className="aspect-square rounded-lg border border-dashed border-border bg-surface-tertiary flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-fg-muted transition-colors">
                <Plus className="w-4 h-4 text-fg-muted" />
                <span className="text-[9px] text-fg-muted">{t('添加', '添加')}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      useConfigStore.getState().addRefFiles(Array.from(files));
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          {refFiles.length > 0 && (
            <div className="flex items-center justify-between mt-1">
              <label className="text-[11px] text-fg-muted">{t('参考图压缩', '参考图压缩')}</label>
              <button
                onClick={() => setEnableRefImageCompression(!enableRefImageCompression)}
                className={cn(
                  'w-[34px] h-[18px] rounded-full p-0.5 transition-colors flex',
                  enableRefImageCompression ? 'bg-primary justify-end' : 'bg-surface-tertiary justify-start'
                )}
              >
                <div className={cn('w-[14px] h-[14px] rounded-full transition-colors', enableRefImageCompression ? 'bg-white' : 'bg-fg-muted')} />
              </button>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-secondary">{t('config.model', '模型')}</label>
          {imageModels.length === 0 ? (
            <div className="bg-warning/10 border border-warning/30 rounded-[10px] px-3 py-2.5 text-[12px] text-warning">
              还没有配置生图模型，请在「设置 → API 密钥」添加密钥，再在「模型管理」添加模型。
            </div>
          ) : (
            <select
              value={selectedImageModelId || ''}
              onChange={(e) => handleSelectImageModel(e.target.value)}
              className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              {!selectedImageModelId && (
                <option value="" disabled>请选择模型...</option>
              )}
              {imageModels.map((m) => {
                const k = apiKeys.find((kk) => kk.id === m.apiKeyId);
                const label = m.displayName || m.name;
                const suffix = k ? ` · ${k.name}` : ' · 密钥缺失';
                return (
                  <option key={m.id} value={m.id}>{label}{suffix}</option>
                );
              })}
            </select>
          )}
        </div>

        {/* gpt-image-* 系列：尺寸预设（直接 OpenAI/云雾的 size 字面量，8 项） */}
        {activeModelName.startsWith('gpt-image-') ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-secondary">{t('config.size', '尺寸')}</label>
            <select
              value={gptImageSize}
              onChange={(e) => setGptImageSize(e.target.value)}
              className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              {(refFiles.length > 0 ? GPT_IMAGE_SIZE_OPTIONS_EDIT : GPT_IMAGE_SIZE_OPTIONS).map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {refFiles.length > 0 && (
              <span className="text-[10px] text-fg-muted">图生图模式仅支持 1K 三档 + auto</span>
            )}
          </div>
        ) : (
          <>
            {/* 非 gpt-image-* 模型：保留原有 aspectRatio + resolution 双选 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-secondary">{t('config.aspectRatio', '尺寸')}</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
              >
                {displayAspectRatios.map((ratio) => (
                  <option key={ratio} value={ratio}>{ratio === 'auto' ? 'auto（跟随参考图）' : ratio}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-secondary">{t('config.resolution', '分辨率')}</label>
              <select
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
                className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary font-mono outline-none appearance-none cursor-pointer focus:border-primary"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
              >
                {resolutions.map((r) => (
                  <option key={r} value={r}>
                    {r === '1K' ? '1K (1024 × 1024)' : r === '2K' ? '2K (2048 × 2048)' : r === '4K' ? '4K (3840 × 2160)' : r}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* GPT image 系列：画质 + 背景 一行两列 */}
        {activeModelName.startsWith('gpt-image-') && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className="text-xs font-medium text-fg-secondary">{t('config.imageQuality', '画质')}</label>
              <select
                value={imageQuality}
                onChange={(e) => setImageQuality(e.target.value as any)}
                className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
              >
                {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
                  <option key={q} value={q}>{t(`config.imageQualityOptions.${q}`, q)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className="text-xs font-medium text-fg-secondary">{t('config.imageBackground', '背景')}</label>
              <select
                value={imageBackground}
                onChange={(e) => setImageBackground(e.target.value as any)}
                className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
              >
                {(['auto', 'opaque', 'transparent'] as const).map((b) => (
                  <option key={b} value={b}>{t(`config.imageBackgroundOptions.${b}`, b)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* GPT image 系列：输出格式（透明背景需 PNG/WebP） */}
        {activeModelName.startsWith('gpt-image-') && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-secondary">{t('config.outputFormat', '输出格式')}</label>
            <select
              value={imageOutputFormat}
              onChange={(e) => setImageOutputFormat(e.target.value as any)}
              className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
            {imageBackground === 'transparent' && imageOutputFormat === 'jpeg' && (
              <span className="text-[10px] text-warning">透明背景需 PNG 或 WebP</span>
            )}
            {(imageOutputFormat === 'jpeg' || imageOutputFormat === 'webp') && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-fg-secondary shrink-0">{t('config.outputCompression', '压缩级别')}</span>
                <input
                  type="range" min={10} max={100} value={imageOutputCompression}
                  onChange={(e) => setImageOutputCompression(Number(e.target.value))}
                  className="flex-1 h-[5px] rounded-full bg-surface-tertiary appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                />
                <span className="text-[11px] font-semibold text-primary font-mono w-9 text-right">{imageOutputCompression}%</span>
              </div>
            )}
          </div>
        )}

        {/* Batch count */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-fg-secondary">{t('config.count', '批量数量')}</label>
            <span className="text-xs font-semibold text-primary font-mono">{count}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full h-[5px] rounded-full bg-surface-tertiary appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
          <div className="flex justify-between">
            <span className="text-[10px] text-fg-muted font-mono">1</span>
            <span className="text-[10px] text-fg-muted font-mono">10</span>
          </div>
        </div>

        {/* API key warning */}
        {!isImageReady && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
            <Info className="w-3.5 h-3.5 shrink-0" />
            {t('config.apiKeyHint', '请先在设置中配置 API Key')}
          </div>
        )}
        {!isChatReady && isImageReady && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            {t('配置提示词优化 API 可使用优化功能', '配置提示词优化 API 可使用 ✨ 优化功能')}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Generate button */}
        <button
          onClick={generate}
          disabled={!isImageReady || !prompt.trim() || isGenerating}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-3 rounded-[10px] text-sm font-semibold transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {isGenerating ? (
            <Loader2 className="w-[17px] h-[17px] animate-spin" />
          ) : refFiles.length > 0 ? (
            <Sparkles className="w-[17px] h-[17px]" />
          ) : (
            <Wand2 className="w-[17px] h-[17px]" />
          )}
          {t('generate.start', '开始生成')}
        </button>
      </div>
    </aside>
  );
}

// ---- Task Queue Bottom Bar (with expand/collapse) ----
function TaskQueueBar({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { status, images } = useGenerateStore(
    useShallow((s) => ({ status: s.status, images: s.images }))
  );

  if (images.length === 0 && status !== 'processing') return null;

  const completedCount = images.filter((img) => img.url).length;
  const processingCount = images.filter((img) => !img.url && img.status === 'pending').length;

  return (
    <div className="flex items-center gap-4 px-6 py-2.5 bg-surface-secondary border-t border-border">
      <span className="text-xs font-semibold text-fg-primary">{t('任务队列', '任务队列')}</span>
      {completedCount > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="w-[7px] h-[7px] rounded-full bg-success" />
          <span className="text-[11px] text-fg-secondary">{completedCount} {t('完成', '完成')}</span>
        </div>
      )}
      {processingCount > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="w-[7px] h-[7px] rounded-full bg-primary" />
          <span className="text-[11px] text-fg-secondary">{processingCount} {t('处理中', '处理中')}</span>
        </div>
      )}
      <div className="flex-1" />
      <button onClick={onToggle} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-fg-muted hover:text-fg-secondary transition-colors">
        <ChevronUp className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
        {expanded ? t('收起', '收起') : t('展开', '展开')}
      </button>
    </div>
  );
}

// ---- Main Generate Page ----
export function GeneratePage() {
  const { t } = useTranslation();
  const { generate } = useGenerate();
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const { error, dismissError, status, images, isSubmitting, selectedIds, toggleSelect } = useGenerateStore(
    useShallow((s) => ({
      error: s.error,
      dismissError: s.dismissError,
      status: s.status,
      images: s.images,
      isSubmitting: s.isSubmitting,
      selectedIds: s.selectedIds,
      toggleSelect: s.toggleSelect,
    }))
  );

  const isEmpty = images.length === 0 && status !== 'processing' && status !== 'failed' && !isSubmitting;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left config panel */}
      <LeftConfigPanel />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-3">
          <h2 className="text-base font-semibold text-fg-primary">{t('生成结果', '生成结果')}</h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewMode('grid')}
              className={cn('p-1.5 rounded-md transition-colors', viewMode === 'grid' ? 'bg-primary/15' : 'hover:bg-surface-tertiary')}
            >
              <Grid3X3 className={cn('w-[15px] h-[15px]', viewMode === 'grid' ? 'text-primary' : 'text-fg-muted')} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('p-1.5 rounded-md transition-colors', viewMode === 'list' ? 'bg-primary/15' : 'hover:bg-surface-tertiary')}
            >
              <List className={cn('w-[15px] h-[15px]', viewMode === 'list' ? 'text-primary' : 'text-fg-muted')} />
            </button>
          </div>
        </div>

        {/* Error bar */}
        {error && status === 'failed' && (
          <div className="bg-error/10 border-b border-error/30 px-6 py-3 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-error font-medium">{t('generate.error.title', '生成失败')}</p>
              <p className="text-xs text-error/80 mt-0.5 line-clamp-2">{error}</p>
            </div>
            <button onClick={dismissError} className="text-error/60 hover:text-error p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <ProgressBar />

        {/* Empty state */}
        {isEmpty && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 bg-primary/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-fg-primary mb-2">{t('generate.empty.title', '开始创作你的图片')}</h2>
              <p className="text-sm text-fg-muted mb-6">{t('generate.empty.subtitle', '在左侧输入提示词，点击生成按钮开始创作')}</p>
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="bg-surface-secondary rounded-xl p-4 border border-border">
                  <div className="w-8 h-8 bg-primary/15 rounded-lg flex items-center justify-center mb-2">
                    <Wand2 className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium text-fg-primary mb-1">{t('generate.empty.textToImage', '文字生图')}</h3>
                  <p className="text-xs text-fg-muted">{t('generate.empty.textToImageDesc', '输入描述生成图片')}</p>
                </div>
                <div className="bg-surface-secondary rounded-xl p-4 border border-border">
                  <div className="w-8 h-8 bg-primary/15 rounded-lg flex items-center justify-center mb-2">
                    <ImagePlus className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium text-fg-primary mb-1">{t('generate.empty.imageToImage', '图生图')}</h3>
                  <p className="text-xs text-fg-muted">{t('generate.empty.imageToImageDesc', '上传参考图生成')}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submitting state */}
        {isSubmitting && images.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-primary/10 rounded-full animate-ping" />
              <div className="w-20 h-20 bg-surface-secondary rounded-full border border-border flex items-center justify-center relative z-10">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-fg-primary mb-2">{t('generate.submitting.title', '正在提交...')}</h2>
            <p className="text-sm text-fg-muted">{t('generate.submitting.subtitle', '请稍候')}</p>
          </div>
        )}

        {/* Image grid / list */}
        {!isEmpty && viewMode === 'grid' && (
          <div className="flex-1 min-h-0 relative">
            <ImageGrid onPreview={setPreviewImage} />
          </div>
        )}
        {!isEmpty && viewMode === 'list' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2 space-y-2 scrollbar-thin">
            {images.map((img) => {
              const isFailed = img.status === 'failed';
              const isSuccess = Boolean(img.url) && !isFailed;
              const isProcessing = !isFailed && !isSuccess;
              const isSelected = selectedIds.has(img.id);
              return (
                <div
                  key={img.id}
                  onClick={() => setPreviewImage(img)}
                  className={cn(
                    'w-full flex items-center gap-4 p-3 rounded-xl bg-surface-secondary transition-all cursor-pointer',
                    isSelected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/30',
                  )}
                >
                  {/* 选择 checkbox（仅成功的可选；点击不触发预览） */}
                  {isSuccess && (
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleSelect(img.id); }}
                      className={cn(
                        'w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors',
                        isSelected ? 'bg-primary border-primary' : 'bg-surface-primary border-border hover:border-primary/60',
                      )}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                    </div>
                  )}
                  {!isSuccess && <div className="w-5 shrink-0" />}

                  <div className="w-24 h-24 rounded-lg bg-surface-tertiary overflow-hidden shrink-0 relative">
                    {isFailed ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <AlertCircle className="w-7 h-7 text-error" />
                      </div>
                    ) : img.thumbnailUrl || img.url ? (
                      <img src={img.thumbnailUrl || img.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="text-sm font-medium text-fg-primary truncate" title={img.prompt}>{img.prompt || 'Untitled'}</p>
                    <div className="flex items-center gap-3 text-xs text-fg-muted">
                      {img.width > 0 && <span className="font-mono">{img.width}×{img.height}</span>}
                      {img.fileSize > 0 && <span>{(img.fileSize / 1024 / 1024).toFixed(1)} MB</span>}
                      {img.createdAt && <span>{new Date(img.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {isSuccess ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">完成</span>
                      ) : isFailed ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-error/15 text-error">失败</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">生成中</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <BatchActions />
        <TaskQueueBar expanded={queueExpanded} onToggle={() => setQueueExpanded(!queueExpanded)} />
        {queueExpanded && <TaskQueuePanel onClose={() => setQueueExpanded(false)} />}
      </div>

      {/* Image comparison/detail modal */}
      {previewImage && (
        <ComparisonModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
          onRegenerate={async () => {
            // 用原任务的配置重新生成：把 prompt/model/aspect/size/参考图 回填到 configStore
            try {
              const img = previewImage;
              let opts: { aspectRatio?: string; imageSize?: string } = {};
              if (img.options) {
                if (typeof img.options === 'string') {
                  try { opts = JSON.parse(img.options); } catch {}
                } else {
                  opts = img.options as any;
                }
              }
              const cfg = useConfigStore.getState();
              if (img.prompt) cfg.setPrompt(img.prompt);
              if (opts.aspectRatio) cfg.setAspectRatio(opts.aspectRatio);
              if (opts.imageSize) cfg.setImageSize(opts.imageSize);
              if (img.model) {
                cfg.setImageModel(img.model);
                const m = useModelStore.getState().getByName(img.model, 'image');
                if (m) cfg.setSelectedImageModelId(m.id);
              }
              // 参考图：先清空，再把原任务的原图拉下来转 File
              cfg.clearRefFiles();
              const refUrl = img.originalImageUrl || (img.originalImagePath ? getImageUrl(img.originalImagePath) : '');
              if (refUrl) {
                try {
                  const res = await fetch(refUrl);
                  const blob = await res.blob();
                  const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
                  const file = new File([blob], `ref-${img.id}.${ext}`, { type: blob.type });
                  cfg.addRefFiles([file]);
                } catch (err) {
                  console.warn('[Regenerate] 拉取原图失败', err);
                }
              }
              await generate();
            } catch (err) {
              console.error('[Regenerate] 失败:', err);
              toast.error('重新生成失败：' + (err instanceof Error ? err.message : String(err)));
            }
          }}
        />
      )}
    </div>
  );
}
