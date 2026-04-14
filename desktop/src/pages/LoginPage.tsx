import React, { useState, useRef, useEffect } from 'react';
import { Mail, Phone, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import { AUTH_URL, resetPassword } from '@/services/authApi';
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
  const [successMsg, setSuccessMsg] = useState('');
  const [useCodeLogin, setUseCodeLogin] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 重置密码模式
  const [showReset, setShowReset] = useState(false);
  const [resetStep, setResetStep] = useState<1 | 2>(1); // 1=输入账号+验证码, 2=输入新密码
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 清理倒计时
  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  const startCountdown = () => {
    setCodeCountdown(60);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCodeCountdown((prev) => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async (codeType?: string) => {
    const target = mode === 'phone' ? phone.trim() : email.trim();
    if (!target || codeCountdown > 0 || codeSending) return;
    setCodeSending(true);
    setError('');
    try {
      const type = codeType || (showReset ? 'reset' : formMode);
      const res = await fetch(`${AUTH_URL}/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, type }),
      });
      const data = await res.json();
      if (data.code === 200) {
        startCountdown();
      } else {
        setError(data.message || '发送失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setCodeSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (formMode === 'register') {
        if (mode === 'email') {
          await register({ email, password, code, nickname });
        } else {
          await register({ phone, code, password, nickname });
        }
      } else {
        if (mode === 'email') {
          await login({ email, password });
        } else {
          await login({ phone, password: useCodeLogin ? undefined : password, code: code || undefined });
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('login.error');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 重置密码提交
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (resetStep === 1) {
      // 第一步：验证验证码填了没，进入第二步
      const target = mode === 'phone' ? phone.trim() : email.trim();
      if (!target) { setError('请输入手机号或邮箱'); return; }
      if (!code.trim()) { setError('请输入验证码'); return; }
      setResetStep(2);
      return;
    }

    // 第二步：提交新密码
    if (newPassword.length < 6) { setError('密码至少 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次密码不一致'); return; }

    setLoading(true);
    try {
      const params: any = { code: code.trim(), new_password: newPassword };
      if (mode === 'phone') params.phone = phone.trim();
      else params.email = email.trim();

      const res = await resetPassword(params);
      if (res.code === 200) {
        setSuccessMsg('密码重置成功，请使用新密码登录');
        setTimeout(() => {
          setShowReset(false);
          setResetStep(1);
          setCode('');
          setNewPassword('');
          setConfirmPassword('');
          setSuccessMsg('');
        }, 2000);
      } else {
        setError((res as any).message || '重置失败');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  // 进入重置密码模式
  const enterReset = () => {
    setShowReset(true);
    setResetStep(1);
    setError('');
    setSuccessMsg('');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
  };

  // 退出重置密码模式
  const exitReset = () => {
    setShowReset(false);
    setResetStep(1);
    setError('');
    setSuccessMsg('');
  };

  // 重置密码界面
  if (showReset) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-primary">
        <div className="w-[420px] p-8">
          <div className="flex flex-col items-center mb-8">
            <img src={logoImg} alt="logo" className="w-16 h-16 rounded-2xl mb-4" />
            <h1 className="text-xl font-bold text-fg-primary">重置密码</h1>
            <p className="text-sm text-fg-muted mt-1">
              {resetStep === 1 ? '输入账号并验证身份' : '设置新密码'}
            </p>
          </div>

          {/* 手机/邮箱切换 */}
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

          <form onSubmit={handleResetSubmit} className="space-y-4">
            {resetStep === 1 ? (
              <>
                {mode === 'email' ? (
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')} required
                    className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                ) : (
                  <input
                    type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('login.phonePlaceholder')} required
                    className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                )}
                <div className="flex gap-2">
                  <input
                    type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder={t('login.codePlaceholder')} required maxLength={6}
                    className="flex-1 bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                  <button
                    type="button" onClick={() => handleSendCode('reset')}
                    disabled={codeSending || codeCountdown > 0 || !(mode === 'phone' ? phone.trim() : email.trim())}
                    className="px-4 py-3 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {codeSending ? '...' : codeCountdown > 0 ? `${codeCountdown}s` : t('login.getCode')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'} value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="新密码（至少6位）" required minLength={6}
                    className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 pr-11 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <input
                  type="password" value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="确认新密码" required minLength={6}
                  className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                />
              </>
            )}

            {error && <div className="text-sm text-error bg-error/10 rounded-lg px-4 py-2.5">{error}</div>}
            {successMsg && <div className="text-sm text-success bg-success/10 rounded-lg px-4 py-2.5">{successMsg}</div>}

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {resetStep === 1 ? '下一步' : '重置密码'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button onClick={exitReset} className="text-sm text-fg-muted hover:text-fg-secondary flex items-center justify-center gap-1 mx-auto">
              <ArrowLeft className="w-3.5 h-3.5" />
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

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
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')} required
                className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
              />
              {/* 邮箱注册时需要验证码 */}
              {formMode === 'register' && (
                <div className="flex gap-2">
                  <input
                    type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder={t('login.codePlaceholder')} required maxLength={6}
                    className="flex-1 bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                  <button type="button" onClick={() => handleSendCode()}
                    disabled={codeSending || codeCountdown > 0 || !email.trim()}
                    className="px-4 py-3 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                    {codeSending ? '...' : codeCountdown > 0 ? `${codeCountdown}s` : t('login.getCode')}
                  </button>
                </div>
              )}
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={formMode === 'register' ? '设置密码（至少6位）' : t('login.passwordPlaceholder')} required minLength={6}
                  className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 pr-11 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {formMode === 'login' && (
                <button type="button" onClick={enterReset} className="text-xs text-primary hover:underline">
                  忘记密码？
                </button>
              )}
            </>
          ) : (
            <>
              <input
                type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder={t('login.phonePlaceholder')} required
                className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
              />
              {/* 注册时：验证码 + 设置密码 */}
              {formMode === 'register' && (
                <div className="flex gap-2">
                  <input
                    type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder={t('login.codePlaceholder')} required maxLength={6}
                    className="flex-1 bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                  <button type="button" onClick={() => handleSendCode()}
                    disabled={codeSending || codeCountdown > 0 || !phone.trim()}
                    className="px-4 py-3 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                    {codeSending ? '...' : codeCountdown > 0 ? `${codeCountdown}s` : t('login.getCode')}
                  </button>
                </div>
              )}
              {/* 登录时：默认密码，可切换验证码 */}
              {formMode === 'login' && useCodeLogin && (
                <div className="flex gap-2">
                  <input
                    type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder={t('login.codePlaceholder')} required maxLength={6}
                    className="flex-1 bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                  <button type="button" onClick={() => handleSendCode()}
                    disabled={codeSending || codeCountdown > 0 || !phone.trim()}
                    className="px-4 py-3 rounded-xl bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0">
                    {codeSending ? '...' : codeCountdown > 0 ? `${codeCountdown}s` : t('login.getCode')}
                  </button>
                </div>
              )}
              {/* 密码框（注册必填，登录默认显示） */}
              {(formMode === 'register' || !useCodeLogin) && (
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={formMode === 'register' ? '设置密码（至少6位）' : t('login.passwordPlaceholder')}
                    required minLength={6}
                    className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 pr-11 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg-secondary">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              )}
              {/* 登录时切换密码/验证码 + 忘记密码 */}
              {formMode === 'login' && (
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => { setUseCodeLogin(!useCodeLogin); setCode(''); }}
                    className="text-xs text-primary hover:underline">
                    {useCodeLogin ? '使用密码登录' : '验证码登录'}
                  </button>
                  <button type="button" onClick={enterReset} className="text-xs text-fg-muted hover:text-primary">
                    忘记密码？
                  </button>
                </div>
              )}
            </>
          )}

          {/* 注册时显示昵称 */}
          {formMode === 'register' && (
            <input
              type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}
              placeholder={t('login.nicknamePlaceholder')}
              className="w-full bg-surface-secondary border border-border rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted outline-none focus:border-primary transition-colors"
            />
          )}

          {/* 错误提示 */}
          {error && <div className="text-sm text-error bg-error/10 rounded-lg px-4 py-2.5">{error}</div>}

          {/* 提交按钮 */}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
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
            onClick={() => { setFormMode(formMode === 'login' ? 'register' : 'login'); setError(''); setCode(''); setPassword(''); }}
            className="text-sm text-primary font-medium ml-1 hover:underline">
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
