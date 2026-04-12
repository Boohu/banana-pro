package handler

import (
	"fmt"
	"net/http"
	"time"

	"auth-server/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 套餐配置
var plans = map[string]struct {
	Name   string
	Amount int // 分
	Days   int
}{
	"monthly": {Name: "月卡", Amount: 2900, Days: 30},
	"yearly":  {Name: "年卡", Amount: 19900, Days: 365},
}

// CreateOrderRequest 创建订单请求
type CreateOrderRequest struct {
	Plan      string `json:"plan" binding:"required"`       // monthly / yearly
	PayMethod string `json:"pay_method" binding:"required"` // wechat / alipay
}

// CreateOrder 创建支付订单
func CreateOrder(c *gin.Context) {
	userID := c.GetUint("user_id")

	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	plan, ok := plans[req.Plan]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的套餐"})
		return
	}

	orderNo := fmt.Sprintf("JDY%s", uuid.New().String()[:12])

	order := model.PaymentOrder{
		UserID:    userID,
		OrderNo:   orderNo,
		Plan:      req.Plan,
		Amount:    plan.Amount,
		PayMethod: req.PayMethod,
		Status:    "pending",
	}

	// TODO: 调用微信/支付宝 API 生成二维码
	// 暂时返回模拟数据，支付接入后替换
	order.QrCodeURL = fmt.Sprintf("https://api.yourapp.com/pay/qr/%s", orderNo)

	if err := model.DB.Create(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "创建订单失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{
			"order_id":    order.ID,
			"order_no":    order.OrderNo,
			"plan":        plan.Name,
			"amount":      order.Amount,
			"amount_yuan": fmt.Sprintf("%.2f", float64(order.Amount)/100),
			"pay_method":  order.PayMethod,
			"qr_code_url": order.QrCodeURL,
			"status":      order.Status,
		},
	})
}

// GetOrderStatus 查询订单状态
func GetOrderStatus(c *gin.Context) {
	orderID := c.Param("id")
	userID := c.GetUint("user_id")

	var order model.PaymentOrder
	if err := model.DB.Where("id = ? AND user_id = ?", orderID, userID).First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "订单不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{
			"order_no": order.OrderNo,
			"status":   order.Status,
			"plan":     order.Plan,
			"amount":   order.Amount,
			"paid_at":  order.PaidAt,
		},
	})
}

// GetSubscriptionStatus 查询订阅状态
func GetSubscriptionStatus(c *gin.Context) {
	userID := c.GetUint("user_id")

	var user model.User
	if err := model.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "用户不存在"})
		return
	}

	info := buildAccessInfo(&user)
	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": info,
	})
}

// CompletePayment 支付完成处理（支付回调后调用）
func CompletePayment(orderNo string) error {
	var order model.PaymentOrder
	if err := model.DB.Where("order_no = ? AND status = ?", orderNo, "pending").First(&order).Error; err != nil {
		return fmt.Errorf("订单不存在或已处理")
	}

	now := time.Now()
	plan := plans[order.Plan]

	// 更新订单状态
	model.DB.Model(&order).Updates(map[string]interface{}{
		"status":  "paid",
		"paid_at": &now,
	})

	// 查找用户当前最晚到期的订阅，续期
	var latestSub model.Subscription
	startsAt := now
	if err := model.DB.Where("user_id = ? AND status = ? AND expires_at > ?", order.UserID, "active", now).
		Order("expires_at DESC").First(&latestSub).Error; err == nil {
		// 有未过期的订阅，从其到期时间续期
		startsAt = latestSub.ExpiresAt
	}

	expiresAt := startsAt.AddDate(0, 0, plan.Days)

	sub := model.Subscription{
		UserID:    order.UserID,
		Plan:      order.Plan,
		Amount:    order.Amount,
		StartsAt:  startsAt,
		ExpiresAt: expiresAt,
		Status:    "active",
	}
	model.DB.Create(&sub)

	return nil
}
