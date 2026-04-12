import { create } from 'zustand';
import axios from 'axios';
import { login as apiLogin, register as apiRegister, getMe, type UserInfo, type AccessInfo } from '../services/authApi';

// 离线宽限期缓存 key 和有效时长（24 小时）
const AUTH_CACHE_KEY = 'auth_cache';
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * 会话版本号：每次 login/register 成功后递增。
 * checkAuth 的异步结果只有在版本号匹配时才允许写入 store，
 * 从而彻底避免"旧 getMe 响应覆盖新登录态"的竞态问题。
 */
let sessionVersion = 0;

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  accessInfo: AccessInfo | null;
  isAuthenticated: boolean;
  hasAccess: boolean;
  isLoading: boolean;
  showSubscription: boolean; // 主动打开订阅页（不影响 hasAccess）

  // 动作
  login: (params: { email?: string; phone?: string; password?: string; code?: string }) => Promise<void>;
  register: (params: { email?: string; phone?: string; password?: string; code?: string; nickname?: string }) => Promise<void>;
  /** 检查登录态。force=true 时即使已登录也重新拉取（用于付费后刷新状态） */
  checkAuth: (force?: boolean) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  accessInfo: null,
  isAuthenticated: false,
  hasAccess: false,
  showSubscription: false,
  isLoading: true,

  login: async (params) => {
    const res = await apiLogin(params);
    console.log('[AuthStore] login response:', JSON.stringify(res));
    const { token, user, access } = res.data;
    console.log('[AuthStore] access:', JSON.stringify(access), 'has_access:', access?.has_access);
    localStorage.setItem('auth_token', token);
    // 递增会话版本，使所有飞行中的 checkAuth 结果失效
    sessionVersion++;
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
    // 递增会话版本，使所有飞行中的 checkAuth 结果失效
    sessionVersion++;
    set({
      token,
      user,
      accessInfo: access,
      isAuthenticated: true,
      hasAccess: access?.has_access ?? true,
      isLoading: false,
    });
  },

  checkAuth: async (force?: boolean) => {
    // 非强制模式下，如果已认证则跳过
    if (!force && get().isAuthenticated) {
      set({ isLoading: false });
      return;
    }
    const token = localStorage.getItem('auth_token');
    if (!token) {
      set({ isAuthenticated: false, hasAccess: false, isLoading: false });
      return;
    }

    // 记住本次调用时的会话版本
    const myVersion = sessionVersion;

    try {
      const res = await getMe();

      // 竞态保护：如果在 getMe 期间发生了 login/register/logout，
      // 会话版本已变，丢弃本次结果
      if (sessionVersion !== myVersion) {
        console.log('[AuthStore] checkAuth: session version changed, skipping');
        return;
      }

      // 额外保护：token 也可能在 getMe 期间被其他操作更改
      const currentToken = localStorage.getItem('auth_token');
      if (currentToken !== token) {
        console.log('[AuthStore] checkAuth: token changed during getMe, skipping');
        return;
      }

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
      // 竞态保护：会话版本已变，不清除新的登录态
      if (sessionVersion !== myVersion) {
        console.log('[AuthStore] checkAuth error: session version changed, not clearing');
        return;
      }

      // 额外保护：token 变了也不清除
      const currentToken = localStorage.getItem('auth_token');
      if (currentToken !== token) {
        console.log('[AuthStore] checkAuth error: token changed, not clearing new session');
        return;
      }

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
    // 递增会话版本，使飞行中的 checkAuth 失效
    sessionVersion++;
    set({ token: null, user: null, accessInfo: null, isAuthenticated: false, hasAccess: false, isLoading: false });
  },
}));
