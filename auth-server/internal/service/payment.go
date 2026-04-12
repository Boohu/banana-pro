package service

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/smartwalle/alipay/v3"
	wxcore "github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

// PaymentConfig 支付配置（从环境变量读取）
type PaymentConfig struct {
	// 微信支付
	WechatAppID     string // 微信应用ID（公众号/小程序的 appid）
	WechatMchID     string // 商户号
	WechatAPIKey    string // APIv3 密钥
	WechatCertPath  string // 商户私钥证书路径
	WechatSerialNo  string // 商户证书序列号
	WechatNotifyURL string // 微信支付回调地址

	// 支付宝
	AlipayAppID      string // 应用ID
	AlipayPrivateKey string // 应用私钥
	AlipayPublicKey  string // 支付宝公钥
	AlipayNotifyURL  string // 支付宝回调地址
}

// PaymentService 支付服务
type PaymentService struct {
	config PaymentConfig

	// 微信支付客户端（懒初始化）
	wxClient    *wxcore.Client
	wxClientMu  sync.Mutex
	wxInited    bool
	wxInitErr   error
	wxNotifyHandler *notify.Handler

	// 支付宝客户端（懒初始化）
	alipayClient *alipay.Client
	alipayMu     sync.Mutex
	alipayInited bool
	alipayInitErr error
}

// 全局单例
var (
	paymentSvc     *PaymentService
	paymentSvcOnce sync.Once
)

// GetPaymentService 获取支付服务单例
func GetPaymentService() *PaymentService {
	paymentSvcOnce.Do(func() {
		cfg := PaymentConfig{
			WechatAppID:     os.Getenv("WECHAT_APP_ID"),
			WechatMchID:     os.Getenv("WECHAT_MCH_ID"),
			WechatAPIKey:    os.Getenv("WECHAT_API_KEY"),
			WechatCertPath:  os.Getenv("WECHAT_CERT_PATH"),
			WechatSerialNo:  os.Getenv("WECHAT_SERIAL_NO"),
			WechatNotifyURL: os.Getenv("WECHAT_NOTIFY_URL"),

			AlipayAppID:      os.Getenv("ALIPAY_APP_ID"),
			AlipayPrivateKey: os.Getenv("ALIPAY_PRIVATE_KEY"),
			AlipayPublicKey:  os.Getenv("ALIPAY_PUBLIC_KEY"),
			AlipayNotifyURL:  os.Getenv("ALIPAY_NOTIFY_URL"),
		}
		paymentSvc = &PaymentService{config: cfg}
		log.Printf("[Payment] 支付服务初始化完成，微信商户号=%s，支付宝AppID=%s\n",
			cfg.WechatMchID, cfg.AlipayAppID)
	})
	return paymentSvc
}

// IsWechatConfigured 微信支付配置是否完整
func (s *PaymentService) IsWechatConfigured() bool {
	c := s.config
	return c.WechatMchID != "" && c.WechatAPIKey != "" && c.WechatCertPath != "" && c.WechatSerialNo != "" && c.WechatAppID != ""
}

// IsAlipayConfigured 支付宝配置是否完整
func (s *PaymentService) IsAlipayConfigured() bool {
	c := s.config
	return c.AlipayAppID != "" && c.AlipayPrivateKey != "" && c.AlipayPublicKey != ""
}

// ---- 微信支付 ----

// initWechatClient 懒初始化微信支付客户端
func (s *PaymentService) initWechatClient() (*wxcore.Client, error) {
	s.wxClientMu.Lock()
	defer s.wxClientMu.Unlock()

	if s.wxInited {
		return s.wxClient, s.wxInitErr
	}
	s.wxInited = true

	// 加载商户私钥
	mchPrivateKey, err := utils.LoadPrivateKeyWithPath(s.config.WechatCertPath)
	if err != nil {
		s.wxInitErr = fmt.Errorf("加载微信商户私钥失败: %w", err)
		return nil, s.wxInitErr
	}

	ctx := context.Background()
	// 初始化客户端，自带自动获取微信支付平台证书能力
	opts := []wxcore.ClientOption{
		option.WithWechatPayAutoAuthCipher(
			s.config.WechatMchID,
			s.config.WechatSerialNo,
			mchPrivateKey,
			s.config.WechatAPIKey,
		),
	}
	client, err := wxcore.NewClient(ctx, opts...)
	if err != nil {
		s.wxInitErr = fmt.Errorf("创建微信支付客户端失败: %w", err)
		return nil, s.wxInitErr
	}
	s.wxClient = client

	// 初始化回调通知处理器
	// 使用 CertificateDownloaderMgr 下载微信平台证书用于验签
	certMgr := downloader.NewCertificateDownloaderMgr(ctx)
	if err := certMgr.RegisterDownloaderWithPrivateKey(
		ctx, mchPrivateKey, s.config.WechatSerialNo, s.config.WechatMchID, s.config.WechatAPIKey,
	); err != nil {
		s.wxInitErr = fmt.Errorf("注册微信证书下载器失败: %w", err)
		return nil, s.wxInitErr
	}

	handler, err := notify.NewRSANotifyHandler(
		s.config.WechatAPIKey,
		verifiers.NewSHA256WithRSAVerifier(certMgr.GetCertificateVisitor(s.config.WechatMchID)),
	)
	if err != nil {
		s.wxInitErr = fmt.Errorf("创建微信通知处理器失败: %w", err)
		return nil, s.wxInitErr
	}
	s.wxNotifyHandler = handler

	log.Println("[Payment] 微信支付客户端初始化成功")
	return s.wxClient, nil
}

// CreateWechatOrder 创建微信支付 Native 订单，返回二维码 URL
func (s *PaymentService) CreateWechatOrder(orderNo string, amountCent int, description string) (string, error) {
	client, err := s.initWechatClient()
	if err != nil {
		return "", err
	}

	svc := native.NativeApiService{Client: client}

	// 设置过期时间为 30 分钟
	expireTime := time.Now().Add(30 * time.Minute)

	resp, _, err := svc.Prepay(context.Background(), native.PrepayRequest{
		Appid:       wxcore.String(s.config.WechatAppID),
		Mchid:       wxcore.String(s.config.WechatMchID),
		Description: wxcore.String(description),
		OutTradeNo:  wxcore.String(orderNo),
		TimeExpire:  wxcore.Time(expireTime),
		NotifyUrl:   wxcore.String(s.config.WechatNotifyURL),
		Amount: &native.Amount{
			Currency: wxcore.String("CNY"),
			Total:    wxcore.Int64(int64(amountCent)),
		},
	})
	if err != nil {
		return "", fmt.Errorf("微信 Native 下单失败: %w", err)
	}

	if resp.CodeUrl == nil {
		return "", fmt.Errorf("微信 Native 下单返回的 code_url 为空")
	}

	log.Printf("[Payment] 微信 Native 下单成功: orderNo=%s, codeUrl=%s\n", orderNo, *resp.CodeUrl)
	return *resp.CodeUrl, nil
}

// ParseWechatNotify 解析微信支付回调通知，返回商户订单号
// 验签 + 解密后提取 out_trade_no
func (s *PaymentService) ParseWechatNotify(request *http.Request) (orderNo string, err error) {
	if s.wxNotifyHandler == nil {
		// 确保客户端已初始化
		if _, initErr := s.initWechatClient(); initErr != nil {
			return "", fmt.Errorf("微信支付未初始化: %w", initErr)
		}
	}

	transaction := new(payments.Transaction)
	_, err = s.wxNotifyHandler.ParseNotifyRequest(context.Background(), request, transaction)
	if err != nil {
		return "", fmt.Errorf("解析微信回调通知失败: %w", err)
	}

	// 检查交易状态
	if transaction.TradeState != nil && *transaction.TradeState != "SUCCESS" {
		return "", fmt.Errorf("微信交易状态非成功: %s", *transaction.TradeState)
	}

	if transaction.OutTradeNo == nil {
		return "", fmt.Errorf("微信回调缺少 out_trade_no")
	}

	log.Printf("[Payment] 微信回调验证通过: orderNo=%s, tradeState=%s\n",
		*transaction.OutTradeNo, *transaction.TradeState)
	return *transaction.OutTradeNo, nil
}

// ---- 支付宝 ----

// initAlipayClient 懒初始化支付宝客户端
func (s *PaymentService) initAlipayClient() (*alipay.Client, error) {
	s.alipayMu.Lock()
	defer s.alipayMu.Unlock()

	if s.alipayInited {
		return s.alipayClient, s.alipayInitErr
	}
	s.alipayInited = true

	// 第三个参数 true = 生产环境
	client, err := alipay.New(s.config.AlipayAppID, s.config.AlipayPrivateKey, true)
	if err != nil {
		s.alipayInitErr = fmt.Errorf("创建支付宝客户端失败: %w", err)
		return nil, s.alipayInitErr
	}

	// 加载支付宝公钥（用于验签）
	if err := client.LoadAliPayPublicKey(s.config.AlipayPublicKey); err != nil {
		s.alipayInitErr = fmt.Errorf("加载支付宝公钥失败: %w", err)
		return nil, s.alipayInitErr
	}

	s.alipayClient = client
	log.Println("[Payment] 支付宝客户端初始化成功")
	return s.alipayClient, nil
}

// CreateAlipayOrder 创建支付宝当面付（扫码支付）订单，返回二维码 URL
func (s *PaymentService) CreateAlipayOrder(orderNo string, amountCent int, description string) (string, error) {
	client, err := s.initAlipayClient()
	if err != nil {
		return "", err
	}

	// 支付宝金额单位是元，需要从分转换
	amountYuan := fmt.Sprintf("%.2f", float64(amountCent)/100)

	param := alipay.TradePreCreate{
		Trade: alipay.Trade{
			NotifyURL:   s.config.AlipayNotifyURL,
			Subject:     description,
			OutTradeNo:  orderNo,
			TotalAmount: amountYuan,
			ProductCode: "FACE_TO_FACE_PAYMENT",
		},
	}

	resp, err := client.TradePreCreate(context.Background(), param)
	if err != nil {
		return "", fmt.Errorf("支付宝当面付下单失败: %w", err)
	}

	if !resp.Error.Code.IsSuccess() {
		return "", fmt.Errorf("支付宝当面付下单错误: code=%s, msg=%s, subMsg=%s",
			resp.Error.Code, resp.Error.Msg, resp.Error.SubMsg)
	}

	log.Printf("[Payment] 支付宝当面付下单成功: orderNo=%s, qrCode=%s\n", orderNo, resp.QRCode)
	return resp.QRCode, nil
}

// ParseAlipayNotify 解析支付宝异步回调，验签并返回商户订单号
func (s *PaymentService) ParseAlipayNotify(c *gin.Context) (orderNo string, err error) {
	client, err := s.initAlipayClient()
	if err != nil {
		return "", fmt.Errorf("支付宝未初始化: %w", err)
	}

	// 解析表单数据
	if err := c.Request.ParseForm(); err != nil {
		return "", fmt.Errorf("解析支付宝回调表单失败: %w", err)
	}

	// SDK 自动验签 + 解析通知
	notification, err := client.DecodeNotification(context.Background(), c.Request.Form)
	if err != nil {
		return "", fmt.Errorf("支付宝回调验签失败: %w", err)
	}

	// 检查交易状态
	if notification.TradeStatus != alipay.TradeStatusSuccess && notification.TradeStatus != alipay.TradeStatusFinished {
		return "", fmt.Errorf("支付宝交易状态非成功: %s", notification.TradeStatus)
	}

	log.Printf("[Payment] 支付宝回调验证通过: orderNo=%s, tradeStatus=%s\n",
		notification.OutTradeNo, notification.TradeStatus)
	return notification.OutTradeNo, nil
}
