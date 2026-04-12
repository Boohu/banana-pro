package util

import (
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret []byte

func init() {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "jdy-ai-default-secret-change-in-production"
	}
	jwtSecret = []byte(secret)
}

// InitSecretFromDB 从数据库加载 JWT 密钥（在 model.DB 初始化后调用）
func InitSecretFromDB(dbSecret string) {
	if dbSecret != "" {
		jwtSecret = []byte(dbSecret)
		fmt.Println("[JWT] 使用数据库配置的 JWT 密钥")
	} else if os.Getenv("JWT_SECRET") == "" {
		fmt.Println("[JWT] 警告: 使用默认 JWT 密钥，生产环境请配置 JWT_SECRET 环境变量或在管理后台设置 jwt_secret")
	}
}

type Claims struct {
	UserID       uint   `json:"user_id"`
	Email        string `json:"email"`
	Phone        string `json:"phone"`
	TokenVersion int    `json:"token_version"`
	jwt.RegisteredClaims
}

// GenerateToken 生成 JWT Token（7天有效）
func GenerateToken(userID uint, email, phone string, tokenVersion int) (string, error) {
	claims := Claims{
		UserID:       userID,
		Email:        email,
		Phone:        phone,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ParseToken 解析并验证 Token
func ParseToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}
