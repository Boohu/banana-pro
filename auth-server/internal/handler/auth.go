package handler

import (
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"auth-server/internal/model"
	"auth-server/internal/util"

	"github.com/gin-gonic/gin"
)

// 默认应用 ID
const DefaultAppID = "jdyai"

// ========== 登录暴力破解防护 ==========

// attemptInfo 记录某账号的登录失败次数和锁定时间
type attemptInfo struct {
	count    int
	lockedAt time.Time
}

var loginAttempts sync.Map // key: email/phone, value: *attemptInfo

const maxLoginAttempts = 5                    // 最大失败次数
const loginLockDuration = 15 * time.Minute    // 锁定时长

// checkLoginLocked 检查账号是否因失败次数过多被锁定，返回 true 表示已锁定
func checkLoginLocked(identity string) bool {
	val, ok := loginAttempts.Load(identity)
	if !ok {
		return false
	}
	info := val.(*attemptInfo)
	if info.count >= maxLoginAttempts {
		// 检查锁定是否过期
		if time.Since(info.lockedAt) < loginLockDuration {
			return true
		}
		// 锁定已过期，清除记录
		loginAttempts.Delete(identity)
	}
	return false
}

// recordLoginFailure 记录一次登录失败
func recordLoginFailure(identity string) {
	val, loaded := loginAttempts.LoadOrStore(identity, &attemptInfo{count: 1, lockedAt: time.Now()})
	if loaded {
		info := val.(*attemptInfo)
		info.count++
		info.lockedAt = time.Now()
	}
}

// clearLoginAttempts 登录成功后清除失败记录
func clearLoginAttempts(identity string) {
	loginAttempts.Delete(identity)
}

// getAppID 从请求中提取 app_id，优先 JSON body，其次 query param，默认 jdyai
func getAppIDFromQuery(c *gin.Context) string {
	appID := c.Query("app_id")
	if appID == "" {
		appID = DefaultAppID
	}
	return appID
}

// RegisterRequest 注册请求
type RegisterRequest struct {
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"` // 邮箱注册时必填
	Code     string `json:"code"`     // 手机号注册时必填（验证码）
	Nickname string `json:"nickname"`
	AppID    string `json:"app_id"`   // 可选，默认 jdyai
}

// LoginRequest 登录请求
type LoginRequest struct {
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"` // 邮箱登录
	Code     string `json:"code"`     // 手机验证码登录
	AppID    string `json:"app_id"`   // 可选，默认 jdyai
}

// Register 注册
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	appID := req.AppID
	if appID == "" {
		appID = DefaultAppID
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
			TrialExpiresAt: time.Now().AddDate(0, 0, 3), // 保留旧字段兼容
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
				"access": buildAccessInfo(&user, appID),
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
		// 手机号注册时也保存密码
		var passwordHash string
		if req.Password != "" {
			if len(req.Password) < 6 {
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码至少 6 位"})
				return
			}
			h, err := util.HashPassword(req.Password)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "系统错误"})
				return
			}
			passwordHash = h
		}
		user := model.User{
			Phone:          phonePtr,
			Password:       passwordHash,
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
				"access": buildAccessInfo(&user, appID),
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

	appID := req.AppID
	if appID == "" {
		appID = DefaultAppID
	}

	// 确定登录标识（用于暴力破解防护）
	identity := strings.TrimSpace(strings.ToLower(req.Email))
	if identity == "" {
		identity = strings.TrimSpace(req.Phone)
	}

	// 检查是否被锁定
	if identity != "" && checkLoginLocked(identity) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": 429, "message": "登录失败次数过多，请 15 分钟后重试"})
		return
	}

	var user model.User

	// 邮箱+密码登录
	if req.Email != "" {
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if err := model.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
			recordLoginFailure(identity)
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "邮箱未注册"})
			return
		}
		if !util.CheckPassword(req.Password, user.Password) {
			recordLoginFailure(identity)
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码错误"})
			return
		}
	} else if req.Phone != "" {
		req.Phone = strings.TrimSpace(req.Phone)

		if req.Code != "" {
			// 验证码登录
			if !verifyCode(req.Phone, req.Code, "login") {
				recordLoginFailure(identity)
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "验证码错误或已过期"})
				return
			}
		} else if req.Password != "" {
			// 密码登录
			var existingUser model.User
			if err := model.DB.Where("phone = ?", req.Phone).First(&existingUser).Error; err != nil {
				recordLoginFailure(identity)
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "手机号未注册"})
				return
			}
			if existingUser.Password == "" {
				recordLoginFailure(identity)
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "该账号未设置密码，请使用验证码登录"})
				return
			}
			if !util.CheckPassword(req.Password, existingUser.Password) {
				recordLoginFailure(identity)
				c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码错误"})
				return
			}
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请提供密码或验证码"})
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

	// 登录成功，清除失败记录
	clearLoginAttempts(identity)

	// 递增 token 版本号，踢掉旧设备
	// 注意：GORM v2 的 Model(&user).Update() 会把新值回写到 user struct，
	// 所以执行后 user.TokenVersion 已经是 +1 的值，不需要再手动 ++
	model.DB.Model(&user).Update("token_version", user.TokenVersion+1)

	token, err := util.GenerateToken(user.ID, ptrStr(user.Email), ptrStr(user.Phone), user.TokenVersion)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "生成 Token 失败"})
		return
	}

	accessInfo := buildAccessInfo(&user, appID)
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
	appID := getAppIDFromQuery(c)

	var user model.User
	if err := model.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "用户不存在"})
		return
	}

	info := buildAccessInfo(&user, appID)
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

func buildAccessInfo(user *model.User, appID string) *model.UserAccessInfo {
	info := &model.UserAccessInfo{
		User:  user,
		AppID: appID,
	}

	now := time.Now()

	// 获取应用配置，读取试用天数
	var app model.App
	trialDays := 3 // 默认 3 天
	if err := model.DB.Where("app_id = ?", appID).First(&app).Error; err == nil {
		trialDays = app.TrialDays
	}

	// 检查该应用的试用期（通过 AppTrial 表）
	trial := model.GetOrCreateTrial(user.ID, appID, trialDays)
	if trial != nil && now.Before(trial.ExpiresAt) {
		info.HasAccess = true
		info.AccessReason = "trial"
		info.DaysLeft = int(math.Ceil(trial.ExpiresAt.Sub(now).Hours() / 24))
		return info
	}

	// 检查该应用的有效订阅
	var sub model.Subscription
	if err := model.DB.Where("user_id = ? AND app_id = ? AND status = ? AND expires_at > ?", user.ID, appID, "active", now).
		Order("expires_at DESC").First(&sub).Error; err == nil {
		info.HasAccess = true
		info.AccessReason = "subscription"
		info.Subscription = &sub
		info.DaysLeft = int(math.Ceil(sub.ExpiresAt.Sub(now).Hours() / 24))
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
