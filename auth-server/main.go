package main

import (
	"log"
	"os"

	"auth-server/internal/handler"
	"auth-server/internal/middleware"
	"auth-server/internal/model"

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
			auth.POST("/send-code", func(c *gin.Context) {
				// TODO: 接入短信/邮件服务后实现
				c.JSON(200, gin.H{"code": 200, "message": "验证码已发送（开发模式：验证码为 123456）"})
			})
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
