import React, { useState, useEffect, useRef } from 'react';
import { Crown, Check, Loader2, QrCode } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { createOrder, getOrderStatus } from '@/services/authApi';
import { useTranslation } from 'react-i18next';
import logoImg from '@/assets/logo.png';

export function SubscriptionPage() {
  const { t } = useTranslation();
  const { user, accessInfo, logout, checkAuth } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [orderInfo, setOrderInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const plans = [
    {
      id: 'monthly',
      name: t('subscription.monthly'),
      price: t('subscription.monthlyPrice'),
      period: t('subscription.monthlyPeriod'),
      features: [
        t('subscription.featureUnlimited'),
        t('subscription.feature2K'),
        t('subscription.featureBatch'),
        t('subscription.featureInspiration'),
      ],
    },
    {
      id: 'yearly',
      name: t('subscription.yearly'),
      price: t('subscription.yearlyPrice'),
      period: t('subscription.yearlyPeriod'),
      badge: t('subscription.recommend'),
      save: t('subscription.save'),
      features: [
        t('subscription.featureAllMonthly'),
        t('subscription.featurePriority'),
        t('subscription.featureYearRound'),
      ],
    },
  ];

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlan(planId);
    setLoading(true);
    try {
      const res = await createOrder(planId, payMethod);
      setOrderInfo(res.data);
      setPaying(true);

      // 开始轮询订单状态
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await getOrderStatus(res.data.order_id);
          if (statusRes.data.status === 'paid') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPaying(false);
            setOrderInfo(null);
            // 强制刷新用户状态（绕过 isAuthenticated 短路）
            await checkAuth(true);
          }
        } catch {}
      }, 3000);
    } catch (err: any) {
      const msg = err?.response?.data?.message || t('subscription.createOrderFailed');
      if (err?.response?.status === 401) {
        alert('登录已过期，请重新登录');
        logout();
      } else {
        alert(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-surface-primary px-4">
      {/* Header */}
      <div className="flex flex-col items-center mb-8">
        <img src={logoImg} alt="logo" className="w-12 h-12 rounded-xl mb-3" />
        <h1 className="text-xl font-bold text-fg-primary">{t('subscription.choosePlan')}</h1>
        <p className="text-sm text-fg-muted mt-1">
          {accessInfo?.access_reason === 'expired'
            ? t('subscription.expiredHint')
            : t('subscription.hello', { name: user?.nickname || user?.email })
          }
        </p>
      </div>

      {/* 套餐卡片 */}
      <div className="flex gap-5 mb-8">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative w-[260px] rounded-2xl border-2 p-6 cursor-pointer transition-all ${
              selectedPlan === plan.id
                ? 'border-primary bg-primary/5'
                : 'border-border bg-surface-secondary hover:border-primary/50'
            }`}
            onClick={() => !paying && setSelectedPlan(plan.id)}
          >
            {plan.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {plan.badge}
              </span>
            )}
            <div className="mb-4">
              <h3 className="text-lg font-bold text-fg-primary">{plan.name}</h3>
              {plan.save && <span className="text-xs text-primary font-medium">{plan.save}</span>}
            </div>
            <div className="mb-5">
              <span className="text-3xl font-black text-fg-primary">{plan.price}</span>
              <span className="text-sm text-fg-muted">{plan.period}</span>
            </div>
            <ul className="space-y-2.5">
              {plan.features.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Check className="w-4 h-4 text-primary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* 支付区域 */}
      {selectedPlan && !paying && (
        <div className="flex flex-col items-center gap-4">
          {/* 支付方式 */}
          <div className="flex gap-3">
            <button
              onClick={() => setPayMethod('wechat')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                payMethod === 'wechat' ? 'bg-[#07c160] text-white' : 'bg-surface-secondary text-fg-secondary'
              }`}
            >
              {t('subscription.wechatPay')}
            </button>
            <button
              onClick={() => setPayMethod('alipay')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                payMethod === 'alipay' ? 'bg-[#1677ff] text-white' : 'bg-surface-secondary text-fg-secondary'
              }`}
            >
              {t('subscription.alipay')}
            </button>
          </div>

          <button
            onClick={() => handleSelectPlan(selectedPlan)}
            disabled={loading}
            className="px-8 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            {t('subscription.subscribe')}
          </button>
        </div>
      )}

      {/* 支付二维码 */}
      {paying && orderInfo && (
        <div className="flex flex-col items-center gap-4 p-6 bg-surface-secondary rounded-2xl border border-border">
          <p className="text-sm font-medium text-fg-primary">
            {t('subscription.scanToPay', { method: payMethod === 'wechat' ? t('subscription.wechat') : t('subscription.alipayName') })}
          </p>
          <div className="w-48 h-48 bg-white rounded-xl flex items-center justify-center">
            {orderInfo.qr_code_url ? (
              <img src={orderInfo.qr_code_url} alt={t('subscription.payQrCode')} className="w-full h-full rounded-xl" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-fg-muted">
                <QrCode className="w-12 h-12" />
                <span className="text-xs">{t('subscription.qrLoading')}</span>
              </div>
            )}
          </div>
          <p className="text-2xl font-black text-fg-primary">{t('subscription.amountYuan', { amount: orderInfo.amount_yuan })}</p>
          <p className="text-xs text-fg-muted">{t('subscription.autoRedirect')}</p>
          <button
            onClick={() => { setPaying(false); setOrderInfo(null); if (pollRef.current) clearInterval(pollRef.current); }}
            className="text-xs text-fg-muted hover:text-fg-secondary"
          >
            {t('subscription.cancelPay')}
          </button>
        </div>
      )}

      {/* 底部 */}
      <div className="mt-8 flex items-center gap-4">
        {accessInfo?.has_access && (
          <button
            onClick={() => {
              import('@/store/navigationStore').then(({ useNavigationStore }) => {
                useNavigationStore.getState().setPage('settings');
              });
            }}
            className="text-xs text-primary hover:underline"
          >
            ← 返回
          </button>
        )}
        <button onClick={logout} className="text-xs text-fg-muted hover:text-fg-secondary">
          {t('subscription.logout')}
        </button>
      </div>
    </div>
  );
}
