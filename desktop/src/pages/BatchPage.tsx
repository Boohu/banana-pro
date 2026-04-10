import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FolderOpen, Play, Pause, Plus, ChevronDown, X, ArrowRight, Loader2, ImagePlus, Image as ImageIcon, Trash2, Folder, CircleCheck, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { IMAGE_MODEL_OPTIONS, CUSTOM_MODEL_VALUE, useConfigStore } from '@/store/configStore';
import { useHistoryStore } from '@/store/historyStore';
import { processBatch, listBatches, getBatchStatus, deleteBatch, pauseBatch, resumeBatch } from '@/services/generateApi';
import { getImageUrl } from '@/services/api';
import { BASE_URL } from '@/services/api';
import { ComparisonModal } from '@/components/ImageComparison/ComparisonModal';

interface BatchFile {
  file: File;
  previewUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
  taskId?: string;
  errorMessage?: string;
}

interface BatchJob {
  id: string;
  name: string;
  files: BatchFile[];
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  quality: number;
  concurrency: number;
  outputFormat: 'PNG' | 'JPG' | 'WebP';
  keepOriginalSize: boolean;
  promptOptEnabled: boolean;
  autoRetry: boolean;
  outputDir: string;
  outputFolderId: string;
  namingRule: string;
  status: 'pending' | 'processing' | 'completed';
  backendBatchId?: string;
}

const createBatchJob = (name: string, defaultModel?: string): BatchJob => ({
  id: Date.now().toString(),
  name,
  files: [],
  prompt: '',
  model: defaultModel || IMAGE_MODEL_OPTIONS[0].value,
  aspectRatio: '1:1',
  resolution: '2K',
  quality: 90,
  concurrency: 3,
  outputFormat: 'PNG',
  keepOriginalSize: false,
  promptOptEnabled: false,
  autoRetry: false,
  outputDir: '',
  outputFolderId: '',
  namingRule: '原文件名_edited',
  status: 'pending',
});

// ---- Batch List Sidebar ----
function BatchListSidebar({ batches, selectedId, onSelect, onAdd, onDelete }: {
  batches: BatchJob[]; selectedId: string | null; onSelect: (id: string) => void; onAdd: () => void; onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-[280px] shrink-0 border-r border-border flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-fg-primary">{t('batch.list')}</h3>
        <button onClick={onAdd} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {t('batch.new')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-2 space-y-1.5">
        {batches.map((batch) => {
          const isSelected = selectedId === batch.id;
          const completedCount = batch.files.filter((f) => f.status === 'completed').length;
          const totalCount = batch.files.length;
          const isCompleted = batch.status === 'completed';
          const isProcessing = batch.status === 'processing';

          return (
            <div
              key={batch.id}
              onClick={() => onSelect(batch.id)}
              className={cn(
                'w-full text-left px-3.5 py-3 rounded-xl space-y-2 transition-colors cursor-pointer group relative',
                isSelected ? 'bg-primary/10 ring-1 ring-primary' : 'bg-surface-secondary hover:bg-surface-tertiary'
              )}
            >
              <div className="flex items-center gap-2">
                {isCompleted ? (
                  <CircleCheck className="w-4 h-4 text-success shrink-0" />
                ) : (
                  <Folder className={cn('w-4 h-4 shrink-0', isSelected ? 'text-primary' : 'text-fg-muted')} />
                )}
                <span className={cn('text-[13px] font-medium truncate flex-1', isCompleted ? 'text-fg-secondary' : 'text-fg-primary')}>{batch.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(batch.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/15 text-fg-muted hover:text-error transition-all shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-fg-secondary">{totalCount} 张</span>
                {isProcessing && totalCount > 0 && (
                  <>
                    <div className="flex-1 h-1 rounded-full bg-surface-primary">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
                    </div>
                    <span className="text-[11px] font-medium text-primary font-mono">{Math.round((completedCount / totalCount) * 100)}%</span>
                  </>
                )}
                {isCompleted && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">{t('batch.status.completed')}</span>
                )}
                {batch.status === 'pending' && totalCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-tertiary text-fg-muted">{t('batch.status.queued')}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Batch Config Panel ----
function BatchConfigPanel({ batch, onChange }: { batch: BatchJob; onChange: (updates: Partial<BatchJob>) => void }) {
  const { t } = useTranslation();
  const currentImageModel = useConfigStore((s) => s.imageModel);
  const folders = useHistoryStore((s) => s.folders);
  const loadFolders = useHistoryStore((s) => s.loadFolders);
  useEffect(() => { void loadFolders(); }, [loadFolders]);
  // 读取自定义模型列表（和设置页共享 localStorage）
  const [customModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('banana-custom-models') || '[]'); } catch { return []; }
  });
  const builtinValues = new Set(IMAGE_MODEL_OPTIONS.map((o) => o.value as string));
  const modelOptions: { value: string; label: string }[] = [
    ...IMAGE_MODEL_OPTIONS.map((o) => ({ value: o.value as string, label: o.label })),
    ...customModels.filter((m) => !builtinValues.has(m)).map((m) => ({ value: m, label: m })),
  ];
  const selectStyle = { backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' };

  const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

  const Toggle = ({ checked, onToggle }: { checked: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} className={cn('w-[38px] h-5 rounded-full p-0.5 transition-colors flex', checked ? 'bg-primary justify-end' : 'bg-surface-tertiary justify-start')}>
      <div className={cn('w-4 h-4 rounded-full transition-colors', checked ? 'bg-white' : 'bg-fg-muted')} />
    </button>
  );

  return (
    <aside className="w-80 shrink-0 bg-surface-secondary border-l border-border p-[18px] flex flex-col gap-3 overflow-y-auto hidden lg:flex">
      <div className="flex items-center gap-2">
        <Folder className="w-4 h-4 text-primary" />
        <h3 className="text-[15px] font-semibold text-fg-primary">{t('batch.config')}</h3>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.prompt')}</label>
        <textarea
          value={batch.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={t('batch.promptPlaceholder')}
          className="w-full h-20 rounded-[10px] bg-surface-tertiary border border-border px-3.5 py-2.5 text-[13px] text-fg-primary placeholder:text-fg-muted outline-none resize-none focus:border-primary transition-colors"
        />
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.model')}</label>
        <select
          value={batch.model}
          onChange={(e) => onChange({ model: e.target.value })}
          className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
          style={selectStyle}
        >
          {modelOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Aspect Ratio */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.aspectRatio')}</label>
        <select
          value={batch.aspectRatio}
          onChange={(e) => onChange({ aspectRatio: e.target.value })}
          className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
          style={selectStyle}
        >
          {['1:1', '16:9', '9:16', '4:3', '3:2', '2:3', '4:5', '5:4'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Resolution */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.resolution')}</label>
        <select
          value={batch.resolution}
          onChange={(e) => onChange({ resolution: e.target.value })}
          className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary font-mono outline-none appearance-none cursor-pointer focus:border-primary"
          style={selectStyle}
        >
          <option value="1K">1K (1024 × 1024)</option>
          <option value="2K">2K (2048 × 2048)</option>
        </select>
      </div>

      {/* Output format */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.outputFormat')}</label>
        <div className="flex gap-1.5">
          {(['PNG', 'JPG', 'WebP'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onChange({ outputFormat: fmt })}
              className={cn(
                'flex-1 py-[7px] text-xs font-medium rounded-lg text-center transition-colors',
                batch.outputFormat === fmt ? 'bg-primary/15 text-primary border border-primary' : 'bg-surface-tertiary text-fg-secondary'
              )}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Quality */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-fg-secondary">{t('batch.quality')}</label>
          <span className="text-xs font-semibold text-primary font-mono">{batch.quality}%</span>
        </div>
        <input
          type="range" min={10} max={100} value={batch.quality}
          onChange={(e) => onChange({ quality: Number(e.target.value) })}
          className="w-full h-[5px] rounded-full bg-surface-tertiary appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
      </div>

      {/* Concurrency */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-fg-secondary">{t('batch.concurrency')}</label>
          <span className="text-xs font-semibold text-primary font-mono">{batch.concurrency}</span>
        </div>
        <input
          type="range" min={1} max={6} value={batch.concurrency}
          onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
          className="w-full h-[5px] rounded-full bg-surface-tertiary appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <div className="flex justify-between">
          <span className="text-[10px] text-fg-muted font-mono">1</span>
          <span className="text-[10px] text-fg-muted font-mono">6</span>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Output target */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.outputTo')}</label>
        <select
          value={batch.outputFolderId || ''}
          onChange={async (e) => {
            const val = e.target.value;
            if (val === '__local__') {
              // 桌面端：弹出文件夹选择
              try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const selected = await open({ directory: true, multiple: false });
                if (selected && typeof selected === 'string') {
                  onChange({ outputFolderId: '__local__', outputDir: selected });
                }
              } catch {}
            } else if (val === '') {
              onChange({ outputFolderId: '', outputDir: '' });
            } else {
              onChange({ outputFolderId: val, outputDir: '' });
            }
          }}
          className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary outline-none appearance-none cursor-pointer focus:border-primary"
          style={selectStyle}
        >
          <option value="">{t('batch.outputDefault')}</option>
          {folders.map((f) => (
            <option key={f.id} value={String(f.id)}>{f.name}</option>
          ))}
          {isTauri && <option value="__local__">{t('batch.outputLocal')}</option>}
        </select>
      </div>
      {/* 已选择本地文件夹时显示路径 */}
      {batch.outputFolderId === '__local__' && batch.outputDir && (
        <div className="flex items-center gap-2 bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5">
          <span className="flex-1 text-[13px] text-fg-primary font-mono truncate">{batch.outputDir}</span>
          <button
            onClick={async () => {
              try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const selected = await open({ directory: true, multiple: false });
                if (selected && typeof selected === 'string') onChange({ outputDir: selected });
              } catch {}
            }}
            className="p-1 rounded hover:bg-surface-secondary transition-colors shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5 text-fg-secondary" />
          </button>
        </div>
      )}

      {/* Naming rule */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.namingRule')}</label>
        <select
          value={batch.namingRule}
          onChange={(e) => onChange({ namingRule: e.target.value })}
          className="w-full bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5 text-[13px] text-fg-primary font-mono outline-none appearance-none cursor-pointer focus:border-primary"
          style={selectStyle}
        >
          <option value="原文件名_edited">原文件名_edited</option>
          <option value="原文件名_时间戳">原文件名_时间戳</option>
          <option value="序号">序号 (001, 002...)</option>
        </select>
      </div>

      <div className="h-px bg-border" />

      {/* Toggles */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.keepOriginalSize')}</label>
        <Toggle checked={batch.keepOriginalSize} onToggle={() => onChange({ keepOriginalSize: !batch.keepOriginalSize })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.promptOptimize')}</label>
        <Toggle checked={batch.promptOptEnabled} onToggle={() => onChange({ promptOptEnabled: !batch.promptOptEnabled })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-fg-secondary">{t('batch.autoRetry')}</label>
        <Toggle checked={batch.autoRetry} onToggle={() => onChange({ autoRetry: !batch.autoRetry })} />
      </div>
    </aside>
  );
}

// ---- Main Batch Page ----
export function BatchPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentImageModel = useConfigStore((s) => s.imageModel);
  const [batches, setBatches] = useState<BatchJob[]>([createBatchJob('批次 1', currentImageModel)]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>(batches[0].id);
  const loadedRef = useRef(false);

  // 进入页面时从后端加载批次历史
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    listBatches(1, 50).then(async (res) => {
      const batchList = (res.list || []).filter((b) => b.status !== 'draft');
      if (batchList.length === 0) return;

      // 逐个拿批次详情（含 tasks）
      const details = await Promise.all(
        batchList.map((b) => getBatchStatus(b.batch_id).catch(() => null))
      );

      const backendBatches: BatchJob[] = details
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .map((b, i) => {
          const tasks = b.tasks || [];
          const files: BatchFile[] = tasks.map((t) => ({
            file: new File([], t.original_file_name || `task-${t.task_id.substring(0, 8)}`),
            previewUrl: t.original_image_path ? getImageUrl(t.original_image_path) : (t.thumbnail_url || (t.thumbnail_path ? getImageUrl(t.thumbnail_path) : '')),
            status: (t.status === 'completed' ? 'completed' : t.status === 'failed' ? 'failed' : 'pending') as BatchFile['status'],
            progress: t.status === 'completed' ? 100 : 0,
            resultUrl: t.image_url || (t.local_path ? getImageUrl(t.local_path) : undefined),
            taskId: t.task_id,
            errorMessage: t.error_message,
          }));
          const promptLabel = b.prompt.length > 20 ? b.prompt.substring(0, 20) + '...' : b.prompt;
          // 从 config_snapshot 还原配置
          let snapshot: Record<string, any> = {};
          try { if (b.config_snapshot) snapshot = JSON.parse(b.config_snapshot); } catch {}
          return {
            ...createBatchJob(promptLabel || `历史批次 ${i + 1}`, b.model_id),
            id: b.batch_id,
            backendBatchId: b.batch_id,
            files,
            prompt: b.prompt,
            model: b.model_id,
            aspectRatio: snapshot.aspectRatio || '1:1',
            resolution: snapshot.imageSize || '2K',
            outputFormat: (snapshot.output_format || 'PNG') as BatchJob['outputFormat'],
            quality: typeof snapshot.quality === 'number' ? snapshot.quality : 90,
            concurrency: typeof snapshot.concurrency === 'number' ? snapshot.concurrency : 3,
            namingRule: snapshot.naming_rule || '原文件名_edited',
            keepOriginalSize: snapshot.keep_original_size === true,
            promptOptEnabled: (snapshot.prompt_optimize_mode || 'off') !== 'off',
            autoRetry: snapshot.auto_retry === true,
            status: b.status === 'completed' || b.status === 'partial' ? 'completed' as const : 'pending' as const,
          };
        });

      if (backendBatches.length > 0) {
        setBatches((prev) => {
          const existingIds = new Set(prev.map((b) => b.backendBatchId).filter(Boolean));
          const newFromBackend = backendBatches.filter((b) => !existingIds.has(b.id));
          // 最新的批次排在前面（新建空批次在最前，历史批次按时间倒序）
          // 历史批次（已按时间倒序）在前，新建空批次在后
          return [...newFromBackend, ...prev];
        });
      }
    }).catch((err) => {
      console.error('[BatchPage] 加载批次历史失败:', err);
    });
  }, []);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || batches[0];

  const updateBatch = (id: string, updates: Partial<BatchJob>) => {
    setBatches((prev) => prev.map((b) => b.id === id ? { ...b, ...updates } : b));
  };

  const addBatch = () => {
    const newBatch = createBatchJob(`批次 ${batches.length + 1}`, currentImageModel);
    setBatches((prev) => [...prev, newBatch]);
    setSelectedBatchId(newBatch.id);
  };

  const handleDeleteBatch = useCallback((id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    // 后端有记录则调删除接口
    if (batch.backendBatchId) {
      deleteBatch(batch.backendBatchId).catch((err) => {
        console.error('[BatchPage] 删除批次失败:', err);
      });
    }
    setBatches((prev) => {
      const next = prev.filter((b) => b.id !== id);
      // 如果删的是当前选中的，切到第一个或新建一个
      if (selectedBatchId === id) {
        if (next.length > 0) {
          setSelectedBatchId(next[0].id);
        } else {
          const newBatch = createBatchJob('批次 1', currentImageModel);
          next.push(newBatch);
          setSelectedBatchId(newBatch.id);
        }
      }
      return next;
    });
  }, [batches, selectedBatchId, currentImageModel]);

  // 图片预览状态
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const completedFiles = selectedBatch.files.filter((f) => f.status === 'completed' && f.resultUrl);
  const previewFile = previewIndex !== null ? completedFiles[previewIndex] : null;

  // 重试失败的文件
  const handleRetryFile = useCallback(async (fileIndex: number) => {
    if (!selectedBatch) return;
    const file = selectedBatch.files[fileIndex];
    if (!file || file.status !== 'failed') return;

    const provider = useConfigStore.getState().imageProvider || 'gemini';
    const formData = new FormData();
    formData.append('files', file.file);
    formData.append('prompt', selectedBatch.prompt);
    formData.append('provider', provider);
    formData.append('model_id', selectedBatch.model);
    formData.append('aspectRatio', selectedBatch.aspectRatio);
    formData.append('imageSize', selectedBatch.resolution);
    formData.append('outputFormat', selectedBatch.outputFormat);
    formData.append('quality', String(selectedBatch.quality));
    formData.append('concurrency', '1');

    // 标记为处理中
    const updatedFiles = [...selectedBatch.files];
    updatedFiles[fileIndex] = { ...file, status: 'processing', progress: 0, errorMessage: undefined };
    updateBatch(selectedBatch.id, { files: updatedFiles });

    try {
      const res = await processBatch(formData);
      const task = res.tasks?.[0];
      if (task) {
        updatedFiles[fileIndex] = { ...updatedFiles[fileIndex], taskId: task.task_id };
        updateBatch(selectedBatch.id, { files: [...updatedFiles] });
        // 连接 SSE 监听这个新批次
        connectSSE(selectedBatch.id, res.batch_id);
      }
    } catch (err: any) {
      updatedFiles[fileIndex] = { ...file, status: 'failed', errorMessage: err?.message || '重试失败' };
      updateBatch(selectedBatch.id, { files: [...updatedFiles] });
    }
  }, [selectedBatch]);

  const handleSelectFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles || !selectedBatch) return;
    const newFiles: BatchFile[] = Array.from(selectedFiles)
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: 'pending' as const,
        progress: 0,
      }));
    updateBatch(selectedBatch.id, { files: [...selectedBatch.files, ...newFiles] });
  };

  const sseRef = useRef<EventSource | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 清理 SSE 连接
  useEffect(() => {
    return () => { sseRef.current?.close(); };
  }, []);

  // 开始批量处理
  const handleStart = useCallback(async () => {
    if (!selectedBatch || selectedBatch.files.length === 0 || !selectedBatch.prompt.trim()) return;
    setIsSubmitting(true);

    // 获取 provider 配置
    const provider = useConfigStore.getState().imageProvider || 'gemini';

    // 构建 FormData（传递全部配置参数）
    const formData = new FormData();
    selectedBatch.files.forEach((f) => formData.append('files', f.file));
    formData.append('prompt', selectedBatch.prompt);
    formData.append('provider', provider);
    formData.append('model_id', selectedBatch.model);
    formData.append('aspectRatio', selectedBatch.aspectRatio);
    formData.append('imageSize', selectedBatch.resolution);
    formData.append('outputFormat', selectedBatch.outputFormat);
    formData.append('quality', String(selectedBatch.quality));
    formData.append('concurrency', String(selectedBatch.concurrency));
    formData.append('namingRule', selectedBatch.namingRule);
    formData.append('keepOriginalSize', String(selectedBatch.keepOriginalSize));
    formData.append('autoRetry', String(selectedBatch.autoRetry));
    if (selectedBatch.outputFolderId === '__local__' && selectedBatch.outputDir) {
      formData.append('outputDir', selectedBatch.outputDir);
    } else if (selectedBatch.outputFolderId && selectedBatch.outputFolderId !== '__local__') {
      formData.append('folderId', selectedBatch.outputFolderId);
    }
    if (selectedBatch.promptOptEnabled) {
      formData.append('prompt_optimize_mode', 'text');
    }

    try {
      const res = await processBatch(formData);
      const batchId = res.batch_id;
      const tasks = res.tasks || [];

      // 用 original_file_name 匹配文件，记录 taskId
      const updatedFiles = selectedBatch.files.map((f) => {
        const matched = tasks.find((t) => t.original_file_name === f.file.name);
        return { ...f, taskId: matched?.task_id, status: 'processing' as const };
      });
      updateBatch(selectedBatch.id, {
        backendBatchId: batchId,
        files: updatedFiles,
        status: 'processing',
      });

      // 启动 SSE 监听
      connectSSE(selectedBatch.id, batchId);
    } catch (err: any) {
      console.error('[BatchPage] 提交失败:', err);
      const msg = err?.response?.data?.message || err?.message || '提交失败，请检查后端是否运行';
      alert(`${t('batch.submitFailed')}: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedBatch]);

  // SSE 连接监听批次进度
  const connectSSE = useCallback((frontendBatchId: string, backendBatchId: string) => {
    sseRef.current?.close();
    const url = `${BASE_URL}/batches/${backendBatchId}/stream`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const tasks: any[] = data.tasks || [];

        setBatches((prev) => prev.map((b) => {
          if (b.id !== frontendBatchId) return b;
          const updatedFiles = b.files.map((f) => {
            const matched = tasks.find((t: any) =>
              t.task_id === f.taskId || t.original_file_name === f.file.name
            );
            if (!matched) return f;
            const resultUrl = matched.image_url || (matched.local_path ? getImageUrl(matched.local_path) : undefined);
            return {
              ...f,
              status: matched.status === 'completed' ? 'completed' as const
                : matched.status === 'failed' ? 'failed' as const
                : 'processing' as const,
              resultUrl,
              errorMessage: matched.error_message,
              progress: matched.status === 'completed' ? 100 : matched.status === 'failed' ? 0 : 50,
            };
          });

          const completedCount = updatedFiles.filter((f) => f.status === 'completed').length;
          const failedCount = updatedFiles.filter((f) => f.status === 'failed').length;
          const allDone = completedCount + failedCount >= updatedFiles.length;

          return {
            ...b,
            files: updatedFiles,
            status: allDone ? 'completed' as const : 'processing' as const,
          };
        }));

        // 批次完成时关闭 SSE
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'partial') {
          es.close();
          sseRef.current = null;
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };
  }, []);

  const removeFile = (index: number) => {
    if (!selectedBatch) return;
    const next = [...selectedBatch.files];
    URL.revokeObjectURL(next[index].previewUrl);
    next.splice(index, 1);
    updateBatch(selectedBatch.id, { files: next });
  };

  const completedCount = selectedBatch.files.filter((f) => f.status === 'completed').length;
  const processingCount = selectedBatch.files.filter((f) => f.status === 'processing').length;
  const pendingCount = selectedBatch.files.filter((f) => f.status === 'pending').length;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Batch list sidebar */}
      <BatchListSidebar
        batches={batches}
        selectedId={selectedBatchId}
        onSelect={setSelectedBatchId}
        onAdd={addBatch}
        onDelete={handleDeleteBatch}
      />

      {/* Center: file list for selected batch */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 py-3 bg-surface-secondary">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-primary" />
            <h3 className="text-[15px] font-semibold text-fg-primary">{selectedBatch.name}</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              {selectedBatch.status === 'completed' ? t('batch.status.completed') : selectedBatch.status === 'processing' ? t('batch.status.processing') : t('batch.status.pending')}
            </span>
          </div>
          <div className="flex-1" />
          {selectedBatch.files.length > 0 && (
            <div className="flex items-center gap-3 text-[11px]">
              {completedCount > 0 && <span className="text-success">✓ {completedCount}</span>}
              {processingCount > 0 && <span className="text-primary">⟳ {processingCount}</span>}
              {pendingCount > 0 && <span className="text-fg-muted">○ {pendingCount}</span>}
            </div>
          )}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {selectedBatch.files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
                <ImagePlus className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-fg-primary mb-2">{t('batch.addImages')}</h2>
              <p className="text-sm text-fg-muted mb-4">{t('batch.selectFiles')}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-secondary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('batch.selectBtn')}
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-secondary border border-border text-[11px] text-fg-secondary hover:text-fg-primary transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('batch.addMore')}
                </button>
              </div>
              {selectedBatch.files.map((item, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl bg-surface-secondary',
                    item.status === 'processing' && 'ring-1 ring-primary'
                  )}
                >
                  <img src={item.previewUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-[13px] font-medium text-fg-primary truncate">{item.file.name}</p>
                    {item.status === 'processing' ? (
                      <div className="w-full h-[3px] rounded-full bg-surface-tertiary">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${item.progress}%` }} />
                      </div>
                    ) : (
                      <p className="text-[10px] text-fg-muted font-mono">{(item.file.size / 1024 / 1024).toFixed(1)} MB</p>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-fg-muted shrink-0" />
                  <div
                    className={cn(
                      'w-12 h-12 rounded-lg bg-surface-tertiary flex items-center justify-center shrink-0',
                      item.status === 'completed' && item.resultUrl && 'cursor-pointer hover:ring-2 hover:ring-primary'
                    )}
                    onClick={() => {
                      if (item.status === 'completed' && item.resultUrl) {
                        const idx = completedFiles.findIndex((f) => f.resultUrl === item.resultUrl);
                        if (idx >= 0) setPreviewIndex(idx);
                      }
                    }}
                  >
                    {item.status === 'completed' && item.resultUrl ? (
                      <img src={item.resultUrl} alt="" className="w-full h-full rounded-lg object-cover" />
                    ) : item.status === 'processing' ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-fg-muted" />
                    )}
                  </div>
                  <div className="w-12 shrink-0 text-center">
                    {item.status === 'completed' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">{t('batch.status.done')}</span>
                    ) : item.status === 'processing' ? (
                      <span className="text-[10px] font-mono text-primary">{item.progress}%</span>
                    ) : item.status === 'failed' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-error/15 text-error">{t('batch.status.failed')}</span>
                    ) : (
                      <span className="text-[10px] text-fg-muted">{t('batch.status.waiting')}</span>
                    )}
                  </div>
                  {item.status === 'completed' && item.resultUrl && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(item.resultUrl!);
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = item.file.name.replace(/\.[^.]+$/, '_edited$&');
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch {}
                      }}
                      className="text-fg-muted hover:text-success transition-colors shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {item.status === 'failed' && (
                    <button
                      onClick={() => handleRetryFile(i)}
                      className="text-fg-muted hover:text-primary transition-colors shrink-0"
                      title={t('batch.retry')}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => removeFile(i)} className="text-fg-muted hover:text-error transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleSelectFiles(e.target.files); e.target.value = ''; }} />

        {/* Bottom progress */}
        {selectedBatch.files.length > 0 && (
          <div className="flex items-center gap-3.5 px-5 py-3 bg-surface-secondary border-t border-border">
            <span className="text-xs font-semibold text-fg-primary">{t('batch.currentBatch')}</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface-tertiary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: selectedBatch.files.length > 0 ? `${(completedCount / selectedBatch.files.length) * 100}%` : '0%' }} />
            </div>
            <span className="text-xs font-semibold text-primary font-mono">{completedCount} / {selectedBatch.files.length}</span>
            <button
              onClick={handleStart}
              disabled={selectedBatch.files.length === 0 || !selectedBatch.prompt.trim() || isSubmitting || selectedBatch.status === 'processing'}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {isSubmitting ? t('batch.submitting') : selectedBatch.status === 'processing' ? t('batch.processing') : t('batch.start')}
            </button>
            {selectedBatch.status === 'processing' && selectedBatch.backendBatchId && (
              <button
                onClick={async () => {
                  try {
                    await pauseBatch(selectedBatch.backendBatchId!);
                    updateBatch(selectedBatch.id, { status: 'pending' });
                  } catch (err) {
                    console.error('[BatchPage] 暂停失败:', err);
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-warning/15 text-warning text-xs font-semibold hover:bg-warning/25 transition-colors"
              >
                <Pause className="w-3.5 h-3.5" />
                {t('batch.pause')}
              </button>
            )}
            {selectedBatch.status === 'pending' && selectedBatch.backendBatchId && (
              <button
                onClick={async () => {
                  try {
                    await resumeBatch(selectedBatch.backendBatchId!);
                    updateBatch(selectedBatch.id, { status: 'processing' });
                    connectSSE(selectedBatch.id, selectedBatch.backendBatchId!);
                  } catch (err) {
                    console.error('[BatchPage] 恢复失败:', err);
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {t('batch.resume')}
              </button>
            )}
            {completedCount > 0 && (
              <button
                onClick={async () => {
                  // 逐个下载已完成的图片（fetch blob 避免跨域打开）
                  for (const f of selectedBatch.files) {
                    if (f.status === 'completed' && f.resultUrl) {
                      try {
                        const res = await fetch(f.resultUrl);
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = f.file.name.replace(/\.[^.]+$/, '_edited$&');
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch {}
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-success/15 text-success text-xs font-semibold hover:bg-success/25 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t('batch.downloadAll')} ({completedCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right config panel */}
      <BatchConfigPanel batch={selectedBatch} onChange={(updates) => updateBatch(selectedBatch.id, updates)} />

      {/* 图片预览对比弹窗 */}
      {previewFile && previewIndex !== null && (
        <ComparisonModal
          image={{
            id: previewFile.taskId || '',
            taskId: previewFile.taskId || '',
            filePath: '',
            thumbnailPath: '',
            fileSize: 0,
            width: 0,
            height: 0,
            mimeType: '',
            createdAt: '',
            url: previewFile.resultUrl,
            prompt: selectedBatch.prompt,
          }}
          originalImageUrl={previewFile.previewUrl || undefined}
          onClose={() => setPreviewIndex(null)}
          onPrev={previewIndex > 0 ? () => setPreviewIndex(previewIndex - 1) : undefined}
          onNext={previewIndex < completedFiles.length - 1 ? () => setPreviewIndex(previewIndex + 1) : undefined}
        />
      )}
    </div>
  );
}
