package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// WechatNotify 微信支付回调
// POST /api/payment/wechat/notify
func WechatNotify(c *gin.Context) {
	// TODO: 接入微信支付 SDK 后实现
	// 1. 验证签名
	// 2. 解析订单号
	// 3. 调用 CompletePayment(orderNo)
	// 4. 返回成功响应给微信

	// 临时：手动模拟支付完成
	orderNo := c.Query("order_no")
	if orderNo == "" {
		c.XML(http.StatusBadRequest, gin.H{"return_code": "FAIL", "return_msg": "missing order_no"})
		return
	}

	if err := CompletePayment(orderNo); err != nil {
		log.Printf("[Payment] 微信回调处理失败: %v\n", err)
		c.XML(http.StatusOK, gin.H{"return_code": "FAIL", "return_msg": err.Error()})
		return
	}

	log.Printf("[Payment] 微信支付成功: %s\n", orderNo)
	c.XML(http.StatusOK, gin.H{"return_code": "SUCCESS", "return_msg": "OK"})
}

// AlipayNotify 支付宝回调
// POST /api/payment/alipay/notify
func AlipayNotify(c *gin.Context) {
	// TODO: 接入支付宝 SDK 后实现
	// 1. 验证签名
	// 2. 解析订单号
	// 3. 调用 CompletePayment(orderNo)
	// 4. 返回 "success"

	orderNo := c.PostForm("out_trade_no")
	if orderNo == "" {
		c.String(http.StatusBadRequest, "fail")
		return
	}

	if err := CompletePayment(orderNo); err != nil {
		log.Printf("[Payment] 支付宝回调处理失败: %v\n", err)
		c.String(http.StatusOK, "fail")
		return
	}

	log.Printf("[Payment] 支付宝支付成功: %s\n", orderNo)
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
