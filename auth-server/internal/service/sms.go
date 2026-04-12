package service

import (
	"fmt"
	"log"

	"auth-server/internal/model"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	dysmsapi "github.com/alibabacloud-go/dysmsapi-20170525/v4/client"
	"github.com/alibabacloud-go/tea/tea"
)

// getSmsClient 每次调用都根据当前配置创建客户端
// 优先从数据库读配置，fallback 到环境变量
func getSmsClient() (*dysmsapi.Client, error) {
	accessKeyID := model.GetConfig("aliyun_sms_access_key_id")
	accessKeySecret := model.GetConfig("aliyun_sms_access_key_secret")

	if accessKeyID == "" || accessKeySecret == "" {
		return nil, nil // 未配置，返回 nil 表示禁用
	}

	config := &openapi.Config{
		AccessKeyId:     tea.String(accessKeyID),
		AccessKeySecret: tea.String(accessKeySecret),
		Endpoint:        tea.String("dysmsapi.aliyuncs.com"),
	}

	client, err := dysmsapi.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("阿里云短信客户端初始化失败: %w", err)
	}

	return client, nil
}

// SendSmsCode 发送短信验证码
// phone: 手机号, code: 验证码
// 如果短信服务未配置，打印日志但不报错
func SendSmsCode(phone, code string) error {
	client, err := getSmsClient()
	if err != nil {
		log.Printf("[SMS] 短信客户端初始化失败: %v", err)
		return nil
	}
	if client == nil {
		log.Printf("[SMS] 短信未配置，跳过发送到 %s，验证码: %s", phone, code)
		return nil
	}

	signName := model.GetConfig("aliyun_sms_sign_name")
	templateCode := model.GetConfig("aliyun_sms_template_code")

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

	resp, err := client.SendSms(req)
	if err != nil {
		return fmt.Errorf("发送短信失败: %w", err)
	}

	if resp.Body != nil && resp.Body.Code != nil && *resp.Body.Code != "OK" {
		return fmt.Errorf("短信发送失败: %s - %s", tea.StringValue(resp.Body.Code), tea.StringValue(resp.Body.Message))
	}

	log.Printf("[SMS] 短信发送成功: %s", phone)
	return nil
}
