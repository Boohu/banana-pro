import React, { useState, useEffect, useRef } from 'react';
import { Crown, Check, Loader2, QrCode } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { createOrder, getOrderStatus } from '@/services/authApi';
import logoImg from '@/assets/logo.png';

const plans = [
  {
    id: 'monthly',
    name: '月卡',
    price: '¥29',
    period: '/月',
    features: ['无限量生图', '2K 分辨率', '批量处理', '灵感广场'],
  },
  {
    id: 'yearly',
    name: '年卡',
    price: '¥199',
    period: '/年',
    badge: '推荐',
    save: '省 ¥149',
    features: ['包含月卡全部功能', '优先体验新功能', '全年无忧'],
  },
];

export function SubscriptionPage() {
  const { user, accessInfo, logout, checkAuth } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [orderInfo, setOrderInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
            // 刷新用户状态
            await checkAuth();
          }
        } catch {}
      }, 3000);
    } catch (err: any) {
      alert(err?.response?.data?.message || '创建订单失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-surface-primary px-4">
      {/* Header */}
      <div className="flex flex-col items-center mb-8">
        <img src={logoImg} alt="logo" className="w-12 h-12 rounded-xl mb-3" />
        <h1 className="text-xl font-bold text-fg-primary">选择你的套餐</h1>
        <p className="text-sm text-fg-muted mt-1">
          {accessInfo?.access_reason === 'expired'
            ? '试用已到期，订阅后继续使用全部功能'
            : `你好，${user?.nickname || user?.email}`
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
              微信支付
            </button>
            <button
              onClick={() => setPayMethod('alipay')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                payMethod === 'alipay' ? 'bg-[#1677ff] text-white' : 'bg-surface-secondary text-fg-secondary'
              }`}
            >
              支付宝
            </button>
          </div>

          <button
            onClick={() => handleSelectPlan(selectedPlan)}
            disabled={loading}
            className="px-8 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            立即订阅
          </button>
        </div>
      )}

      {/* 支付二维码 */}
      {paying && orderInfo && (
        <div className="flex flex-col items-center gap-4 p-6 bg-surface-secondary rounded-2xl border border-border">
          <p className="text-sm font-medium text-fg-primary">
            {payMethod === 'wechat' ? '微信' : '支付宝'}扫码支付
          </p>
          <div className="w-48 h-48 bg-white rounded-xl flex items-center justify-center">
            {orderInfo.qr_code_url ? (
              <img src={orderInfo.qr_code_url} alt="支付二维码" className="w-full h-full rounded-xl" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-fg-muted">
                <QrCode className="w-12 h-12" />
                <span className="text-xs">二维码生成中...</span>
              </div>
            )}
          </div>
          <p className="text-2xl font-black text-fg-primary">{orderInfo.amount_yuan} 元</p>
          <p className="text-xs text-fg-muted">支付完成后自动跳转</p>
          <button
            onClick={() => { setPaying(false); setOrderInfo(null); if (pollRef.current) clearInterval(pollRef.current); }}
            className="text-xs text-fg-muted hover:text-fg-secondary"
          >
            取消支付
          </button>
        </div>
      )}

      {/* 底部 */}
      <div className="mt-8">
        <button onClick={logout} className="text-xs text-fg-muted hover:text-fg-secondary">
          退出登录
        </button>
      </div>
    </div>
  );
}
