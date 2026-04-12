import { create } from 'zustand';
import { login as apiLogin, register as apiRegister, getMe, type UserInfo, type AccessInfo } from '../services/authApi';

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

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  accessInfo: null,
  isAuthenticated: false,
  hasAccess: false,
  isLoading: true,

  login: async (params) => {
    const res = await apiLogin(params);
    const { token, user } = res.data;
    localStorage.setItem('auth_token', token);
    set({ token, user, isAuthenticated: true });
    // 获取订阅状态
    try {
      const meRes = await getMe();
      set({
        accessInfo: meRes.data,
        hasAccess: meRes.data.has_access,
      });
    } catch {}
  },

  register: async (params) => {
    const res = await apiRegister(params);
    const { token, user } = res.data;
    localStorage.setItem('auth_token', token);
    set({ token, user, isAuthenticated: true, hasAccess: true }); // 注册后自动有试用期
    try {
      const meRes = await getMe();
      set({ accessInfo: meRes.data, hasAccess: meRes.data.has_access });
    } catch {}
  },

  checkAuth: async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      set({ isAuthenticated: false, hasAccess: false, isLoading: false });
      return;
    }
    try {
      const res = await getMe();
      set({
        token,
        user: res.data.user,
        accessInfo: res.data,
        isAuthenticated: true,
        hasAccess: res.data.has_access,
        isLoading: false,
      });
    } catch {
      localStorage.removeItem('auth_token');
      set({ token: null, user: null, isAuthenticated: false, hasAccess: false, isLoading: false });
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    set({ token: null, user: null, accessInfo: null, isAuthenticated: false, hasAccess: false });
  },
}));
