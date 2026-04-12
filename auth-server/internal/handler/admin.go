package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"auth-server/internal/model"
	"auth-server/internal/util"

	"github.com/gin-gonic/gin"
)

// AdminListUsers 用户列表（可选 app_id 过滤）
func AdminListUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	appID := c.DefaultQuery("app_id", DefaultAppID)
	if page < 1 {
		page = 1
	}

	var total int64
	model.DB.Model(&model.User{}).Count(&total)

	var users []model.User
	model.DB.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&users)

	// 附加订阅状态（按 app_id）
	type UserItem struct {
		model.User
		HasAccess    bool   `json:"has_access"`
		AccessReason string `json:"access_reason"`
		DaysLeft     int    `json:"days_left"`
	}
	items := make([]UserItem, len(users))
	for i, u := range users {
		info := buildAccessInfo(&u, appID)
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
	Plan  string `json:"plan" binding:"required"` // monthly / yearly
	Days  int    `json:"days"`                    // 自定义天数（可选）
	AppID string `json:"app_id"`                  // 可选，默认 jdyai
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

	appID := req.AppID
	if appID == "" {
		appID = DefaultAppID
	}

	// 从 App 表读取套餐配置
	plan := model.GetAppPlanByID(appID, req.Plan)
	if plan == nil {
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
	if err := model.DB.Where("user_id = ? AND app_id = ? AND status = ? AND expires_at > ?", uint(userID), appID, "active", now).
		Order("expires_at DESC").First(&latestSub).Error; err == nil {
		startsAt = latestSub.ExpiresAt
	}

	sub := model.Subscription{
		UserID:    uint(userID),
		AppID:     appID,
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

// AdminUploadCert 上传证书文件
// POST /api/admin/upload-cert
func AdminUploadCert(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请选择文件"})
		return
	}

	// 只允许 .pem 文件
	if !strings.HasSuffix(file.Filename, ".pem") {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "只支持 .pem 格式证书"})
		return
	}

	// 保存到 certs 目录（filepath.Base 防止路径穿越）
	certDir := "./certs"
	os.MkdirAll(certDir, 0755)
	savePath := certDir + "/" + filepath.Base(file.Filename)

	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "保存文件失败"})
		return
	}

	// 返回文件路径（用于填入配置）
	absPath, _ := filepath.Abs(savePath)
	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"message": "证书上传成功",
		"data": gin.H{
			"filename": file.Filename,
			"path":     absPath,
		},
	})
}

// AdminResetPassword 管理员重置用户密码
// POST /api/admin/users/:id/reset-password
func AdminResetPassword(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, _ := strconv.ParseUint(userIDStr, 10, 32)

	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请提供新密码"})
		return
	}
	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "密码至少 6 位"})
		return
	}

	hash, err := util.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "系统错误"})
		return
	}

	model.DB.Model(&model.User{}).Where("id = ?", uint(userID)).Update("password_hash", hash)

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "密码已重置",
	})
}

// ========== 应用管理 ==========

// AdminListApps 应用列表
func AdminListApps(c *gin.Context) {
	var apps []model.App
	model.DB.Order("created_at ASC").Find(&apps)

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": apps,
	})
}

// AdminCreateAppRequest 创建应用请求
type AdminCreateAppRequest struct {
	AppID       string `json:"app_id" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	TrialDays   int    `json:"trial_days"`
	PlansJSON   string `json:"plans_json"`
}

// AdminCreateApp 创建应用
func AdminCreateApp(c *gin.Context) {
	var req AdminCreateAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	// 检查 app_id 是否已存在
	var existing model.App
	if err := model.DB.Where("app_id = ?", req.AppID).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "该应用ID已存在"})
		return
	}

	if req.TrialDays <= 0 {
		req.TrialDays = 3
	}
	if req.PlansJSON == "" {
		req.PlansJSON = `[{"id":"monthly","name":"月卡","amount":2900,"days":30},{"id":"yearly","name":"年卡","amount":19900,"days":365}]`
	}

	app := model.App{
		AppID:       req.AppID,
		Name:        req.Name,
		Description: req.Description,
		TrialDays:   req.TrialDays,
		PlansJSON:   req.PlansJSON,
		IsActive:    true,
	}

	if err := model.DB.Create(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "创建应用失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "应用已创建",
		"data":    app,
	})
}

// AdminUpdateAppRequest 更新应用请求
type AdminUpdateAppRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	TrialDays   *int   `json:"trial_days"` // 用指针区分 0 和未传
	PlansJSON   string `json:"plans_json"`
	IsActive    *bool  `json:"is_active"`
}

// AdminUpdateApp 更新应用
func AdminUpdateApp(c *gin.Context) {
	appIDParam := c.Param("app_id")

	var app model.App
	if err := model.DB.Where("app_id = ?", appIDParam).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "应用不存在"})
		return
	}

	var req AdminUpdateAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.TrialDays != nil {
		updates["trial_days"] = *req.TrialDays
	}
	if req.PlansJSON != "" {
		updates["plans_json"] = req.PlansJSON
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	if len(updates) > 0 {
		model.DB.Model(&app).Updates(updates)
	}

	// 重新查询返回最新数据
	model.DB.Where("app_id = ?", appIDParam).First(&app)

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "应用已更新",
		"data":    app,
	})
}

// AdminDeleteApp 删除应用
func AdminDeleteApp(c *gin.Context) {
	appIDParam := c.Param("app_id")

	var app model.App
	if err := model.DB.Where("app_id = ?", appIDParam).First(&app).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "应用不存在"})
		return
	}

	model.DB.Delete(&app)

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "应用已删除",
	})
}

// ========== 配置管理 ==========

// 所有配置 key
var configKeys = []string{
	"wechat_app_id", "wechat_mch_id", "wechat_api_key", "wechat_cert_path", "wechat_serial_no", "wechat_notify_url",
	"alipay_app_id", "alipay_private_key", "alipay_public_key", "alipay_notify_url",
	"aliyun_sms_access_key_id", "aliyun_sms_access_key_secret", "aliyun_sms_sign_name", "aliyun_sms_template_code",
	"jwt_secret", "admin_key",
	"cors_allowed_origins",
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
