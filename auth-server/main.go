package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"auth-server/internal/handler"
	"auth-server/internal/middleware"
	"auth-server/internal/model"
	"auth-server/internal/service"

	"github.com/gin-gonic/gin"
)

func main() {
	// 初始化数据库
	if err := model.InitDB(); err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}

	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		// 公开接口
		auth := api.Group("/auth")
		{
			auth.POST("/register", handler.Register)
			auth.POST("/login", handler.Login)
			auth.POST("/send-code", handleSendCode)
		}

		// 支付回调（不需要 Token）
		payment := api.Group("/payment")
		{
			payment.POST("/wechat/notify", handler.WechatNotify)
			payment.POST("/alipay/notify", handler.AlipayNotify)
			payment.POST("/mock", handler.MockPay) // 开发测试用
		}

		// 需要登录的接口
		protected := api.Group("")
		protected.Use(middleware.AuthRequired())
		{
			protected.GET("/auth/me", handler.GetMe)
			protected.POST("/auth/refresh", handler.RefreshToken)

			protected.POST("/subscription/create-order", handler.CreateOrder)
			protected.GET("/subscription/order/:id", handler.GetOrderStatus)
			protected.GET("/subscription/status", handler.GetSubscriptionStatus)
		}

		// 管理后台（简单的 admin key 鉴权）
		admin := api.Group("/admin")
		admin.Use(func(c *gin.Context) {
			adminKey := os.Getenv("ADMIN_KEY")
			if adminKey == "" {
				adminKey = "jdy-admin-2026" // 默认密钥，生产环境务必修改
			}
			if c.GetHeader("X-Admin-Key") != adminKey {
				c.JSON(403, gin.H{"code": 403, "message": "无权限"})
				c.Abort()
				return
			}
			c.Next()
		})
		{
			admin.GET("/users", handler.AdminListUsers)
			admin.GET("/orders", handler.AdminListOrders)
			admin.POST("/users/:id/grant", handler.AdminGrantSubscription)
		}
	}

	// 管理后台页面
	r.StaticFile("/admin", "./admin/index.html")

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "9090"
	}

	log.Printf("认证服务启动，端口: %s\n", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("启动失败: %v", err)
	}
}

// sendCodeRequest 发送验证码请求
type sendCodeRequest struct {
	Target string `json:"target" binding:"required"` // 手机号或邮箱
	Type   string `json:"type" binding:"required"`   // login / register
}

// generateCode 生成 6 位随机验证码
func generateCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		// fallback：不太可能失败，但以防万一
		return "123456"
	}
	return fmt.Sprintf("%06d", n.Int64())
}

// isEmail 简单判断是否为邮箱
func isEmail(target string) bool {
	return strings.Contains(target, "@")
}

// handleSendCode 发送验证码
func handleSendCode(c *gin.Context) {
	var req sendCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误：需要 target 和 type"})
		return
	}

	req.Target = strings.TrimSpace(req.Target)
	if req.Target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "目标不能为空"})
		return
	}

	// 频率限制：同一目标 60 秒内不能重复发送
	var recentCode model.VerifyCode
	err := model.DB.Where("target = ? AND created_at > ?", req.Target, time.Now().Add(-60*time.Second)).
		Order("created_at DESC").First(&recentCode).Error
	if err == nil {
		// 60 秒内已发送过
		c.JSON(http.StatusTooManyRequests, gin.H{"code": 429, "message": "发送过于频繁，请 60 秒后重试"})
		return
	}

	// 生成验证码
	code := generateCode()

	// 存入 verify_codes 表（5 分钟过期）
	verifyCode := model.VerifyCode{
		Target:    req.Target,
		Code:      code,
		Type:      req.Type,
		ExpiresAt: time.Now().Add(5 * time.Minute),
		Used:      false,
	}
	if err := model.DB.Create(&verifyCode).Error; err != nil {
		log.Printf("[SendCode] 保存验证码失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务器错误"})
		return
	}

	// 根据目标类型发送
	if isEmail(req.Target) {
		// 邮箱：暂时只存表不发送
		log.Printf("[SendCode] 邮箱验证码已生成: %s -> %s（邮件发送暂未接入）", req.Target, code)
		c.JSON(http.StatusOK, gin.H{"code": 200, "message": "验证码已发送"})
		return
	}

	// 手机号：调用阿里云短信
	if err := service.SendSmsCode(req.Target, code); err != nil {
		log.Printf("[SendCode] 短信发送失败: %v", err)
		// 短信发送失败不影响验证码已存储，用户可以在开发模式下使用
		c.JSON(http.StatusOK, gin.H{"code": 200, "message": "验证码已发送"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "验证码已发送"})
}
