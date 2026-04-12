import React, { useState, useEffect, useRef } from 'react';
import { Crown, Check, Loader2, QrCode, ArrowLeft, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { createOrder, getOrderStatus } from '@/services/authApi';
import { useTranslation } from 'react-i18next';
import { useNavigationStore } from '@/store/navigationStore';
import logoImg from '@/assets/logo.png';

export function SubscriptionPage() {
  const { t } = useTranslation();
  const { user, accessInfo, logout, checkAuth } = useAuthStore();
  const { setPage } = useNavigationStore();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [orderInfo, setOrderInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasAccess = accessInfo?.has_access;
  const isTrial = accessInfo?.access_reason === 'trial';
  const isSubscribed = accessInfo?.access_reason === 'subscription';

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
      id: 'quarterly',
      name: t('subscription.quarterly'),
      price: t('subscription.quarterlyPrice'),
      period: t('subscription.quarterlyPeriod'),
      badge: t('subscription.hotBadge'),
      save: t('subscription.quarterlySave'),
      features: [
        t('subscription.featureAllMonthly'),
        t('subscription.featurePriority'),
        t('subscription.featureQuarterStable'),
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

      // 开始轮询订单状态（30 分钟后自动停止，二维码已过期）
      if (pollRef.current) clearInterval(pollRef.current);
      const pollStartTime = Date.now();
      pollRef.current = setInterval(async () => {
        // 超过 30 分钟自动停止轮询
        if (Date.now() - pollStartTime > 30 * 60 * 1000) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPaying(false);
          setOrderInfo(null);
          return;
        }
        try {
          const statusRes = await getOrderStatus(res.data.order_id);
          const status = statusRes.data.status;
          if (status === 'paid') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPaying(false);
            setOrderInfo(null);
            // 刷新用户状态，失败时重试一次
            try {
              await checkAuth(true);
            } catch {
              await new Promise(r => setTimeout(r, 1000));
              try { await checkAuth(true); } catch {}
            }
            setPage('settings');
          } else if (status === 'closed' || status === 'failed' || status === 'expired') {
            // 订单已关闭/取消/过期
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPaying(false);
            setOrderInfo(null);
          }
        } catch {}
      }, 3000);
    } catch (err: any) {
      const msg = err?.response?.data?.message || t('subscription.createOrderFailed');
      if (err?.response?.status === 401) {
        alert(t('subscription.loginExpired'));
        logout();
      } else {
        alert(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPay = () => {
    setPaying(false);
    setOrderInfo(null);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-4 relative">
      {/* 返回按钮 */}
      {hasAccess && (
        <button
          onClick={() => setPage('settings')}
          className="absolute top-5 left-5 flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('subscription.back')}
        </button>
      )}

      {/* Header */}
      <div className="flex flex-col items-center mb-6">
        <img src={logoImg} alt="logo" className="w-11 h-11 rounded-xl mb-2.5" />
        <h1 className="text-xl font-bold text-fg-primary">{t('subscription.choosePlan')}</h1>
        <p className="text-sm text-fg-muted mt-1">
          {accessInfo?.access_reason === 'expired'
            ? t('subscription.expiredHint')
            : isTrial
              ? t('subscription.trialHint', { days: accessInfo?.days_left })
              : isSubscribed
                ? t('subscription.renewHint')
                : t('subscription.hello', { name: user?.nickname || user?.email })
          }
        </p>
      </div>

      {/* 当前状态 */}
      {hasAccess && (
        <div className="mb-5 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-center">
          <p className="text-sm text-primary font-medium">
            {isTrial
              ? t('settingsPage.trialStatus', { days: accessInfo?.days_left })
              : t('settingsPage.subscriptionStatus', {
                  plan: accessInfo?.subscription?.plan === 'yearly' ? t('settingsPage.yearlyPlan') : accessInfo?.subscription?.plan === 'quarterly' ? t('settingsPage.quarterlyPlan') : t('settingsPage.monthlyPlan'),
                  days: accessInfo?.days_left,
                })}
          </p>
          {isSubscribed && accessInfo?.subscription?.expires_at && (
            <p className="text-xs text-fg-muted mt-0.5">
              {t('settingsPage.expiresAt', { date: new Date(accessInfo.subscription.expires_at).toLocaleDateString() })}
            </p>
          )}
        </div>
      )}

      {/* 套餐卡片 */}
      <div className="flex gap-5 mb-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative w-[220px] rounded-2xl border-2 p-5 cursor-pointer transition-all ${
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
            <div className="mb-3">
              <h3 className="text-lg font-bold text-fg-primary">{plan.name}</h3>
              {plan.save && <span className="text-xs text-primary font-medium">{plan.save}</span>}
            </div>
            <div className="mb-4">
              <span className="text-3xl font-black text-fg-primary">{plan.price}</span>
              <span className="text-sm text-fg-muted">{plan.period}</span>
            </div>
            <ul className="space-y-2">
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
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-3">
            <button
              onClick={() => setPayMethod('wechat')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                payMethod === 'wechat' ? 'bg-[#07c160] text-white' : 'bg-surface-secondary text-fg-secondary'
              }`}
            >
              {t('subscription.wechatPay')}
            </button>
            <button
              onClick={() => setPayMethod('alipay')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                payMethod === 'alipay' ? 'bg-[#1677ff] text-white' : 'bg-surface-secondary text-fg-secondary'
              }`}
            >
              {t('subscription.alipay')}
            </button>
          </div>

          <button
            onClick={() => handleSelectPlan(selectedPlan)}
            disabled={loading || paying}
            className="px-8 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            {isSubscribed ? t('settingsPage.renew') : t('subscription.subscribe')}
          </button>
        </div>
      )}

      {/* 底部 */}
      <div className="mt-6">
        <button onClick={logout} className="text-xs text-fg-muted hover:text-fg-secondary">
          {t('subscription.logout')}
        </button>
      </div>

      {/* 支付二维码弹窗 */}
      {paying && orderInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleCancelPay}>
          <div
            className="relative bg-surface-secondary rounded-2xl border border-border p-8 shadow-2xl flex flex-col items-center gap-5 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              onClick={handleCancelPay}
              className="absolute top-3 right-3 p-1 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-surface-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <p className="text-base font-semibold text-fg-primary">
              {t('subscription.scanToPay', { method: payMethod === 'wechat' ? t('subscription.wechat') : t('subscription.alipayName') })}
            </p>

            <div className="w-52 h-52 bg-white rounded-xl flex items-center justify-center p-2">
              {orderInfo.qr_code_url ? (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(orderInfo.qr_code_url)}`}
                  alt={t('subscription.payQrCode')}
                  className="w-full h-full"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-fg-muted">
                  <QrCode className="w-12 h-12" />
                  <span className="text-xs">{t('subscription.qrLoading')}</span>
                </div>
              )}
            </div>

            <p className="text-2xl font-black text-fg-primary">
              {t('subscription.amountYuan', { amount: orderInfo.amount_yuan })}
            </p>

            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              <p className="text-xs text-fg-muted">{t('subscription.autoRedirect')}</p>
            </div>

            <button
              onClick={handleCancelPay}
              className="text-xs text-fg-muted hover:text-fg-secondary transition-colors"
            >
              {t('subscription.cancelPay')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
