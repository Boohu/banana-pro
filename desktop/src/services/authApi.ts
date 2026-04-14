import axios from 'axios';

// 当前应用 ID（多应用授权）
export const APP_ID = 'jdyai';

// 认证服务地址（独立于图片生成后端）
export const AUTH_URL = import.meta.env.VITE_AUTH_URL || 'https://auth.3ux.cn/api';

const authApi = axios.create({
  baseURL: AUTH_URL,
  timeout: 15000,
});

// 请求拦截器：自动带上 Token
authApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器
authApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // 401 不做任何自动处理，让调用方自己决定
    // （避免拦截器和 login/checkAuth 竞态导致误清状态）
    return Promise.reject(error);
  }
);

// --- API 函数 ---

export interface AuthResponse {
  code: number;
  message: string;
  data: {
    token: string;
    user: UserInfo;
    access: AccessInfo;
  };
}

export interface UserInfo {
  id: number;
  email: string;
  phone: string;
  nickname: string;
  trial_expires_at: string;
  created_at: string;
}

export interface AccessInfo {
  user: UserInfo;
  app_id: string;
  has_access: boolean;
  access_reason: 'trial' | 'subscription' | 'expired';
  subscription?: {
    plan: string;
    expires_at: string;
  };
  days_left: number;
}

export interface OrderInfo {
  order_id: number;
  order_no: string;
  plan: string;
  amount: number;
  amount_yuan: string;
  pay_method: string;
  qr_code_url: string;
  status: string;
}

// 注册
export const register = async (params: {
  email?: string;
  phone?: string;
  password?: string;
  code?: string;
  nickname?: string;
}): Promise<AuthResponse> => {
  return authApi.post('/auth/register', { ...params, app_id: APP_ID }) as any;
};

// 登录
export const login = async (params: {
  email?: string;
  phone?: string;
  password?: string;
  code?: string;
}): Promise<AuthResponse> => {
  return authApi.post('/auth/login', { ...params, app_id: APP_ID }) as any;
};

// 获取当前用户 + 订阅状态
export const getMe = async (): Promise<{ code: number; data: AccessInfo }> => {
  return authApi.get(`/auth/me?app_id=${APP_ID}`) as any;
};

// 刷新 Token
export const refreshToken = async (): Promise<{ code: number; data: { token: string } }> => {
  return authApi.post('/auth/refresh') as any;
};

// 创建支付订单
export const createOrder = async (plan: string, payMethod: string): Promise<{ code: number; data: OrderInfo }> => {
  return authApi.post('/subscription/create-order', { plan, pay_method: payMethod, app_id: APP_ID }) as any;
};

// 查询订单状态
export const getOrderStatus = async (orderId: number): Promise<{ code: number; data: { status: string } }> => {
  return authApi.get(`/subscription/order/${orderId}`) as any;
};

// 重置密码
export const resetPassword = async (params: {
  phone?: string;
  email?: string;
  code: string;
  new_password: string;
}): Promise<{ code: number; message: string }> => {
  return authApi.post('/auth/reset-password', params) as any;
};

// 查询订阅状态
export const getSubscriptionStatus = async (): Promise<{ code: number; data: AccessInfo }> => {
  return authApi.get(`/subscription/status?app_id=${APP_ID}`) as any;
};
