import React, { useState } from 'react';
import { Mail, Phone, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import logoImg from '@/assets/logo.png';

type AuthMode = 'email' | 'phone';
type FormMode = 'login' | 'register';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, register } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>('email');
  const [formMode, setFormMode] = useState<FormMode>('login');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (formMode === 'register') {
        if (mode === 'email') {
          await register({ email, password, nickname });
        } else {
          await register({ phone, code, nickname });
        }
      } else {
        if (mode === 'email') {
          await login({ email, password });
        } else {
          await login({ phone, code });
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('login.error');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-surface-primary">
      <div className="w-[420px] p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={logoImg} alt="logo" className="w-16 h-16 rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-fg-primary">{t('sidebar.appName')}</h1>
          <p className="text-sm text-fg-muted mt-1">{t('onboarding.appDesc')}</p>
        </div>

        {/* Tab 切换：手机/邮箱 */}
        <div className="flex gap-1 bg-surface-secondary rounded-lg p-1 mb-6">
          <button
            onClick={() => setMode('email')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'email' ? 'bg-primary text-primary-foreground' : 'text-fg-muted hover:text-fg-secondary'
            }`}
          >
            <Mail className="w-4 h-4" />
            {t('login.email')}
          </button>
          <button
            onClick={() => setMode('phone')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'phone' ? 'bg-primary text-primary-foreground' : 'text-fg-muted hover:text-fg-secondary'
            }`}
          >
            <Phone className="w-4 h-4" />
            {t('login.phone')}
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'email' ? (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                required
                className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder')}
                  required
                  minLength={6}
                  className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 pr-11 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('login.phonePlaceholder')}
                required
                className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('login.codePlaceholder')}
                  required
                  maxLength={6}
                  className="flex-1 bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  className="px-4 py-3 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 transition-colors shrink-0"
                >
                  {t('login.getCode')}
                </button>
              </div>
            </>
          )}

          {/* 注册时显示昵称 */}
          {formMode === 'register' && (
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('login.nicknamePlaceholder')}
              className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
            />
          )}

          {/* 错误提示 */}
          {error && (
            <div className="text-sm text-error bg-error/10 rounded-lg px-4 py-2.5">
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {formMode === 'login' ? t('login.loginBtn') : t('login.registerBtn')}
          </button>
        </form>

        {/* 切换登录/注册 */}
        <div className="mt-6 text-center">
          <span className="text-sm text-fg-muted">
            {formMode === 'login' ? t('login.noAccount') : t('login.hasAccount')}
          </span>
          <button
            onClick={() => { setFormMode(formMode === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-sm text-primary font-medium ml-1 hover:underline"
          >
            {formMode === 'login' ? t('login.goRegister') : t('login.goLogin')}
          </button>
        </div>

        {/* 试用提示 */}
        {formMode === 'register' && (
          <p className="text-center text-xs text-fg-muted mt-4">
            {t('login.trialHint')}
          </p>
        )}
      </div>
    </div>
  );
}
