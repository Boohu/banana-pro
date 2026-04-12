package service

import (
	"fmt"
	"log"
	"os"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	dysmsapi "github.com/alibabacloud-go/dysmsapi-20170525/v4/client"
	"github.com/alibabacloud-go/tea/tea"
)

// smsClient 阿里云短信客户端（懒加载）
var smsClient *dysmsapi.Client

// smsEnabled 标记短信服务是否可用
var smsEnabled bool

// initSmsClient 初始化阿里云短信客户端
func initSmsClient() {
	accessKeyID := os.Getenv("ALIYUN_SMS_ACCESS_KEY_ID")
	accessKeySecret := os.Getenv("ALIYUN_SMS_ACCESS_KEY_SECRET")

	if accessKeyID == "" || accessKeySecret == "" {
		log.Println("[SMS] 阿里云短信环境变量未配置，短信功能禁用（开发模式：验证码固定 123456）")
		smsEnabled = false
		return
	}

	config := &openapi.Config{
		AccessKeyId:     tea.String(accessKeyID),
		AccessKeySecret: tea.String(accessKeySecret),
		Endpoint:        tea.String("dysmsapi.aliyuncs.com"),
	}

	client, err := dysmsapi.NewClient(config)
	if err != nil {
		log.Printf("[SMS] 阿里云短信客户端初始化失败: %v", err)
		smsEnabled = false
		return
	}

	smsClient = client
	smsEnabled = true
	log.Println("[SMS] 阿里云短信服务初始化成功")
}

// init 包初始化时自动创建客户端
func init() {
	initSmsClient()
}

// SendSmsCode 发送短信验证码
// phone: 手机号, code: 验证码
// 如果短信服务未配置，打印日志但不报错
func SendSmsCode(phone, code string) error {
	if !smsEnabled {
		log.Printf("[SMS] 开发模式，跳过发送短信到 %s，验证码: %s", phone, code)
		return nil
	}

	signName := os.Getenv("ALIYUN_SMS_SIGN_NAME")
	templateCode := os.Getenv("ALIYUN_SMS_TEMPLATE_CODE")

	if signName == "" || templateCode == "" {
		log.Printf("[SMS] 签名或模板未配置，跳过发送短信到 %s，验证码: %s", phone, code)
		return nil
	}

	req := &dysmsapi.SendSmsRequest{
		PhoneNumbers:  tea.String(phone),
		SignName:      tea.String(signName),
		TemplateCode:  tea.String(templateCode),
		TemplateParam: tea.String(fmt.Sprintf(`{"code":"%s"}`, code)),
	}

	resp, err := smsClient.SendSms(req)
	if err != nil {
		return fmt.Errorf("发送短信失败: %w", err)
	}

	if resp.Body != nil && resp.Body.Code != nil && *resp.Body.Code != "OK" {
		return fmt.Errorf("短信发送失败: %s - %s", tea.StringValue(resp.Body.Code), tea.StringValue(resp.Body.Message))
	}

	log.Printf("[SMS] 短信发送成功: %s", phone)
	return nil
}
