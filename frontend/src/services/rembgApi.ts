import api, { ApiRequestConfig } from './api';

// 抠图模块的 sidecar HTTP API
//
// 业务模式：BYO Model（Bring Your Own Model）
// - 我们不分发模型文件，用户自己从 HuggingFace 下载 .onnx 后导入
// - sidecar 通过 onnxruntime 推理，输出带 alpha 通道的 PNG

export interface RembgModel {
  id: string; // 'rmbg-1.4' / 'rmbg-2.0' / 'u2net'
  name: string;
  tagline: string;
  license: string;
  hf_link: string;
  input_size: number;
  expected_mb: number;
  installed: boolean;
  file_path?: string;
  file_size?: number;
}

interface ListResponse {
  models: RembgModel[];
}

/** 列出所有支持的抠图模型 + 当前导入状态 */
export const listRembgModels = async (): Promise<RembgModel[]> => {
  const res = await api.get<any>('/rembg/models');
  // 全局拦截器已解包 ApiResponse.data
  const data = (res as unknown as ListResponse) || { models: [] };
  return data.models || [];
};

/** 导入用户本地的 .onnx 文件（路径由 Tauri 文件选择对话框拿到） */
export const importRembgModel = async (presetId: string, filePath: string): Promise<RembgModel> => {
  const res = await api.post<any>('/rembg/import', {
    preset_id: presetId,
    file_path: filePath,
  });
  const data = res as any;
  return data?.model;
};

/** 删除已导入的模型文件 */
export const deleteRembgModel = async (presetId: string): Promise<void> => {
  await api.delete<any>(`/rembg/models/${presetId}`);
};

/** 用指定模型抠图，返回 PNG Blob */
export const removeBackground = async (modelId: string, imageFile: File): Promise<Blob> => {
  const formData = new FormData();
  formData.append('model_id', modelId);
  formData.append('image', imageFile);
  try {
    const res = await api.post('/rembg/remove', formData, {
      // 不要手动设置 Content-Type，让浏览器/axios 自动加上 multipart boundary
      responseType: 'blob',
      __returnResponse: true,
    } as ApiRequestConfig);
    return (res as any).data as Blob;
  } catch (err: any) {
    // 后端错误响应是 JSON，但 responseType=blob 把它当 Blob 收下来，需要手动解一下
    const respBlob: Blob | undefined = err?.response?.data || err?.original?.response?.data;
    if (respBlob && typeof (respBlob as any).text === 'function') {
      try {
        const text = await respBlob.text();
        const parsed = JSON.parse(text);
        if (parsed?.message) throw new Error(parsed.message);
      } catch (parseErr: any) {
        if (parseErr instanceof Error && parseErr.message) throw parseErr;
      }
    }
    throw err;
  }
};
