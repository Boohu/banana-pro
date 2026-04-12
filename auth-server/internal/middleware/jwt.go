package middleware

import (
	"net/http"
	"strings"

	"auth-server/internal/model"
	"auth-server/internal/util"

	"github.com/gin-gonic/gin"
)

// AuthRequired JWT 鉴权中间件
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "请先登录"})
			c.Abort()
			return
		}

		// Bearer xxx
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "Token 格式错误"})
			c.Abort()
			return
		}

		claims, err := util.ParseToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "Token 无效或已过期"})
			c.Abort()
			return
		}

		// 验证 Token 版本号（单设备登录）
		var user model.User
		if err := model.DB.Select("token_version").First(&user, claims.UserID).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "用户不存在"})
			c.Abort()
			return
		}
		if user.TokenVersion != claims.TokenVersion {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "账号已在其他设备登录"})
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Set("phone", claims.Phone)
		c.Next()
	}
}
