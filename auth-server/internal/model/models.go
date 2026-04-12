package model

import (
	"time"

	"gorm.io/gorm"
)

// User 用户
type User struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Phone          *string        `gorm:"uniqueIndex;size:20" json:"phone"`
	Email          *string        `gorm:"uniqueIndex;size:100" json:"email"`
	PasswordHash   string         `gorm:"-" json:"-"`                         // 邮箱注册时的密码哈希
	Password       string         `gorm:"column:password_hash" json:"-"`      // 数据库字段名
	Nickname       string         `gorm:"size:50" json:"nickname"`
	TokenVersion   int            `gorm:"default:0" json:"-"`                 // Token 版本号（用于单设备登录）
	TrialExpiresAt time.Time      `json:"trial_expires_at"`                   // 试用到期时间
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// Subscription 订阅
type Subscription struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index" json:"user_id"`
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

// UserAccessInfo 用户访问信息（API 返回用）
type UserAccessInfo struct {
	User         *User         `json:"user"`
	HasAccess    bool          `json:"has_access"`    // 是否有权访问
	AccessReason string        `json:"access_reason"` // trial / subscription / expired
	Subscription *Subscription `json:"subscription,omitempty"`
	DaysLeft     int           `json:"days_left"`     // 剩余天数
}
