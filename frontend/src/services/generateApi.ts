import api from './api';
import { BatchGenerateRequest, BackendTask, BackendBatch, DraftBatchRequest } from '../types';
import { mapBackendTaskToFrontend } from '../utils/mapping';

// 批量生成图片 (JSON 版)
// 后端接口为 /tasks/generate
// 注意：API 拦截器已解包 response.data，返回的是实际数据
export const generateBatch = async (params: BatchGenerateRequest) => {
  const res = await api.post<BackendTask>('/tasks/generate', params);
  return mapBackendTaskToFrontend(res as unknown as BackendTask);
};

// 批量图生图 (FormData 版)
// 后端接口为 /tasks/generate-with-images
export const generateBatchWithImages = async (formData: FormData) => {
  const res = await api.post<BackendTask>('/tasks/generate-with-images', formData);
  return mapBackendTaskToFrontend(res as unknown as BackendTask);
};

// 查询任务状态 (后端接口为 /tasks/:task_id)
export const getTaskStatus = async (taskId: string) => {
  const res = await api.get<BackendTask>(`/tasks/${taskId}`);
  return mapBackendTaskToFrontend(res as unknown as BackendTask);
};

// ---------- 批次 API ----------

// 创建或更新草稿批次
export const createDraftBatch = async (config: DraftBatchRequest): Promise<BackendBatch> => {
  const res = await api.post<BackendBatch>('/batches/draft', config);
  return res as unknown as BackendBatch;
};

// 提交批次开始生成
export const submitBatch = async (batchId: string): Promise<BackendBatch> => {
  const res = await api.post<BackendBatch>(`/batches/${batchId}/submit`);
  return res as unknown as BackendBatch;
};

// 查询批次状态（含子任务）
export const getBatchStatus = async (batchId: string): Promise<BackendBatch> => {
  const res = await api.get<BackendBatch>(`/batches/${batchId}`);
  return res as unknown as BackendBatch;
};

// 分页查询批次列表
export const listBatches = async (page = 1, pageSize = 20): Promise<{ total: number; list: BackendBatch[] }> => {
  const res = await api.get<{ total: number; list: BackendBatch[] }>('/batches', { params: { page, page_size: pageSize } });
  return res as unknown as { total: number; list: BackendBatch[] };
};