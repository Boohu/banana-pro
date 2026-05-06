import { GenerationTask, GeneratedImage, BackendTask, BackendHistoryResponse } from '../types';
import { getImageUrl } from '../services/api';

/**
 * 将后端 Task 模型映射为前端 GenerationTask 模型
 */
// 按文件名后缀推断 mimeType（storage 落地时已识别真实格式选用对应后缀）
const mimeFromPath = (path: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec((path || '').trim());
  if (!m) return 'image/png';
  const ext = m[1].toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/' + ext;
};

export const mapBackendTaskToFrontend = (task: BackendTask): GenerationTask => {
  const getFullUrl = (path: string | undefined) => {
    return getImageUrl(path || '');
  };

  const image: GeneratedImage = {
    id: task.task_id,
    taskId: task.task_id,
    filePath: task.local_path || '',
    thumbnailPath: task.thumbnail_path || '',
    fileSize: 0,
    width: task.width || 0,
    height: task.height || 0,
    mimeType: mimeFromPath(task.local_path || task.image_url || ''),
    createdAt: task.created_at,
    prompt: task.prompt,
    model: task.model_id || task.provider_name || '',
    status: task.status === 'completed' ? 'success' : (task.status === 'failed' ? 'failed' : 'pending'),
    // 弹窗预览使用原图
    url: getFullUrl(task.local_path || task.image_url || task.thumbnail_path || task.thumbnail_url),
    // 卡片展示优先使用缩略图
    thumbnailUrl: getFullUrl(task.thumbnail_path || task.local_path || task.thumbnail_url || task.image_url),
    // 参考图（对比图用）
    originalImagePath: task.original_image_path || '',
    originalImageUrl: task.original_image_path ? getFullUrl(task.original_image_path) : '',
    // 注入任务开始/完成时间，用于 ImageCard 显示耗时
    // taskCompletedAt 优先 task.updated_at；终态任务（completed/failed/partial）后端没给 updated_at 时，
    // 用拿到响应这一刻 fallback（前端到响应这一刻 ≈ 任务真实结束时刻 ± 网络延迟）
    taskStartedAt: task.created_at,
    taskCompletedAt: task.updated_at
      || (task.status === 'completed' || task.status === 'failed' || task.status === 'partial'
          ? new Date().toISOString()
          : ''),
  };

  return {
    id: task.task_id,
    prompt: task.prompt,
    model: task.model_id || task.provider_name || '',
    totalCount: task.total_count || 1,
    completedCount: task.status === 'completed' ? (task.total_count || 1) : 0,
    status: task.status as GenerationTask['status'],
    errorMessage: task.error_message || '',
    options: task.config_snapshot || '',
    createdAt: task.created_at,
    updatedAt: task.updated_at || '',
    images: [image]
  };
};

/**
 * 将后端列表响应映射为前端列表格式
 */
export const mapBackendHistoryResponse = (response: BackendHistoryResponse) => {
  // 后端现在返回格式为 { list: [], total: 0 }
  const { list, total } = response;
  return {
    list: (list || []).map(mapBackendTaskToFrontend),
    total: total || 0
  };
};
