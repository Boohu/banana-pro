package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"auth-server/internal/model"

	"github.com/gin-gonic/gin"
)

// AdminListUsers 用户列表
func AdminListUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}

	var total int64
	model.DB.Model(&model.User{}).Count(&total)

	var users []model.User
	model.DB.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&users)

	// 附加订阅状态
	type UserItem struct {
		model.User
		HasAccess    bool   `json:"has_access"`
		AccessReason string `json:"access_reason"`
		DaysLeft     int    `json:"days_left"`
	}
	items := make([]UserItem, len(users))
	for i, u := range users {
		info := buildAccessInfo(&u)
		items[i] = UserItem{
			User:         u,
			HasAccess:    info.HasAccess,
			AccessReason: info.AccessReason,
			DaysLeft:     info.DaysLeft,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{
			"total": total,
			"list":  items,
		},
	})
}

// AdminListOrders 订单列表
func AdminListOrders(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}

	var total int64
	model.DB.Model(&model.PaymentOrder{}).Count(&total)

	var orders []model.PaymentOrder
	model.DB.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&orders)

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{
			"total": total,
			"list":  orders,
		},
	})
}

// GrantRequest 手动发放订阅
type GrantRequest struct {
	Plan string `json:"plan" binding:"required"` // monthly / yearly
	Days int    `json:"days"`                    // 自定义天数（可选）
}

// AdminGrantSubscription 手动发放/延期订阅
func AdminGrantSubscription(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, _ := strconv.ParseUint(userIDStr, 10, 32)

	var req GrantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	plan, ok := plans[req.Plan]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的套餐"})
		return
	}

	days := plan.Days
	if req.Days > 0 {
		days = req.Days
	}

	now := time.Now()
	startsAt := now

	// 查找现有未过期订阅，续期
	var latestSub model.Subscription
	if err := model.DB.Where("user_id = ? AND status = ? AND expires_at > ?", uint(userID), "active", now).
		Order("expires_at DESC").First(&latestSub).Error; err == nil {
		startsAt = latestSub.ExpiresAt
	}

	sub := model.Subscription{
		UserID:    uint(userID),
		Plan:      req.Plan,
		Amount:    0, // 手动发放不扣费
		StartsAt:  startsAt,
		ExpiresAt: startsAt.AddDate(0, 0, days),
		Status:    "active",
	}
	model.DB.Create(&sub)

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "订阅已发放",
		"data": gin.H{
			"expires_at": sub.ExpiresAt,
			"days":       days,
		},
	})
}

// ========== 配置管理 ==========

// 所有配置 key
var configKeys = []string{
	"wechat_app_id", "wechat_mch_id", "wechat_api_key", "wechat_cert_path", "wechat_serial_no", "wechat_notify_url",
	"alipay_app_id", "alipay_private_key", "alipay_public_key", "alipay_notify_url",
	"aliyun_sms_access_key_id", "aliyun_sms_access_key_secret", "aliyun_sms_sign_name", "aliyun_sms_template_code",
	"jwt_secret", "admin_key",
}

// 敏感字段集合，GET 时脱敏
var sensitiveKeys = map[string]bool{
	"wechat_api_key":            true,
	"alipay_private_key":        true,
	"alipay_public_key":         true,
	"aliyun_sms_access_key_id":  true,
	"aliyun_sms_access_key_secret": true,
	"jwt_secret":                true,
	"admin_key":                 true,
}

// maskValue 脱敏：只保留前 4 位 + ***
func maskValue(val string) string {
	if len(val) <= 4 {
		return "***"
	}
	return val[:4] + "***"
}

// AdminGetConfig 获取所有系统配置
// GET /api/admin/config
func AdminGetConfig(c *gin.Context) {
	result := make([]gin.H, 0, len(configKeys))

	for _, key := range configKeys {
		var config model.SystemConfig
		value := ""
		updatedAt := ""

		if err := model.DB.Where("`key` = ?", key).First(&config).Error; err == nil {
			value = config.Value
			updatedAt = config.UpdatedAt.Format("2006-01-02 15:04:05")
		}

		// 敏感字段脱敏
		displayValue := value
		if sensitiveKeys[key] && value != "" {
			displayValue = maskValue(value)
		}

		result = append(result, gin.H{
			"key":           key,
			"value":         displayValue,
			"has_value":     value != "",
			"updated_at":    updatedAt,
			"is_sensitive":  sensitiveKeys[key],
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": result,
	})
}

// AdminSaveConfig 批量保存系统配置
// POST /api/admin/config
func AdminSaveConfig(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	// 构建合法 key 集合
	validKeys := make(map[string]bool, len(configKeys))
	for _, k := range configKeys {
		validKeys[k] = true
	}

	saved := 0
	for key, value := range req {
		if !validKeys[key] {
			continue
		}

		// 如果值是脱敏的（以 *** 结尾），跳过不更新
		if strings.HasSuffix(value, "***") {
			continue
		}

		var config model.SystemConfig
		err := model.DB.Where("`key` = ?", key).First(&config).Error
		if err != nil {
			// 不存在则新建
			config = model.SystemConfig{
				Key:   key,
				Value: value,
			}
			model.DB.Create(&config)
		} else {
			// 已存在则更新
			model.DB.Model(&config).Update("value", value)
		}
		saved++
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "配置已保存",
		"data": gin.H{
			"saved": saved,
		},
	})
}
