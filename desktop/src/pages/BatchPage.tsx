import React, { useState, useRef } from 'react';
import { FolderOpen, Play, Pause, Plus, ChevronDown, X, ArrowRight, Loader2, ImagePlus, Image as ImageIcon, Trash2, Folder, CircleCheck, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { IMAGE_MODEL_OPTIONS, CUSTOM_MODEL_VALUE, useConfigStore } from '@/store/configStore';

interface BatchFile {
  file: File;
  previewUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
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
  namingRule: string;
  status: 'pending' | 'processing' | 'completed';
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
  keepOriginalSize: true,
  promptOptEnabled: true,
  autoRetry: false,
  outputDir: '',
  namingRule: '原文件名_edited',
  status: 'pending',
});

// ---- Batch List Sidebar ----
function BatchListSidebar({ batches, selectedId, onSelect, onAdd }: {
  batches: BatchJob[]; selectedId: string | null; onSelect: (id: string) => void; onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-[280px] shrink-0 border-r border-border flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-fg-primary">{t('批次列表', '批次列表')}</h3>
        <button onClick={onAdd} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {t('新建', '新建')}
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
            <button
              key={batch.id}
              onClick={() => onSelect(batch.id)}
              className={cn(
                'w-full text-left px-3.5 py-3 rounded-xl space-y-2 transition-colors',
                isSelected ? 'bg-primary/10 ring-1 ring-primary' : 'bg-surface-secondary hover:bg-surface-tertiary'
              )}
            >
              <div className="flex items-center gap-2">
                {isCompleted ? (
                  <CircleCheck className="w-4 h-4 text-success shrink-0" />
                ) : (
                  <Folder className={cn('w-4 h-4 shrink-0', isSelected ? 'text-primary' : 'text-fg-muted')} />
                )}
                <span className={cn('text-[13px] font-medium truncate', isCompleted ? 'text-fg-secondary' : 'text-fg-primary')}>{batch.name}</span>
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
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">已完成</span>
                )}
                {batch.status === 'pending' && totalCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-tertiary text-fg-muted">排队中</span>
                )}
              </div>
            </button>
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
  // 如果设置里用的是自定义模型（不在预设列表里），加到下拉选项中
  const isCustomModel = !IMAGE_MODEL_OPTIONS.some((opt) => opt.value === currentImageModel);
  const modelOptions = isCustomModel
    ? [...IMAGE_MODEL_OPTIONS, { value: currentImageModel, label: `自定义 (${currentImageModel})` }]
    : IMAGE_MODEL_OPTIONS;
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
        <h3 className="text-[15px] font-semibold text-fg-primary">{t('批次配置', '批次配置')}</h3>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('提示词', '提示词')}</label>
        <textarea
          value={batch.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="描述你希望对图片做的处理..."
          className="w-full h-20 rounded-[10px] bg-surface-tertiary border border-border px-3.5 py-2.5 text-[13px] text-fg-primary placeholder:text-fg-muted outline-none resize-none focus:border-primary transition-colors"
        />
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('模型', '模型')}</label>
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
        <label className="text-xs font-medium text-fg-secondary">{t('尺寸', '尺寸')}</label>
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
        <label className="text-xs font-medium text-fg-secondary">{t('分辨率', '分辨率')}</label>
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
        <label className="text-xs font-medium text-fg-secondary">{t('输出格式', '输出格式')}</label>
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
          <label className="text-xs font-medium text-fg-secondary">{t('图片质量', '图片质量')}</label>
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
          <label className="text-xs font-medium text-fg-secondary">{t('并发数量', '并发数量')}</label>
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

      {/* Output directory */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('输出目录', '输出目录')}</label>
        <div className="flex items-center gap-2 bg-surface-tertiary border border-border rounded-[10px] px-3 py-2.5">
          <input
            type="text"
            value={batch.outputDir}
            onChange={(e) => onChange({ outputDir: e.target.value })}
            placeholder={isTauri ? '/Users/photos/output' : '留空则保存到默认目录'}
            className="flex-1 bg-transparent text-[13px] text-fg-primary font-mono placeholder:text-fg-muted outline-none"
          />
          {isTauri && (
            <button
              onClick={async () => {
                try {
                  const { open } = await import('@tauri-apps/plugin-dialog');
                  const selected = await open({ directory: true, multiple: false });
                  if (selected && typeof selected === 'string') onChange({ outputDir: selected });
                } catch (e) { console.error('Folder select failed:', e); }
              }}
              className="p-1 rounded hover:bg-surface-secondary transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 text-fg-secondary" />
            </button>
          )}
        </div>
        {!isTauri && <span className="text-[10px] text-fg-muted">{t('Web 版自动保存到服务器存储目录', 'Web 版自动保存到服务器存储目录')}</span>}
      </div>

      {/* Naming rule */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t('命名规则', '命名规则')}</label>
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
        <label className="text-xs font-medium text-fg-secondary">{t('保留原始尺寸', '保留原始尺寸')}</label>
        <Toggle checked={batch.keepOriginalSize} onToggle={() => onChange({ keepOriginalSize: !batch.keepOriginalSize })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-fg-secondary">{t('提示词优化', '提示词优化')}</label>
        <Toggle checked={batch.promptOptEnabled} onToggle={() => onChange({ promptOptEnabled: !batch.promptOptEnabled })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-fg-secondary">{t('失败自动重试', '失败自动重试')}</label>
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

  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || batches[0];

  const updateBatch = (id: string, updates: Partial<BatchJob>) => {
    setBatches((prev) => prev.map((b) => b.id === id ? { ...b, ...updates } : b));
  };

  const addBatch = () => {
    const newBatch = createBatchJob(`批次 ${batches.length + 1}`, currentImageModel);
    setBatches((prev) => [...prev, newBatch]);
    setSelectedBatchId(newBatch.id);
  };

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
      />

      {/* Center: file list for selected batch */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-5 py-3 bg-surface-secondary">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-primary" />
            <h3 className="text-[15px] font-semibold text-fg-primary">{selectedBatch.name}</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              {selectedBatch.status === 'completed' ? '已完成' : selectedBatch.status === 'processing' ? '处理中' : '待处理'}
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
              <h2 className="text-lg font-semibold text-fg-primary mb-2">{t('添加图片', '添加图片到此批次')}</h2>
              <p className="text-sm text-fg-muted mb-4">{t('选择要处理的图片文件', '选择要处理的图片文件')}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-secondary border border-border text-sm text-fg-secondary hover:text-fg-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('选择文件', '选择文件')}
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
                  添加更多
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
                  <div className="w-12 h-12 rounded-lg bg-surface-tertiary flex items-center justify-center shrink-0">
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
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success">完成</span>
                    ) : item.status === 'processing' ? (
                      <span className="text-[10px] font-mono text-primary">{item.progress}%</span>
                    ) : item.status === 'failed' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-error/15 text-error">失败</span>
                    ) : (
                      <span className="text-[10px] text-fg-muted">等待</span>
                    )}
                  </div>
                  {item.status === 'completed' && item.resultUrl && (
                    <button
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = item.resultUrl!;
                        a.download = item.file.name.replace(/\.[^.]+$/, '_edited$&');
                        a.click();
                      }}
                      className="text-fg-muted hover:text-success transition-colors shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
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
            <span className="text-xs font-semibold text-fg-primary">{t('当前批次', '当前批次')}</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface-tertiary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: selectedBatch.files.length > 0 ? `${(completedCount / selectedBatch.files.length) * 100}%` : '0%' }} />
            </div>
            <span className="text-xs font-semibold text-primary font-mono">{completedCount} / {selectedBatch.files.length}</span>
            <button
              disabled={selectedBatch.files.length === 0 || !selectedBatch.prompt.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              开始
            </button>
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-surface-tertiary border border-border text-xs text-fg-secondary hover:text-fg-primary transition-colors">
              <Pause className="w-3.5 h-3.5" />
              暂停
            </button>
            {completedCount > 0 && (
              <button
                onClick={() => {
                  // 逐个下载已完成的图片
                  selectedBatch.files.forEach((f) => {
                    if (f.status === 'completed' && f.resultUrl) {
                      const a = document.createElement('a');
                      a.href = f.resultUrl;
                      a.download = f.file.name.replace(/\.[^.]+$/, '_edited$&');
                      a.click();
                    }
                  });
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-success/15 text-success text-xs font-semibold hover:bg-success/25 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                下载全部 ({completedCount})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right config panel */}
      <BatchConfigPanel batch={selectedBatch} onChange={(updates) => updateBatch(selectedBatch.id, updates)} />
    </div>
  );
}
