import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { IMAGE_MODEL_OPTIONS } from './configStore';

// 批量处理文件状态（可序列化）
export interface BatchFileState {
  name: string;
  size: number;
  taskId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  resultUrl?: string;
  errorMessage?: string;
}

// 批量处理任务状态（可序列化）
export interface BatchJobState {
  id: string;
  name: string;
  backendBatchId?: string;
  fileStates: BatchFileState[];
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  outputCompression: number; // 0-100，仅 webp/jpeg 输出生效；旧字段名 quality
  concurrency: number;
  outputFormat: 'PNG' | 'JPG' | 'WebP';
  // OpenAI gpt-image-* 系列专属
  imageQuality: 'low' | 'medium' | 'high' | 'auto';
  imageBackground: 'transparent' | 'opaque' | 'auto';
  gptImageSize: string; // 8 项预设之一（auto/1024x1024/.../2160x3840）
  keepOriginalSize: boolean;
  promptOptEnabled: boolean;
  autoRetry: boolean;
  outputDir: string;
  namingRule: string;
  jobStatus: 'pending' | 'processing' | 'completed' | 'paused';
}

interface BatchStore {
  jobs: BatchJobState[];
  selectedJobId: string | null;

  addJob: (name: string, defaultModel?: string) => string;
  removeJob: (id: string) => void;
  setSelectedJob: (id: string) => void;
  updateJobConfig: (id: string, updates: Partial<BatchJobState>) => void;
  addFiles: (jobId: string, files: { name: string; size: number }[]) => void;
  removeFile: (jobId: string, index: number) => void;
  setBackendBatchId: (jobId: string, batchId: string) => void;
  setFileTaskId: (jobId: string, fileIndex: number, taskId: string) => void;
  setFileStatus: (jobId: string, fileIndex: number, status: BatchFileState['status'], resultUrl?: string, errorMessage?: string) => void;
  setJobStatus: (jobId: string, status: BatchJobState['jobStatus']) => void;
}

const createDefaultJob = (name: string, model?: string): BatchJobState => ({
  id: Date.now().toString(),
  name,
  fileStates: [],
  prompt: '',
  model: model || IMAGE_MODEL_OPTIONS[0].value,
  aspectRatio: '1:1',
  resolution: '2K',
  outputCompression: 100,
  concurrency: 3,
  outputFormat: 'PNG',
  imageQuality: 'auto',
  imageBackground: 'auto',
  gptImageSize: 'auto',
  keepOriginalSize: true,
  promptOptEnabled: true,
  autoRetry: false,
  outputDir: '',
  namingRule: '原文件名_edited',
  jobStatus: 'pending',
});

export const useBatchStore = create<BatchStore>()(
  persist(
    (set) => {
      const initialJob = createDefaultJob('批次 1');
      return {
        jobs: [initialJob],
        selectedJobId: initialJob.id,

        addJob: (name, defaultModel) => {
          const job = createDefaultJob(name, defaultModel);
          set((state) => ({
            jobs: [...state.jobs, job],
            selectedJobId: job.id,
          }));
          return job.id;
        },

        removeJob: (id) => set((state) => {
          const next = state.jobs.filter((j) => j.id !== id);
          return {
            jobs: next,
            selectedJobId: state.selectedJobId === id
              ? (next[0]?.id ?? null)
              : state.selectedJobId,
          };
        }),

        setSelectedJob: (id) => set({ selectedJobId: id }),

        updateJobConfig: (id, updates) => set((state) => ({
          jobs: state.jobs.map((j) => j.id === id ? { ...j, ...updates } : j),
        })),

        addFiles: (jobId, files) => set((state) => ({
          jobs: state.jobs.map((j) => j.id !== jobId ? j : {
            ...j,
            fileStates: [
              ...j.fileStates,
              ...files.map((f) => ({
                name: f.name,
                size: f.size,
                status: 'pending' as const,
              })),
            ],
          }),
        })),

        removeFile: (jobId, index) => set((state) => ({
          jobs: state.jobs.map((j) => j.id !== jobId ? j : {
            ...j,
            fileStates: j.fileStates.filter((_, i) => i !== index),
          }),
        })),

        setBackendBatchId: (jobId, batchId) => set((state) => ({
          jobs: state.jobs.map((j) => j.id === jobId ? { ...j, backendBatchId: batchId } : j),
        })),

        setFileTaskId: (jobId, fileIndex, taskId) => set((state) => ({
          jobs: state.jobs.map((j) => j.id !== jobId ? j : {
            ...j,
            fileStates: j.fileStates.map((f, i) => i === fileIndex ? { ...f, taskId } : f),
          }),
        })),

        setFileStatus: (jobId, fileIndex, status, resultUrl, errorMessage) => set((state) => ({
          jobs: state.jobs.map((j) => j.id !== jobId ? j : {
            ...j,
            fileStates: j.fileStates.map((f, i) => i === fileIndex
              ? { ...f, status, ...(resultUrl !== undefined ? { resultUrl } : {}), ...(errorMessage !== undefined ? { errorMessage } : {}) }
              : f
            ),
          }),
        })),

        setJobStatus: (jobId, status) => set((state) => ({
          jobs: state.jobs.map((j) => j.id === jobId ? { ...j, jobStatus: status } : j),
        })),
      };
    },
    {
      // v2: 字段重构 — quality:number → outputCompression:number，新增 imageQuality / imageBackground
      name: 'batch-store-v2',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
