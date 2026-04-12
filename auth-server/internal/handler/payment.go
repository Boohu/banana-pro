package handler

import (
	"log"
	"net/http"

	"auth-server/internal/service"

	"github.com/gin-gonic/gin"
)

// WechatNotify 微信支付回调
// POST /api/payment/wechat/notify
func WechatNotify(c *gin.Context) {
	paySvc := service.GetPaymentService()

	// 如果微信支付未配置，按旧逻辑走 mock 模式
	if !paySvc.IsWechatConfigured() {
		orderNo := c.Query("order_no")
		if orderNo == "" {
			c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "missing order_no"})
			return
		}
		if err := CompletePayment(orderNo); err != nil {
			log.Printf("[Payment] 微信 mock 回调处理失败: %v\n", err)
			c.JSON(http.StatusOK, gin.H{"code": "FAIL", "message": err.Error()})
			return
		}
		log.Printf("[Payment] 微信 mock 支付成功: %s\n", orderNo)
		c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "OK"})
		return
	}

	// 真实微信支付回调：SDK 验签 + 解密
	orderNo, err := paySvc.ParseWechatNotify(c.Request)
	if err != nil {
		log.Printf("[Payment] 微信回调验签/解析失败: %v\n", err)
		// 微信 APIv3 回调失败需要返回 JSON 格式
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": err.Error()})
		return
	}

	if err := CompletePayment(orderNo); err != nil {
		log.Printf("[Payment] 微信回调处理失败: orderNo=%s, err=%v\n", orderNo, err)
		c.JSON(http.StatusOK, gin.H{"code": "FAIL", "message": err.Error()})
		return
	}

	log.Printf("[Payment] 微信支付成功: %s\n", orderNo)
	// 微信 APIv3 回调成功需要返回 200 + JSON
	c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "OK"})
}

// AlipayNotify 支付宝回调
// POST /api/payment/alipay/notify
func AlipayNotify(c *gin.Context) {
	paySvc := service.GetPaymentService()

	// 如果支付宝未配置，按旧逻辑走 mock 模式
	if !paySvc.IsAlipayConfigured() {
		orderNo := c.PostForm("out_trade_no")
		if orderNo == "" {
			c.String(http.StatusBadRequest, "fail")
			return
		}
		if err := CompletePayment(orderNo); err != nil {
			log.Printf("[Payment] 支付宝 mock 回调处理失败: %v\n", err)
			c.String(http.StatusOK, "fail")
			return
		}
		log.Printf("[Payment] 支付宝 mock 支付成功: %s\n", orderNo)
		c.String(http.StatusOK, "success")
		return
	}

	// 真实支付宝回调：SDK 验签 + 解析
	orderNo, err := paySvc.ParseAlipayNotify(c)
	if err != nil {
		log.Printf("[Payment] 支付宝回调验签/解析失败: %v\n", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}

	if err := CompletePayment(orderNo); err != nil {
		log.Printf("[Payment] 支付宝回调处理失败: orderNo=%s, err=%v\n", orderNo, err)
		c.String(http.StatusOK, "fail")
		return
	}

	log.Printf("[Payment] 支付宝支付成功: %s\n", orderNo)
	// 支付宝异步通知成功需要返回纯文本 "success"
	c.String(http.StatusOK, "success")
}

// MockPay 模拟支付（仅开发测试用）
// POST /api/payment/mock
func MockPay(c *gin.Context) {
	orderNo := c.Query("order_no")
	if orderNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "缺少 order_no"})
		return
	}

	if err := CompletePayment(orderNo); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "模拟支付成功",
	})
}
