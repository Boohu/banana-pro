package service

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"auth-server/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/smartwalle/alipay/v3"
	wxcore "github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
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

	// 微信支付客户端（懒初始化，配置变更时自动重建）
	wxClient        *wxcore.Client
	wxClientMu      sync.Mutex
	wxInited        bool
	wxInitErr       error
	wxNotifyHandler *notify.Handler
	wxConfigHash    string // 用于检测配置变更

	// 支付宝客户端（懒初始化，配置变更时自动重建）
	alipayClient    *alipay.Client
	alipayMu        sync.Mutex
	alipayInited    bool
	alipayInitErr   error
	alipayConfigHash string
}

// 全局单例
var (
	paymentSvc     *PaymentService
	paymentSvcOnce sync.Once
)

// GetPaymentService 获取支付服务单例
// 注意：每次调用都重新从数据库/环境变量读取配置，确保管理后台修改后立即生效
func GetPaymentService() *PaymentService {
	cfg := PaymentConfig{
		WechatAppID:     model.GetConfig("wechat_app_id"),
		WechatMchID:     model.GetConfig("wechat_mch_id"),
		WechatAPIKey:    model.GetConfig("wechat_api_key"),
		WechatCertPath:  model.GetConfig("wechat_cert_path"),
		WechatSerialNo:  model.GetConfig("wechat_serial_no"),
		WechatNotifyURL: model.GetConfig("wechat_notify_url"),

		AlipayAppID:      model.GetConfig("alipay_app_id"),
		AlipayPrivateKey: model.GetConfig("alipay_private_key"),
		AlipayPublicKey:  model.GetConfig("alipay_public_key"),
		AlipayNotifyURL:  model.GetConfig("alipay_notify_url"),
	}

	paymentSvcOnce.Do(func() {
		paymentSvc = &PaymentService{}
		log.Println("[Payment] 支付服务初始化完成")
	})

	// 每次更新配置（如果管理后台改了配置，下次调用就能拿到新值）
	paymentSvc.config = cfg
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

// wechatConfigHash 计算微信配置的哈希，用于检测配置变更
func wechatConfigHash(c PaymentConfig) string {
	return c.WechatMchID + "|" + c.WechatAPIKey + "|" + c.WechatCertPath + "|" + c.WechatSerialNo + "|" + c.WechatAppID
}

// initWechatClient 懒初始化微信支付客户端（配置变更时自动重建）
func (s *PaymentService) initWechatClient() (*wxcore.Client, error) {
	s.wxClientMu.Lock()
	defer s.wxClientMu.Unlock()

	// 配置变更时重置，重新初始化
	hash := wechatConfigHash(s.config)
	if s.wxInited && s.wxConfigHash != hash {
		log.Println("[Payment] 微信支付配置已变更，重新初始化")
		s.wxInited = false
		s.wxClient = nil
		s.wxInitErr = nil
		s.wxNotifyHandler = nil
	}

	if s.wxInited {
		return s.wxClient, s.wxInitErr
	}
	s.wxInited = true
	s.wxConfigHash = hash

	// 自行读取并解析商户私钥，兼容 PKCS#1(RSA PRIVATE KEY) 和 PKCS#8(PRIVATE KEY) 格式
	// 同时清理 BOM、\r 等异常字符，避免 SDK 的 LoadPrivateKeyWithPath 过于严格的格式检查
	keyData, err := os.ReadFile(s.config.WechatCertPath)
	if err != nil {
		s.wxInitErr = fmt.Errorf("读取微信商户私钥文件失败(%s): %w", s.config.WechatCertPath, err)
		return nil, s.wxInitErr
	}

	// 清理 BOM 和 \r
	keyStr := string(keyData)
	keyStr = strings.TrimPrefix(keyStr, "\xef\xbb\xbf") // UTF-8 BOM
	keyStr = strings.ReplaceAll(keyStr, "\r\n", "\n")
	keyStr = strings.ReplaceAll(keyStr, "\r", "\n")
	keyStr = strings.TrimSpace(keyStr)

	block, _ := pem.Decode([]byte(keyStr))
	if block == nil {
		s.wxInitErr = fmt.Errorf("微信商户私钥 PEM 解析失败，文件内容无效（前50字节: %q）", keyStr[:min(50, len(keyStr))])
		return nil, s.wxInitErr
	}

	log.Printf("[Payment] PEM block type: %q, len=%d\n", block.Type, len(block.Bytes))

	var rsaKey interface{}
	switch block.Type {
	case "PRIVATE KEY":
		// PKCS#8 格式
		rsaKey, err = x509.ParsePKCS8PrivateKey(block.Bytes)
	case "RSA PRIVATE KEY":
		// PKCS#1 格式
		rsaKey, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	default:
		s.wxInitErr = fmt.Errorf("不支持的私钥类型: %q（需要 PRIVATE KEY 或 RSA PRIVATE KEY）", block.Type)
		return nil, s.wxInitErr
	}
	if err != nil {
		s.wxInitErr = fmt.Errorf("解析微信商户私钥失败: %w", err)
		return nil, s.wxInitErr
	}

	mchPrivateKey, ok := rsaKey.(*rsa.PrivateKey)
	if !ok {
		s.wxInitErr = fmt.Errorf("私钥不是 RSA 类型")
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

// ParseWechatNotify 解析微信支付回调通知，返回商户订单号和实付金额（分）
func (s *PaymentService) ParseWechatNotify(request *http.Request) (orderNo string, paidAmount int, err error) {
	if s.wxNotifyHandler == nil {
		if _, initErr := s.initWechatClient(); initErr != nil {
			return "", 0, fmt.Errorf("微信支付未初始化: %w", initErr)
		}
	}

	transaction := new(payments.Transaction)
	_, err = s.wxNotifyHandler.ParseNotifyRequest(context.Background(), request, transaction)
	if err != nil {
		return "", 0, fmt.Errorf("解析微信回调通知失败: %w", err)
	}

	if transaction.TradeState != nil && *transaction.TradeState != "SUCCESS" {
		return "", 0, fmt.Errorf("微信交易状态非成功: %s", *transaction.TradeState)
	}
	if transaction.OutTradeNo == nil {
		return "", 0, fmt.Errorf("微信回调缺少 out_trade_no")
	}

	var amount int
	if transaction.Amount != nil && transaction.Amount.Total != nil {
		amount = int(*transaction.Amount.Total)
	}

	log.Printf("[Payment] 微信回调验证通过: orderNo=%s, tradeState=%s, amount=%d\n",
		*transaction.OutTradeNo, *transaction.TradeState, amount)
	return *transaction.OutTradeNo, amount, nil
}

// QueryWechatOrder 主动查询微信订单状态
// 返回: "paid" / "closed" / "pending" / "error"
func (s *PaymentService) QueryWechatOrder(orderNo string) string {
	client, err := s.initWechatClient()
	if err != nil {
		log.Printf("[Payment] 查询微信订单失败(初始化): %v\n", err)
		return "error"
	}

	svc := native.NativeApiService{Client: client}
	resp, _, err := svc.QueryOrderByOutTradeNo(context.Background(), native.QueryOrderByOutTradeNoRequest{
		OutTradeNo: wxcore.String(orderNo),
		Mchid:      wxcore.String(s.config.WechatMchID),
	})
	if err != nil {
		log.Printf("[Payment] 查询微信订单失败: orderNo=%s, err=%v\n", orderNo, err)
		return "error"
	}

	if resp.TradeState == nil {
		return "pending"
	}

	state := *resp.TradeState
	log.Printf("[Payment] 微信订单查询: orderNo=%s, tradeState=%s\n", orderNo, state)

	switch state {
	case "SUCCESS":
		return "paid"
	case "CLOSED", "REVOKED", "PAYERROR":
		return "closed"
	default:
		// NOTPAY, USERPAYING 等都算 pending
		return "pending"
	}
}

// ---- 支付宝 ----

// alipayConfigHashStr 计算支付宝配置的哈希
func alipayConfigHashStr(c PaymentConfig) string {
	return c.AlipayAppID + "|" + c.AlipayPrivateKey[:min(10, len(c.AlipayPrivateKey))] + "|" + c.AlipayPublicKey[:min(10, len(c.AlipayPublicKey))]
}

// initAlipayClient 懒初始化支付宝客户端（配置变更时自动重建）
func (s *PaymentService) initAlipayClient() (*alipay.Client, error) {
	s.alipayMu.Lock()
	defer s.alipayMu.Unlock()

	// 配置变更时重置
	hash := alipayConfigHashStr(s.config)
	if s.alipayInited && s.alipayConfigHash != hash {
		log.Println("[Payment] 支付宝配置已变更，重新初始化")
		s.alipayInited = false
		s.alipayClient = nil
		s.alipayInitErr = nil
	}

	if s.alipayInited {
		return s.alipayClient, s.alipayInitErr
	}
	s.alipayInited = true
	s.alipayConfigHash = hash

	// 支付宝私钥需要是纯 key 内容（不含 PEM 头尾），清理一下
	privateKey := strings.TrimSpace(s.config.AlipayPrivateKey)
	privateKey = strings.TrimPrefix(privateKey, "-----BEGIN RSA PRIVATE KEY-----")
	privateKey = strings.TrimPrefix(privateKey, "-----BEGIN PRIVATE KEY-----")
	privateKey = strings.TrimSuffix(privateKey, "-----END RSA PRIVATE KEY-----")
	privateKey = strings.TrimSuffix(privateKey, "-----END PRIVATE KEY-----")
	privateKey = strings.ReplaceAll(privateKey, "\n", "")
	privateKey = strings.ReplaceAll(privateKey, "\r", "")
	privateKey = strings.ReplaceAll(privateKey, " ", "")

	// 第三个参数 true = 生产环境
	client, err := alipay.New(s.config.AlipayAppID, privateKey, true)
	if err != nil {
		s.alipayInitErr = fmt.Errorf("创建支付宝客户端失败: %w", err)
		return nil, s.alipayInitErr
	}

	// 支付宝公钥也清理 PEM 头尾
	publicKey := strings.TrimSpace(s.config.AlipayPublicKey)
	publicKey = strings.TrimPrefix(publicKey, "-----BEGIN PUBLIC KEY-----")
	publicKey = strings.TrimSuffix(publicKey, "-----END PUBLIC KEY-----")
	publicKey = strings.ReplaceAll(publicKey, "\n", "")
	publicKey = strings.ReplaceAll(publicKey, "\r", "")
	publicKey = strings.ReplaceAll(publicKey, " ", "")

	// 加载支付宝公钥（用于验签）
	if err := client.LoadAliPayPublicKey(publicKey); err != nil {
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

// ParseAlipayNotify 解析支付宝异步回调，返回商户订单号和实付金额（分）
func (s *PaymentService) ParseAlipayNotify(c *gin.Context) (orderNo string, paidAmount int, err error) {
	client, err := s.initAlipayClient()
	if err != nil {
		return "", 0, fmt.Errorf("支付宝未初始化: %w", err)
	}

	if err := c.Request.ParseForm(); err != nil {
		return "", 0, fmt.Errorf("解析支付宝回调表单失败: %w", err)
	}

	notification, err := client.DecodeNotification(context.Background(), c.Request.Form)
	if err != nil {
		return "", 0, fmt.Errorf("支付宝回调验签失败: %w", err)
	}

	if notification.TradeStatus != alipay.TradeStatusSuccess && notification.TradeStatus != alipay.TradeStatusFinished {
		return "", 0, fmt.Errorf("支付宝交易状态非成功: %s", notification.TradeStatus)
	}

	// 支付宝金额是元（字符串），转成分
	var amount int
	var yuan float64
	if _, e := fmt.Sscanf(notification.TotalAmount, "%f", &yuan); e == nil {
		amount = int(yuan * 100)
	}

	log.Printf("[Payment] 支付宝回调验证通过: orderNo=%s, tradeStatus=%s, amount=%d\n",
		notification.OutTradeNo, notification.TradeStatus, amount)
	return notification.OutTradeNo, amount, nil
}

// QueryAlipayOrder 主动查询支付宝订单状态
// 返回: "paid" / "closed" / "pending" / "error"
func (s *PaymentService) QueryAlipayOrder(orderNo string) string {
	client, err := s.initAlipayClient()
	if err != nil {
		log.Printf("[Payment] 查询支付宝订单失败(初始化): %v\n", err)
		return "error"
	}

	resp, err := client.TradeQuery(context.Background(), alipay.TradeQuery{
		OutTradeNo: orderNo,
	})
	if err != nil {
		log.Printf("[Payment] 查询支付宝订单失败: orderNo=%s, err=%v\n", orderNo, err)
		return "error"
	}

	status := resp.TradeStatus
	log.Printf("[Payment] 支付宝订单查询: orderNo=%s, tradeStatus=%s\n", orderNo, status)

	switch status {
	case alipay.TradeStatusSuccess, alipay.TradeStatusFinished:
		return "paid"
	case alipay.TradeStatusClosed:
		return "closed"
	default:
		// WAIT_BUYER_PAY 等算 pending
		return "pending"
	}
}
