package handler

import (
	"net/http"
	"strings"
	"time"

	"auth-server/internal/model"
	"auth-server/internal/util"

	"github.com/gin-gonic/gin"
)

// RegisterRequest 注册请求
type RegisterRequest struct {
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"` // 邮箱注册时必填
	Code     string `json:"code"`     // 手机号注册时必填（验证码）
	Nickname string `json:"nickname"`
}

// LoginRequest 登录请求
type LoginRequest struct {
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"` // 邮箱登录
	Code     string `json:"code"`     // 手机验证码登录
}

// Register 注册
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	// 邮箱注册
	if req.Email != "" {
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if req.Password == "" {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码不能为空"})
			return
		}
		if len(req.Password) < 6 {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码至少 6 位"})
			return
		}

		// 检查邮箱是否已注册
		var existing model.User
		if err := model.DB.Where("email = ?", req.Email).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "该邮箱已注册"})
			return
		}

		hash, err := util.HashPassword(req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "系统错误"})
			return
		}

		emailPtr := &req.Email
		user := model.User{
			Email:          emailPtr,
			Password:       hash,
			Nickname:       req.Nickname,
			TrialExpiresAt: time.Now().AddDate(0, 0, 3),
		}
		if user.Nickname == "" {
			user.Nickname = strings.Split(req.Email, "@")[0]
		}

		if err := model.DB.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "注册失败"})
			return
		}

		// 生成 Token
		token, err := util.GenerateToken(user.ID, ptrStr(user.Email), ptrStr(user.Phone), user.TokenVersion)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "生成 Token 失败"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"code":    200,
			"message": "注册成功",
			"data": gin.H{
				"token":  token,
				"user":   buildUserInfo(&user),
				"access": buildAccessInfo(&user),
			},
		})
		return
	}

	// 手机号注册
	if req.Phone != "" {
		req.Phone = strings.TrimSpace(req.Phone)
		if req.Code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "验证码不能为空"})
			return
		}

		// 验证验证码
		if !verifyCode(req.Phone, req.Code, "register") {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "验证码错误或已过期"})
			return
		}

		// 检查手机号是否已注册
		var existing model.User
		if err := model.DB.Where("phone = ?", req.Phone).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "该手机号已注册"})
			return
		}

		phonePtr := &req.Phone
		user := model.User{
			Phone:          phonePtr,
			Nickname:       req.Nickname,
			TrialExpiresAt: time.Now().AddDate(0, 0, 3),
		}
		if user.Nickname == "" {
			user.Nickname = "用户" + req.Phone[len(req.Phone)-4:]
		}

		if err := model.DB.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "注册失败"})
			return
		}

		token, _ := util.GenerateToken(user.ID, ptrStr(user.Email), ptrStr(user.Phone), user.TokenVersion)
		c.JSON(http.StatusOK, gin.H{
			"code":    200,
			"message": "注册成功",
			"data": gin.H{
				"token":  token,
				"user":   buildUserInfo(&user),
				"access": buildAccessInfo(&user),
			},
		})
		return
	}

	c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请提供邮箱或手机号"})
}

// Login 登录
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	var user model.User

	// 邮箱+密码登录
	if req.Email != "" {
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if err := model.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "邮箱未注册"})
			return
		}
		if !util.CheckPassword(req.Password, user.Password) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码错误"})
			return
		}
	} else if req.Phone != "" {
		req.Phone = strings.TrimSpace(req.Phone)
		if !verifyCode(req.Phone, req.Code, "login") {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "验证码错误或已过期"})
			return
		}
		if err := model.DB.Where("phone = ?", req.Phone).First(&user).Error; err != nil {
			phonePtr := &req.Phone
			user = model.User{
				Phone:          phonePtr,
				Nickname:       "用户" + req.Phone[len(req.Phone)-4:],
				TrialExpiresAt: time.Now().AddDate(0, 0, 3),
			}
			model.DB.Create(&user)
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请提供邮箱或手机号"})
		return
	}

	// 递增 token 版本号，踢掉旧设备
	model.DB.Model(&user).Update("token_version", user.TokenVersion+1)
	user.TokenVersion++

	token, err := util.GenerateToken(user.ID, ptrStr(user.Email), ptrStr(user.Phone), user.TokenVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "生成 Token 失败"})
		return
	}

	accessInfo := buildAccessInfo(&user)
	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "登录成功",
		"data": gin.H{
			"token":  token,
			"user":   buildUserInfo(&user),
			"access": accessInfo,
		},
	})
}

// GetMe 获取当前用户信息 + 订阅状态
func GetMe(c *gin.Context) {
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

// RefreshToken 刷新 Token
func RefreshToken(c *gin.Context) {
	userID := c.GetUint("user_id")

	var user model.User
	model.DB.First(&user, userID)

	token, err := util.GenerateToken(user.ID, ptrStr(user.Email), ptrStr(user.Phone), user.TokenVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "刷新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{"token": token},
	})
}

// --- 辅助函数 ---

// ptrStr 安全解引用字符串指针
func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func buildUserInfo(user *model.User) gin.H {
	return gin.H{
		"id":               user.ID,
		"email":            ptrStr(user.Email),
		"phone":            ptrStr(user.Phone),
		"nickname":         user.Nickname,
		"trial_expires_at": user.TrialExpiresAt,
		"created_at":       user.CreatedAt,
	}
}

func buildAccessInfo(user *model.User) *model.UserAccessInfo {
	info := &model.UserAccessInfo{
		User: user,
	}

	now := time.Now()

	// 检查试用期
	if now.Before(user.TrialExpiresAt) {
		info.HasAccess = true
		info.AccessReason = "trial"
		info.DaysLeft = int(user.TrialExpiresAt.Sub(now).Hours()/24) + 1
		return info
	}

	// 检查有效订阅
	var sub model.Subscription
	if err := model.DB.Where("user_id = ? AND status = ? AND expires_at > ?", user.ID, "active", now).
		Order("expires_at DESC").First(&sub).Error; err == nil {
		info.HasAccess = true
		info.AccessReason = "subscription"
		info.Subscription = &sub
		info.DaysLeft = int(sub.ExpiresAt.Sub(now).Hours()/24) + 1
		return info
	}

	info.HasAccess = false
	info.AccessReason = "expired"
	info.DaysLeft = 0
	return info
}

func verifyCode(target, code, codeType string) bool {
	var vc model.VerifyCode
	err := model.DB.Where("target = ? AND code = ? AND type = ? AND used = ? AND expires_at > ?",
		target, code, codeType, false, time.Now()).
		Order("created_at DESC").First(&vc).Error
	if err != nil {
		return false
	}
	// 标记已使用
	model.DB.Model(&vc).Update("used", true)
	return true
}
