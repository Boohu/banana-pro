package model

import (
	"encoding/json"
	"log"
	"time"

	"gorm.io/gorm"
)

// App 应用（多应用授权）
type App struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	AppID       string    `gorm:"uniqueIndex;size:50;not null" json:"app_id"`  // 如 jdyai, product_a
	Name        string    `gorm:"size:100;not null" json:"name"`               // 显示名称
	Description string    `gorm:"size:500" json:"description"`                 // 描述
	TrialDays   int       `gorm:"default:3" json:"trial_days"`                 // 试用天数
	PlansJSON   string    `gorm:"type:text" json:"plans_json"`                 // 套餐配置 JSON
	IsActive    bool      `gorm:"default:true" json:"is_active"`              // 是否启用
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PlanConfig 套餐配置（从 App.PlansJSON 解析）
type PlanConfig struct {
	ID     string `json:"id"`     // monthly / yearly
	Name   string `json:"name"`   // 月卡 / 年卡
	Amount int    `json:"amount"` // 金额（分）
	Days   int    `json:"days"`   // 天数
}

// GetAppPlans 从 App 表的 PlansJSON 解析套餐列表
func GetAppPlans(appID string) []PlanConfig {
	var app App
	if err := DB.Where("app_id = ?", appID).First(&app).Error; err != nil {
		return nil
	}
	var plans []PlanConfig
	if err := json.Unmarshal([]byte(app.PlansJSON), &plans); err != nil {
		log.Printf("[Model] 解析应用 %s 的套餐配置失败: %v\n", appID, err)
		return nil
	}
	return plans
}

// GetAppPlanByID 获取指定应用的指定套餐
func GetAppPlanByID(appID, planID string) *PlanConfig {
	plans := GetAppPlans(appID)
	for _, p := range plans {
		if p.ID == planID {
			return &p
		}
	}
	return nil
}

// AppTrial 应用试用记录（每个用户在每个应用独立试用）
type AppTrial struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"uniqueIndex:idx_user_app;index" json:"user_id"`
	AppID     string    `gorm:"uniqueIndex:idx_user_app;size:50;not null" json:"app_id"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// GetOrCreateTrial 首次访问应用时自动创建试用记录
func GetOrCreateTrial(userID uint, appID string, trialDays int) *AppTrial {
	var trial AppTrial
	err := DB.Where("user_id = ? AND app_id = ?", userID, appID).First(&trial).Error
	if err == nil {
		return &trial
	}
	// 不存在则创建
	trial = AppTrial{
		UserID:    userID,
		AppID:     appID,
		ExpiresAt: time.Now().AddDate(0, 0, trialDays),
	}
	if err := DB.Create(&trial).Error; err != nil {
		log.Printf("[Model] 创建试用记录失败: userID=%d, appID=%s, err=%v\n", userID, appID, err)
		return nil
	}
	return &trial
}

// User 用户
type User struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Phone          *string        `gorm:"uniqueIndex;size:20" json:"phone"`
	Email          *string        `gorm:"uniqueIndex;size:100" json:"email"`
	PasswordHash   string         `gorm:"-" json:"-"`                         // 邮箱注册时的密码哈希
	Password       string         `gorm:"column:password_hash" json:"-"`      // 数据库字段名
	Nickname       string         `gorm:"size:50" json:"nickname"`
	TokenVersion   int            `gorm:"default:0" json:"-"`                 // Token 版本号（用于单设备登录）
	TrialExpiresAt time.Time      `json:"trial_expires_at"`                   // 旧字段，保留兼容
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// Subscription 订阅
type Subscription struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index" json:"user_id"`
	AppID     string    `gorm:"index;size:50;not null;default:'jdyai'" json:"app_id"`
	Plan      string    `gorm:"size:20;not null" json:"plan"` // monthly / yearly
	Amount    int       `json:"amount"`                       // 金额（分）
	StartsAt  time.Time `json:"starts_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Status    string    `gorm:"size:20;default:'active'" json:"status"` // active / expired / cancelled
	CreatedAt time.Time `json:"created_at"`
}

// PaymentOrder 支付订单
type PaymentOrder struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	UserID    uint       `gorm:"index" json:"user_id"`
	AppID     string     `gorm:"index;size:50;not null;default:'jdyai'" json:"app_id"`
	OrderNo   string     `gorm:"uniqueIndex;size:64;not null" json:"order_no"`
	Plan      string     `gorm:"size:20;not null" json:"plan"`       // monthly / yearly
	Amount    int        `gorm:"not null" json:"amount"`             // 金额（分）
	PayMethod string     `gorm:"size:20" json:"pay_method"`          // wechat / alipay
	QrCodeURL string     `gorm:"size:500" json:"qr_code_url"`        // 支付二维码 URL
	Status    string     `gorm:"size:20;default:'pending'" json:"status"` // pending / paid / failed / expired
	PaidAt    *time.Time `json:"paid_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// VerifyCode 验证码
type VerifyCode struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Target    string    `gorm:"index;size:100;not null" json:"target"` // 手机号或邮箱
	Code      string    `gorm:"size:10;not null" json:"code"`
	Type      string    `gorm:"size:20;not null" json:"type"` // register / login
	ExpiresAt time.Time `json:"expires_at"`
	Used      bool      `gorm:"default:false" json:"used"`
	CreatedAt time.Time `json:"created_at"`
}

// SystemConfig 系统配置（管理后台可编辑）
type SystemConfig struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"uniqueIndex;size:100;not null" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AppVersion 应用版本（自动更新用）
type AppVersion struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AppID     string    `gorm:"index;size:50;not null;default:'jdyai'" json:"app_id"`
	Version   string    `gorm:"size:20;not null" json:"version"`           // 如 2.7.5
	Notes     string    `gorm:"type:text" json:"notes"`                    // 更新说明
	PubDate   time.Time `json:"pub_date"`                                  // 发布时间
	// 各平台安装包 URL 和签名
	DarwinAarch64URL  string `gorm:"size:500" json:"darwin_aarch64_url"`
	DarwinAarch64Sig  string `gorm:"type:text" json:"darwin_aarch64_sig"`
	DarwinX8664URL    string `gorm:"size:500" json:"darwin_x86_64_url"`
	DarwinX8664Sig    string `gorm:"type:text" json:"darwin_x86_64_sig"`
	WindowsX8664URL   string `gorm:"size:500" json:"windows_x86_64_url"`
	WindowsX8664Sig   string `gorm:"type:text" json:"windows_x86_64_sig"`
	LinuxX8664URL     string `gorm:"size:500" json:"linux_x86_64_url"`
	LinuxX8664Sig     string `gorm:"type:text" json:"linux_x86_64_sig"`
	IsActive  bool      `gorm:"default:true" json:"is_active"`             // 是否启用
	CreatedAt time.Time `json:"created_at"`
}

// UserAccessInfo 用户访问信息（API 返回用）
type UserAccessInfo struct {
	User         *User         `json:"user"`
	AppID        string        `json:"app_id"`
	HasAccess    bool          `json:"has_access"`    // 是否有权访问
	AccessReason string        `json:"access_reason"` // trial / subscription / expired
	Subscription *Subscription `json:"subscription,omitempty"`
	DaysLeft     int           `json:"days_left"`     // 剩余天数
}
