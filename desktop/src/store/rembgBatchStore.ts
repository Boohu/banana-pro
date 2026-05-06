import { create } from 'zustand';
import { removeBackground } from '@/services/rembgApi';

// 批量抠图任务状态（不持久化，刷新即丢失；切页面但不刷新时保留）
//
// 设计：
// - 任务执行（runBatch）跑在 store action 里，不依赖组件 mount
// - 组件订阅 store 渲染列表，切走后任务继续，切回来看到当前状态
// - File 对象不能 JSON 序列化，因此本 store 不 persist；刷新后清空

export interface RembgJob {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  previewUrl: string;          // 原图 blob URL（运行时）
  status: 'pending' | 'processing' | 'completed' | 'failed';
  resultBlob?: Blob;
  resultUrl?: string;          // 结果 blob URL（运行时）
  elapsed?: number;
  errorMessage?: string;
  modelId?: string;            // 实际处理用的模型（开始时锁定）
}

interface RembgBatchState {
  jobs: RembgJob[];
  selectedJobId: string | null; // 当前预览的 job
  isRunning: boolean;
  concurrency: number;
  cancelRequested: boolean;

  addFiles: (files: File[]) => void;
  removeJob: (id: string) => void;
  selectJob: (id: string | null) => void;
  clearAll: () => void;
  setConcurrency: (n: number) => void;
  runBatch: (modelId: string) => Promise<void>;
  retryJob: (id: string, modelId: string) => Promise<void>;
  cancel: () => void;
}

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

export const useRembgBatchStore = create<RembgBatchState>((set, get) => ({
  jobs: [],
  selectedJobId: null,
  isRunning: false,
  concurrency: 2,
  cancelRequested: false,

  addFiles: (files: File[]) => {
    const newJobs: RembgJob[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > MAX_IMAGE_SIZE) continue;
      newJobs.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        fileName: f.name,
        fileSize: f.size,
        previewUrl: URL.createObjectURL(f),
        status: 'pending',
      });
    }
    if (newJobs.length === 0) return;
    set((s) => ({
      jobs: [...s.jobs, ...newJobs],
      selectedJobId: s.selectedJobId || newJobs[0].id,
    }));
  },

  removeJob: (id: string) => {
    const target = get().jobs.find((j) => j.id === id);
    if (target) {
      if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
    }
    set((s) => ({
      jobs: s.jobs.filter((j) => j.id !== id),
      selectedJobId: s.selectedJobId === id
        ? (s.jobs.find((j) => j.id !== id)?.id || null)
        : s.selectedJobId,
    }));
  },

  selectJob: (id) => set({ selectedJobId: id }),

  clearAll: () => {
    const jobs = get().jobs;
    for (const j of jobs) {
      if (j.previewUrl) URL.revokeObjectURL(j.previewUrl);
      if (j.resultUrl) URL.revokeObjectURL(j.resultUrl);
    }
    set({ jobs: [], selectedJobId: null });
  },

  setConcurrency: (n) => set({ concurrency: Math.max(1, Math.min(4, n)) }),

  runBatch: async (modelId: string) => {
    if (get().isRunning) return;
    const pending = get().jobs.filter((j) => j.status === 'pending' || j.status === 'failed');
    if (pending.length === 0) return;

    set({ isRunning: true, cancelRequested: false });

    // 简易并发池：维护 concurrency 个 worker，每个不停地从 pending 队列取任务
    const concurrency = get().concurrency;
    const queue = pending.map((j) => j.id);

    const runOne = async (jobId: string) => {
      if (get().cancelRequested) return;
      const job = get().jobs.find((j) => j.id === jobId);
      if (!job) return;

      // 标记 processing
      set((s) => ({
        jobs: s.jobs.map((j) => j.id === jobId ? { ...j, status: 'processing', errorMessage: undefined, modelId } : j),
      }));

      const start = Date.now();
      try {
        const blob = await removeBackground(modelId, job.file);
        if (get().cancelRequested) return;
        const url = URL.createObjectURL(blob);
        const elapsed = (Date.now() - start) / 1000;
        set((s) => ({
          jobs: s.jobs.map((j) => j.id === jobId
            ? { ...j, status: 'completed', resultBlob: blob, resultUrl: url, elapsed }
            : j
          ),
        }));
      } catch (err: any) {
        if (get().cancelRequested) return;
        const msg = err?.message || String(err);
        set((s) => ({
          jobs: s.jobs.map((j) => j.id === jobId ? { ...j, status: 'failed', errorMessage: msg } : j),
        }));
      }
    };

    const worker = async () => {
      while (queue.length > 0 && !get().cancelRequested) {
        const next = queue.shift();
        if (next) await runOne(next);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
    set({ isRunning: false, cancelRequested: false });
  },

  retryJob: async (id: string, modelId: string) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job || get().isRunning) return;

    set({ isRunning: true, cancelRequested: false });
    set((s) => ({
      jobs: s.jobs.map((j) => j.id === id ? { ...j, status: 'processing', errorMessage: undefined, modelId } : j),
    }));

    const start = Date.now();
    try {
      const blob = await removeBackground(modelId, job.file);
      const url = URL.createObjectURL(blob);
      const elapsed = (Date.now() - start) / 1000;
      set((s) => ({
        jobs: s.jobs.map((j) => j.id === id
          ? { ...j, status: 'completed', resultBlob: blob, resultUrl: url, elapsed }
          : j
        ),
      }));
    } catch (err: any) {
      const msg = err?.message || String(err);
      set((s) => ({
        jobs: s.jobs.map((j) => j.id === id ? { ...j, status: 'failed', errorMessage: msg } : j),
      }));
    } finally {
      set({ isRunning: false });
    }
  },

  cancel: () => {
    set({ cancelRequested: true });
  },
}));
