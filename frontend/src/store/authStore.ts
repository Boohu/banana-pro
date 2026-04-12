import { create } from 'zustand';
import axios from 'axios';
import { login as apiLogin, register as apiRegister, getMe, type UserInfo, type AccessInfo } from '../services/authApi';

// 离线宽限期缓存 key 和有效时长（24 小时）
const AUTH_CACHE_KEY = 'auth_cache';
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  accessInfo: AccessInfo | null;
  isAuthenticated: boolean;
  hasAccess: boolean;
  isLoading: boolean;

  // 动作
  login: (params: { email?: string; phone?: string; password?: string; code?: string }) => Promise<void>;
  register: (params: { email?: string; phone?: string; password?: string; code?: string; nickname?: string }) => Promise<void>;
  checkAuth: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  accessInfo: null,
  isAuthenticated: false,
  hasAccess: false,
  isLoading: true,

  login: async (params) => {
    const res = await apiLogin(params);
    console.log('[AuthStore] login response:', JSON.stringify(res));
    const { token, user, access } = res.data;
    console.log('[AuthStore] access:', JSON.stringify(access), 'has_access:', access?.has_access);
    localStorage.setItem('auth_token', token);
    set({
      token,
      user,
      accessInfo: access,
      isAuthenticated: true,
      hasAccess: access?.has_access ?? true,
      isLoading: false,
    });
  },

  register: async (params) => {
    const res = await apiRegister(params);
    const { token, user, access } = res.data;
    localStorage.setItem('auth_token', token);
    set({
      token,
      user,
      accessInfo: access,
      isAuthenticated: true,
      hasAccess: access?.has_access ?? true,
      isLoading: false,
    });
  },

  checkAuth: async () => {
    // 如果已经通过 login() 认证过了，不重复检查
    if (get().isAuthenticated) {
      set({ isLoading: false });
      return;
    }
    const token = localStorage.getItem('auth_token');
    if (!token) {
      set({ isAuthenticated: false, hasAccess: false, isLoading: false });
      return;
    }
    try {
      const res = await getMe();
      // 验证成功，缓存 accessInfo + 时间戳用于离线宽限
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        accessInfo: res.data,
        cachedAt: Date.now(),
      }));
      set({
        token,
        user: res.data.user,
        accessInfo: res.data,
        isAuthenticated: true,
        hasAccess: res.data.has_access,
        isLoading: false,
      });
    } catch (err: unknown) {
      // 401 表示 token 无效/被踢，直接清除登录，不走宽限期
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem(AUTH_CACHE_KEY);
        set({ token: null, user: null, accessInfo: null, isAuthenticated: false, hasAccess: false, isLoading: false });
        return;
      }

      // 网络错误等非 401 情况，尝试离线宽限
      try {
        const raw = localStorage.getItem(AUTH_CACHE_KEY);
        const cache = raw ? JSON.parse(raw) as { accessInfo: AccessInfo; cachedAt: number } : null;
        if (cache && Date.now() - cache.cachedAt < GRACE_PERIOD_MS) {
          console.log('[AuthStore] 网络异常，使用离线宽限缓存');
          set({
            token,
            user: cache.accessInfo.user,
            accessInfo: cache.accessInfo,
            isAuthenticated: true,
            hasAccess: cache.accessInfo.has_access,
            isLoading: false,
          });
          return;
        }
      } catch {
        // 缓存解析失败，忽略
      }

      // 无缓存或缓存过期，清除登录
      localStorage.removeItem('auth_token');
      localStorage.removeItem(AUTH_CACHE_KEY);
      set({ token: null, user: null, accessInfo: null, isAuthenticated: false, hasAccess: false, isLoading: false });
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem(AUTH_CACHE_KEY);
    set({ token: null, user: null, accessInfo: null, isAuthenticated: false, hasAccess: false });
  },
}));
