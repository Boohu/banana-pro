import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Scissors,
  Download,
  RotateCw,
  Settings as SettingsIcon,
  AlertCircle,
  Crop,
  X,
  Check,
  RefreshCcw,
  Trash2,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toastStore';
import { useNavigationStore } from '@/store/navigationStore';
import {
  listRembgModels,
  type RembgModel,
} from '@/services/rembgApi';
import { RembgCropModal } from '@/components/Rembg/CropModal';
import { useRembgBatchStore, type RembgJob } from '@/store/rembgBatchStore';

const REMBG_MODEL_KEY = 'banana-rembg-last-model';

export function RembgToolPage() {
  const setPage = useNavigationStore((s) => s.setPage);

  const [models, setModels] = useState<RembgModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  const [dragOver, setDragOver] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [cropOpen, setCropOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sliderContainerRef = useRef<HTMLDivElement>(null);

  // store
  const jobs = useRembgBatchStore((s) => s.jobs);
  const selectedJobId = useRembgBatchStore((s) => s.selectedJobId);
  const isRunning = useRembgBatchStore((s) => s.isRunning);
  const addFiles = useRembgBatchStore((s) => s.addFiles);
  const removeJob = useRembgBatchStore((s) => s.removeJob);
  const selectJob = useRembgBatchStore((s) => s.selectJob);
  const clearAll = useRembgBatchStore((s) => s.clearAll);
  const runBatch = useRembgBatchStore((s) => s.runBatch);
  const retryJob = useRembgBatchStore((s) => s.retryJob);
  const cancel = useRembgBatchStore((s) => s.cancel);

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId) || null, [jobs, selectedJobId]);
  const pendingCount = useMemo(() => jobs.filter((j) => j.status === 'pending' || j.status === 'failed').length, [jobs]);
  const completedJobs = useMemo(() => jobs.filter((j) => j.status === 'completed' && j.resultBlob), [jobs]);
  const processingCount = useMemo(() => jobs.filter((j) => j.status === 'processing').length, [jobs]);

  // 加载模型列表 + 恢复上次选择
  useEffect(() => {
    (async () => {
      try {
        const list = await listRembgModels();
        setModels(list);
        const installed = list.filter((m) => m.installed);
        const lastUsed = localStorage.getItem(REMBG_MODEL_KEY) || '';
        const initial = installed.find((m) => m.id === lastUsed) || installed[0];
        if (initial) setSelectedModelId(initial.id);
      } catch (err: any) {
        toast.error('加载抠图模型失败：' + (err?.message || err));
      } finally {
        setLoadingModels(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedModelId) localStorage.setItem(REMBG_MODEL_KEY, selectedModelId);
  }, [selectedModelId]);

  const installedModels = useMemo(() => models.filter((m) => m.installed), [models]);
  const hasInstalled = installedModels.length > 0;
  const selectedModel = installedModels.find((m) => m.id === selectedModelId);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) {
      toast.error('请选择图片文件');
      return;
    }
    const oversized = arr.filter((f) => f.size > 20 * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error(`${oversized.length} 张图片超过 20MB 已跳过`);
    }
    addFiles(arr.filter((f) => f.size <= 20 * 1024 * 1024));
    setSliderPos(50);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (item) {
      const f = item.getAsFile();
      if (f) addFiles([f]);
    }
  };

  const handleStart = () => {
    if (!selectedModelId || pendingCount === 0) return;
    void runBatch(selectedModelId);
  };

  const handleRetry = (id: string) => {
    if (!selectedModelId) return;
    void retryJob(id, selectedModelId);
  };

  const downloadBlob = async (blob: Blob, fileName: string) => {
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (isTauri) {
      try {
        // @ts-ignore Tauri 运行时解析
        const { save } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
        // @ts-ignore Tauri 运行时解析
        const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
        const lastDir = localStorage.getItem('banana-last-save-dir') || '';
        const defaultPath = lastDir ? `${lastDir}/${fileName}` : fileName;
        const destPath = await save({
          defaultPath,
          filters: [{ name: 'PNG', extensions: ['png'] }],
        });
        if (!destPath) return;
        const slash = Math.max(destPath.lastIndexOf('/'), destPath.lastIndexOf('\\'));
        if (slash > 0) localStorage.setItem('banana-last-save-dir', destPath.substring(0, slash));
        const buf = new Uint8Array(await blob.arrayBuffer());
        await writeFile(destPath, buf);
        toast.success('已保存到 ' + destPath.split(/[/\\]/).pop());
      } catch (err: any) {
        console.error('Save failed', err);
        toast.error('保存失败：' + (err?.message || err));
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleDownloadOne = async (job: RembgJob) => {
    if (!job.resultBlob) return;
    const baseName = (job.fileName || 'image').replace(/\.[^.]+$/, '');
    await downloadBlob(job.resultBlob, `${baseName}-cutout.png`);
  };

  // 多张选择文件夹一次性保存（Tauri 桌面端）
  const handleDownloadAll = async () => {
    if (completedJobs.length === 0) return;
    const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
    if (isTauri) {
      try {
        // @ts-ignore Tauri 运行时解析
        const { open } = await import(/* @vite-ignore */ '@tauri-apps/plugin-dialog');
        // @ts-ignore Tauri 运行时解析
        const { writeFile } = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
        const dir = await open({ directory: true, multiple: false, title: '选择保存文件夹' });
        if (!dir || typeof dir !== 'string') return;
        let saved = 0;
        for (const j of completedJobs) {
          if (!j.resultBlob) continue;
          const baseName = (j.fileName || 'image').replace(/\.[^.]+$/, '');
          const fileName = `${baseName}-cutout.png`;
          const buf = new Uint8Array(await j.resultBlob.arrayBuffer());
          await writeFile(`${dir}/${fileName}`, buf);
          saved += 1;
        }
        toast.success(`已保存 ${saved} 张到 ${dir.split(/[/\\]/).pop()}`);
      } catch (err: any) {
        toast.error('批量保存失败：' + (err?.message || err));
      }
    } else {
      // Web 端：连发下载
      for (const j of completedJobs) {
        if (j.resultBlob) await handleDownloadOne(j);
      }
    }
  };

  // 滑动对比拖动
  const handleSliderMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const box = sliderContainerRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
      setSliderPos(pct);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 选中 job 切换时重置滑块
  useEffect(() => {
    setSliderPos(50);
  }, [selectedJobId]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 gap-5" onPaste={handlePaste}>
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary">一键抠图</h1>
          <p className="text-xs text-fg-muted mt-0.5">本地 ONNX 模型，离线运行不消耗积分；支持批量处理</p>
        </div>
        <div className="flex items-center gap-3">
          {jobs.length > 0 && (
            <span className="text-xs text-fg-muted">
              共 {jobs.length} 张 · 完成 {completedJobs.length}
              {processingCount > 0 ? ` · 处理中 ${processingCount}` : ''}
            </span>
          )}
          {selectedModel && (
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <span>当前模型:</span>
              <span className="px-2 py-1 rounded bg-surface-secondary text-fg-secondary font-mono">
                {selectedModel.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main grid: 左侧上传/列表/配置 + 右侧预览对比 */}
      <div className="flex-1 grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-5 min-h-0">
        {/* Left panel */}
        <div className="flex flex-col gap-4 bg-surface-secondary rounded-xl p-5 overflow-hidden min-h-0">
          {/* Upload (multi) */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'relative flex items-center justify-center rounded-xl border-2 border-dashed transition-colors cursor-pointer',
              'h-28 shrink-0',
              dragOver
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 bg-surface-primary',
            )}
          >
            <div className="flex flex-col items-center gap-1.5 text-fg-muted">
              <Upload className="w-5 h-5" />
              <span className="text-xs">拖拽 / 点击 / 粘贴图片（支持多选，单张 ≤ 20MB）</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* 队列列表 */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-xs font-medium text-fg-secondary">
                文件队列 {jobs.length > 0 && `(${jobs.length})`}
              </span>
              {jobs.length > 0 && (
                <button
                  onClick={clearAll}
                  disabled={isRunning}
                  className="text-[11px] text-fg-muted hover:text-rose-400 flex items-center gap-1 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" />
                  清空
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
              {jobs.length === 0 ? (
                <div className="text-[11px] text-fg-muted/70 text-center py-6">尚未添加图片</div>
              ) : (
                jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onSelect={() => selectJob(job.id)}
                    onRemove={() => removeJob(job.id)}
                    onRetry={() => handleRetry(job.id)}
                    onDownload={() => handleDownloadOne(job)}
                    onCrop={() => setCropOpen(true)}
                    canCrop={job.status !== 'processing' && !isRunning}
                    isRunning={isRunning}
                  />
                ))
              )}
            </div>
          </div>

          {/* Model picker */}
          <div className="shrink-0">
            <div className="text-xs font-medium text-fg-secondary mb-2">选择模型</div>
            {loadingModels ? (
              <div className="text-xs text-fg-muted">加载中…</div>
            ) : !hasInstalled ? (
              <button
                onClick={() => setPage('settings')}
                className="w-full flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning hover:bg-warning/15 transition-colors text-left"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">
                  尚未导入任何抠图模型。点击此处去「设置 → 抠图模型」导入 .onnx 文件。
                </span>
                <SettingsIcon className="w-4 h-4 shrink-0 mt-0.5" />
              </button>
            ) : (
              <div className="flex gap-1.5">
                {installedModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    disabled={isRunning}
                    className={cn(
                      'flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50',
                      selectedModelId === m.id
                        ? 'bg-primary/15 text-primary border border-primary'
                        : 'bg-surface-tertiary text-fg-secondary border border-transparent hover:border-primary/30',
                    )}
                    title={m.tagline}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {isRunning ? (
              <button
                onClick={cancel}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold bg-rose-500 text-white hover:bg-rose-600 transition-colors"
              >
                <Square className="w-4 h-4" />
                取消（处理中）
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={!selectedModelId || pendingCount === 0 || !hasInstalled}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:bg-surface-primary disabled:text-fg-muted disabled:cursor-not-allowed',
                )}
              >
                <Scissors className="w-4 h-4" />
                {pendingCount === 0 ? '无待处理任务' : `开始抠图（${pendingCount} 张待处理）`}
              </button>
            )}
            {completedJobs.length > 0 && (
              <button
                onClick={handleDownloadAll}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-surface-tertiary border border-border text-fg-secondary hover:text-fg-primary hover:border-primary/40 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                一键保存全部（{completedJobs.length} 张）
              </button>
            )}
          </div>
        </div>

        {/* Right: preview/comparison */}
        <div className="flex flex-col gap-4 bg-surface-secondary rounded-xl p-5 overflow-hidden min-h-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg-primary">
              {selectedJob ? selectedJob.fileName : '抠图结果'}
            </h2>
            <div className="flex items-center gap-2">
              {selectedJob?.elapsed != null && (
                <span className="text-xs text-fg-muted">用时 {selectedJob.elapsed.toFixed(1)}s</span>
              )}
              {selectedJob?.resultBlob && (
                <button
                  onClick={() => handleDownloadOne(selectedJob)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  title="保存为 PNG"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载
                </button>
              )}
            </div>
          </div>

          {/* 空状态 */}
          {!selectedJob && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-fg-muted">
              <Scissors className="w-10 h-10 opacity-40" />
              <p className="text-sm">添加图片后点「开始抠图」</p>
            </div>
          )}

          {/* 仅预览（未抠图） */}
          {selectedJob && !selectedJob.resultUrl && (
            <div className="flex-1 relative rounded-xl overflow-hidden bg-checker">
              <img src={selectedJob.previewUrl} alt="src" className="w-full h-full object-contain" />
              {selectedJob.status === 'processing' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 backdrop-blur-sm text-white">
                  <RotateCw className="w-8 h-8 animate-spin" />
                  <span className="text-sm">正在抠图…</span>
                  <span className="text-xs text-white/70">首次加载模型可能需要 5-10 秒</span>
                </div>
              )}
              {selectedJob.status === 'failed' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/60 backdrop-blur-sm text-rose-200 p-6">
                  <AlertCircle className="w-8 h-8" />
                  <span className="text-sm font-medium">抠图失败</span>
                  <span className="text-xs text-rose-200/80 text-center max-w-md">{selectedJob.errorMessage}</span>
                </div>
              )}
            </div>
          )}

          {/* 对比滑块 */}
          {selectedJob?.resultUrl && (
            <div
              ref={sliderContainerRef}
              className="flex-1 relative rounded-xl overflow-hidden bg-checker select-none"
            >
              <img src={selectedJob.resultUrl} alt="result" className="absolute inset-0 w-full h-full object-contain" />
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              >
                <img src={selectedJob.previewUrl} alt="src" className="absolute inset-0 w-full h-full object-contain" />
              </div>
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-lg cursor-ew-resize"
                style={{ left: `${sliderPos}%` }}
                onMouseDown={handleSliderMouseDown}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-xl flex items-center justify-center cursor-ew-resize">
                  <div className="flex gap-0.5">
                    <div className="w-0.5 h-3 bg-fg-secondary" />
                    <div className="w-0.5 h-3 bg-fg-secondary" />
                  </div>
                </div>
              </div>
              <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">原图</span>
              <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">抠图后</span>
            </div>
          )}
        </div>
      </div>

      {/* 裁剪 modal */}
      {cropOpen && selectedJob && (
        <RembgCropModal
          file={selectedJob.file}
          onCancel={() => setCropOpen(false)}
          onConfirm={(cropped) => {
            setCropOpen(false);
            // 用裁剪后的 file 替换该 job：先删除原 job，再加新 file
            removeJob(selectedJob.id);
            addFiles([cropped]);
          }}
        />
      )}
    </div>
  );
}

// 队列每行
function JobRow({
  job,
  selected,
  onSelect,
  onRemove,
  onRetry,
  onDownload,
  onCrop,
  canCrop,
  isRunning,
}: {
  job: RembgJob;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onDownload: () => void;
  onCrop: () => void;
  canCrop: boolean;
  isRunning: boolean;
}) {
  const statusBadge = (() => {
    switch (job.status) {
      case 'pending':
        return { label: '等待', cls: 'bg-surface-tertiary text-fg-muted' };
      case 'processing':
        return { label: '处理中', cls: 'bg-primary/15 text-primary' };
      case 'completed':
        return { label: '完成', cls: 'bg-emerald-500/15 text-emerald-400' };
      case 'failed':
        return { label: '失败', cls: 'bg-rose-500/15 text-rose-400' };
    }
  })();

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors',
        selected
          ? 'bg-primary/10 border border-primary/40'
          : 'bg-surface-primary border border-border hover:border-primary/30',
      )}
    >
      {/* 缩略图 */}
      <div className="w-10 h-10 rounded shrink-0 bg-checker overflow-hidden">
        <img
          src={job.resultUrl || job.previewUrl}
          alt=""
          className="w-full h-full object-cover"
        />
      </div>

      {/* 名称 + 状态 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-primary truncate flex-1">{job.fileName}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5', statusBadge.cls)}>
            {job.status === 'processing' && <RotateCw className="w-2.5 h-2.5 animate-spin" />}
            {job.status === 'completed' && <Check className="w-2.5 h-2.5" />}
            {statusBadge.label}
          </span>
          {job.elapsed != null && (
            <span className="text-[10px] text-fg-muted font-mono">{job.elapsed.toFixed(1)}s</span>
          )}
        </div>
      </div>

      {/* 行内操作 */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {job.status === 'pending' && canCrop && (
          <button
            onClick={(e) => { e.stopPropagation(); onCrop(); }}
            className="p-1 rounded hover:bg-surface-tertiary text-fg-muted hover:text-fg-primary"
            title="裁剪后再抠"
          >
            <Crop className="w-3 h-3" />
          </button>
        )}
        {job.status === 'completed' && (
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            className="p-1 rounded hover:bg-surface-tertiary text-fg-muted hover:text-fg-primary"
            title="下载"
          >
            <Download className="w-3 h-3" />
          </button>
        )}
        {job.status === 'failed' && !isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            className="p-1 rounded hover:bg-surface-tertiary text-fg-muted hover:text-fg-primary"
            title="重试"
          >
            <RefreshCcw className="w-3 h-3" />
          </button>
        )}
        {job.status !== 'processing' && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1 rounded hover:bg-surface-tertiary text-fg-muted hover:text-rose-400"
            title="移除"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
