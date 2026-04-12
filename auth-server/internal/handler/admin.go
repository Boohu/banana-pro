package handler

import (
	"net/http"
	"strconv"
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
