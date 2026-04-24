import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  Sparkles,
  Copy,
  Check,
  RotateCw,
  Send,
  Layers,
  Trash2,
  ImagePlus,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toastStore';
import { useNavigationStore } from '@/store/navigationStore';
import { useConfigStore } from '@/store/configStore';
import { useBatchStore } from '@/store/batchStore';
import { resolveActiveModel, syncActiveModelToBackend } from '@/services/activeModel';
import { imageToPrompt, type ReversePromptStyle } from '@/services/promptApi';
import {
  usePromptReverseStore,
  generateThumbnail,
  type ReversePromptRecord,
} from '@/store/promptReverseStore';

// 风格预设顺序（展示顺序）
const STYLE_OPTIONS: ReversePromptStyle[] = [
  'general',
  'realistic',
  'anime',
  'cinematic',
  'midjourney',
  'flux',
  'custom',
];

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

export function PromptReversePage() {
  const { t } = useTranslation();
  const setPage = useNavigationStore((s) => s.setPage);

  // vision 模型（订阅 configStore 的选择变化，用户改设置后能即时刷新顶栏展示）
  const selectedVisionModelId = useConfigStore((s) => s.selectedVisionModelId);
  const visionApiKey = useConfigStore((s) => s.visionApiKey);
  const vision = useMemo(
    () => resolveActiveModel('vision'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedVisionModelId, visionApiKey],
  );

  // 本地状态
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [style, setStyle] = useState<ReversePromptStyle>('general');
  const [customStyle, setCustomStyle] = useState('');
  const [languages, setLanguages] = useState<{ zh: boolean; en: boolean }>({
    zh: true,
    en: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [promptZh, setPromptZh] = useState('');
  const [promptEn, setPromptEn] = useState('');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'zh' | 'en' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const history = usePromptReverseStore((s) => s.history);
  const addRecord = usePromptReverseStore((s) => s.addRecord);
  const removeRecord = usePromptReverseStore((s) => s.removeRecord);
  const clearHistory = usePromptReverseStore((s) => s.clearHistory);

  // 设置文件 + 预览
  const handleFile = useCallback((f: File | null) => {
    if (!f) {
      setFile(null);
      setPreviewUrl('');
      return;
    }
    if (!f.type.startsWith('image/')) {
      toast.error('仅支持图片文件');
      return;
    }
    if (f.size > MAX_IMAGE_SIZE) {
      toast.error('图片大小不能超过 20MB');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    // 重置结果
    setPromptZh('');
    setPromptEn('');
    setElapsed(null);
  }, [previewUrl]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    handleFile(f);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] || null;
    handleFile(f);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (item) {
      const f = item.getAsFile();
      if (f) handleFile(f);
    }
  };

  // 反推
  const handleSubmit = async () => {
    if (submitting) return;
    if (!file) {
      toast.error(t('reversePrompt.toastNoImage'));
      return;
    }
    if (!vision) {
      toast.error(t('reversePrompt.toastNoModel'));
      return;
    }
    if (!languages.zh && !languages.en) {
      toast.error(t('reversePrompt.toastNoImage')); // 至少选一种语言
      return;
    }

    setSubmitting(true);
    setPromptZh('');
    setPromptEn('');
    setElapsed(null);

    const start = Date.now();
    try {
      // 同步 vision 配置到后端
      const synced = await syncActiveModelToBackend('vision');
      if (!synced) {
        throw new Error(t('reversePrompt.toastNoModel'));
      }

      const basePayload = {
        provider: synced.provider,
        model: synced.modelId,
        imageFile: file,
        style,
        customStyle: style === 'custom' ? customStyle : undefined,
      } as const;

      const tasks: Promise<{ lang: 'zh' | 'en'; prompt: string }>[] = [];
      if (languages.zh) {
        tasks.push(
          imageToPrompt({ ...basePayload, language: 'zh-CN' }).then((r) => ({ lang: 'zh', prompt: r.prompt })),
        );
      }
      if (languages.en) {
        tasks.push(
          imageToPrompt({ ...basePayload, language: 'en' }).then((r) => ({ lang: 'en', prompt: r.prompt })),
        );
      }

      const results = await Promise.all(tasks);
      let nextZh = '';
      let nextEn = '';
      for (const r of results) {
        if (r.lang === 'zh') nextZh = r.prompt;
        else nextEn = r.prompt;
      }
      setPromptZh(nextZh);
      setPromptEn(nextEn);
      const seconds = (Date.now() - start) / 1000;
      setElapsed(seconds);

      // 写历史记录
      try {
        const thumbnail = await generateThumbnail(file);
        const record: ReversePromptRecord = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          thumbnail,
          promptZh: nextZh,
          promptEn: nextEn,
          style,
          customStyle: style === 'custom' ? customStyle : undefined,
          modelName: vision.modelName,
          createdAt: Date.now(),
        };
        addRecord(record);
      } catch (thumbErr) {
        console.warn('[PromptReverse] 生成缩略图失败', thumbErr);
      }

      toast.success(t('reversePrompt.toastSuccess'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('reversePrompt.toastError', { error: msg }));
    } finally {
      setSubmitting(false);
    }
  };

  // 复制
  const handleCopy = async (lang: 'zh' | 'en') => {
    const text = lang === 'zh' ? promptZh : promptEn;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(lang);
      setTimeout(() => setCopiedTarget(null), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  // 发到绘图页 / 批量页
  const sendToGenerate = (lang: 'zh' | 'en') => {
    const text = lang === 'zh' ? promptZh : promptEn;
    if (!text) return;
    useConfigStore.getState().setPrompt(text);
    toast.success(t('reversePrompt.toastSentToGenerate'));
    setPage('generate');
  };

  const sendToBatch = (lang: 'zh' | 'en') => {
    const text = lang === 'zh' ? promptZh : promptEn;
    if (!text) return;
    const { jobs, selectedJobId, updateJobConfig, addJob } = useBatchStore.getState();
    let targetId = selectedJobId && jobs.find((j) => j.id === selectedJobId) ? selectedJobId : '';
    if (!targetId) {
      targetId = addJob('批次 1');
    }
    updateJobConfig(targetId, { prompt: text });
    toast.success(t('reversePrompt.toastSentToBatch'));
    setPage('batch');
  };

  // 从历史记录回填
  const restoreFromRecord = (record: ReversePromptRecord) => {
    setPromptZh(record.promptZh);
    setPromptEn(record.promptEn);
    setStyle(record.style);
    if (record.customStyle) setCustomStyle(record.customStyle);
    setElapsed(null);
    // 缩略图改为预览（file 保持 null，再次反推需要重新上传）
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(record.thumbnail);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 gap-5" onPaste={handlePaste}>
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">{t('reversePrompt.title')}</h1>
          <p className="text-xs text-fg-muted mt-0.5">{t('reversePrompt.subtitle')}</p>
        </div>
        {vision ? (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span>{t('reversePrompt.model')}:</span>
            <span className="px-2 py-1 rounded bg-surface-secondary text-fg-secondary font-mono">
              {vision.modelName}
            </span>
          </div>
        ) : (
          <button
            onClick={() => setPage('settings')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-secondary text-xs text-amber-400 hover:text-amber-300 transition-colors"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            {t('reversePrompt.modelMissing')}
          </button>
        )}
      </div>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 min-h-0">
        {/* Left: upload + config */}
        <div className="flex flex-col gap-4 bg-surface-secondary rounded-xl p-5 overflow-y-auto min-h-0">
          {/* Upload */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'relative flex items-center justify-center rounded-xl border-2 border-dashed transition-colors cursor-pointer overflow-hidden',
              'h-64 shrink-0',
              dragOver
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 bg-surface-primary',
            )}
          >
            {previewUrl ? (
              <>
                <img src={previewUrl} alt="preview" className="w-full h-full object-contain" />
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent text-xs text-white text-center">
                  {t('reversePrompt.uploadRetry')}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 text-fg-muted">
                <Upload className="w-8 h-8" />
                <span className="text-sm">{t('reversePrompt.uploadHint')}</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Style preset */}
          <div>
            <div className="text-xs font-medium text-fg-secondary mb-2">
              {t('reversePrompt.style')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                    style === s
                      ? 'bg-primary/15 text-primary'
                      : 'bg-surface-primary text-fg-secondary hover:text-fg-primary',
                  )}
                >
                  {t(`reversePrompt.styles.${s}`)}
                </button>
              ))}
            </div>
            {style === 'custom' && (
              <textarea
                value={customStyle}
                onChange={(e) => setCustomStyle(e.target.value)}
                placeholder={t('reversePrompt.customPlaceholder')}
                rows={3}
                className="mt-2 w-full bg-surface-primary border border-border rounded-lg px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted resize-none outline-none focus:border-primary/50"
              />
            )}
          </div>

          {/* Language */}
          <div>
            <div className="text-xs font-medium text-fg-secondary mb-2">
              {t('reversePrompt.language')}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setLanguages((s) => ({ ...s, zh: !s.zh }))}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  languages.zh
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-primary text-fg-secondary hover:text-fg-primary',
                )}
              >
                {t('reversePrompt.languageZh')}
              </button>
              <button
                onClick={() => setLanguages((s) => ({ ...s, en: !s.en }))}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  languages.en
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-primary text-fg-secondary hover:text-fg-primary',
                )}
              >
                {t('reversePrompt.languageEn')}
              </button>
            </div>
          </div>

          <div className="flex-1" />

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !file || !vision}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:bg-surface-primary disabled:text-fg-muted disabled:cursor-not-allowed',
            )}
          >
            {submitting ? (
              <>
                <RotateCw className="w-4 h-4 animate-spin" />
                {t('reversePrompt.submitting')}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t('reversePrompt.submit')}
              </>
            )}
          </button>
        </div>

        {/* Right: result */}
        <div className="flex flex-col gap-4 bg-surface-secondary rounded-xl p-5 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg-primary">{t('reversePrompt.result')}</h2>
            {elapsed !== null && (
              <span className="text-xs text-fg-muted">
                {t('reversePrompt.elapsed', { seconds: elapsed.toFixed(1) })}
              </span>
            )}
          </div>

          {/* 空状态 */}
          {!promptZh && !promptEn && !submitting && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-fg-muted">
              <Sparkles className="w-10 h-10 opacity-40" />
              <p className="text-sm">{t('reversePrompt.resultEmpty')}</p>
            </div>
          )}

          {/* 中文结果 */}
          {(promptZh || (submitting && languages.zh)) && (
            <ResultCard
              label={t('reversePrompt.resultZh')}
              text={promptZh}
              loading={submitting && !promptZh && languages.zh}
              copied={copiedTarget === 'zh'}
              onCopy={() => handleCopy('zh')}
              onSendToGenerate={() => sendToGenerate('zh')}
              onSendToBatch={() => sendToBatch('zh')}
              t={t}
            />
          )}

          {/* 英文结果 */}
          {(promptEn || (submitting && languages.en)) && (
            <ResultCard
              label={t('reversePrompt.resultEn')}
              text={promptEn}
              loading={submitting && !promptEn && languages.en}
              copied={copiedTarget === 'en'}
              onCopy={() => handleCopy('en')}
              onSendToGenerate={() => sendToGenerate('en')}
              onSendToBatch={() => sendToBatch('en')}
              t={t}
            />
          )}
        </div>
      </div>

      {/* History */}
      <div className="shrink-0 bg-surface-secondary rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-fg-primary flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-fg-muted" />
            {t('reversePrompt.history')}
            {history.length > 0 && (
              <span className="text-xs text-fg-muted font-normal">({history.length})</span>
            )}
          </h3>
          {history.length > 0 && (
            <button
              onClick={() => {
                if (confirm(t('reversePrompt.confirmClear'))) clearHistory();
              }}
              className="text-xs text-fg-muted hover:text-rose-400 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('reversePrompt.historyClear')}
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="text-xs text-fg-muted text-center py-4">
            {t('reversePrompt.historyEmpty')}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {history.map((rec) => (
              <HistoryCard
                key={rec.id}
                record={rec}
                onRestore={() => restoreFromRecord(rec)}
                onRemove={() => removeRecord(rec.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  label,
  text,
  loading,
  copied,
  onCopy,
  onSendToGenerate,
  onSendToBatch,
  t,
}: {
  label: string;
  text: string;
  loading: boolean;
  copied: boolean;
  onCopy: () => void;
  onSendToGenerate: () => void;
  onSendToBatch: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-col bg-surface-primary rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-fg-secondary">{label}</span>
        {text && (
          <div className="flex items-center gap-1">
            <IconBtn onClick={onCopy} title={t('reversePrompt.copy')}>
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </IconBtn>
            <IconBtn onClick={onSendToGenerate} title={t('reversePrompt.sendToGenerate')}>
              <Send className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn onClick={onSendToBatch} title={t('reversePrompt.sendToBatch')}>
              <Layers className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        )}
      </div>
      <div className="p-3 text-xs text-fg-primary leading-relaxed whitespace-pre-wrap break-words min-h-[80px]">
        {loading ? (
          <span className="text-fg-muted">{t('reversePrompt.submitting')}</span>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg-primary hover:bg-surface-tertiary transition-colors"
    >
      {children}
    </button>
  );
}

function HistoryCard({
  record,
  onRestore,
  onRemove,
  t,
}: {
  record: ReversePromptRecord;
  onRestore: () => void;
  onRemove: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="group relative w-28 shrink-0">
      <button
        onClick={onRestore}
        className="block w-28 h-28 rounded-lg overflow-hidden bg-surface-primary border border-border hover:border-primary/50 transition-colors"
        title={t('reversePrompt.reuse')}
      >
        <img src={record.thumbnail} alt="" className="w-full h-full object-cover" />
      </button>
      <button
        onClick={onRemove}
        title={t('reversePrompt.delete')}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
      <div className="mt-1 text-[10px] text-fg-muted text-center truncate">
        {new Date(record.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}{' '}
        {new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
