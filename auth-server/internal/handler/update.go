package handler

import (
	"net/http"
	"strconv"
	"strings"

	"auth-server/internal/model"

	"github.com/gin-gonic/gin"
)

// CheckUpdate Tauri updater 检查更新接口
// GET /api/update/check?target=darwin&arch=aarch64&current_version=2.7.4
// 返回 Tauri updater 标准 JSON 格式
func CheckUpdate(c *gin.Context) {
	target := c.Query("target")         // darwin / windows / linux
	arch := c.Query("arch")             // aarch64 / x86_64
	currentVersion := c.Query("current_version")
	appID := c.DefaultQuery("app_id", "jdyai")

	// 查找该产品最新的活跃版本
	var latest model.AppVersion
	if err := model.DB.Where("app_id = ? AND is_active = ?", appID, true).
		Order("id DESC").First(&latest).Error; err != nil {
		// 没有可用版本，返回 204 表示无更新
		c.Status(http.StatusNoContent)
		return
	}

	// 比较版本号
	if !isNewer(latest.Version, currentVersion) {
		c.Status(http.StatusNoContent)
		return
	}

	// 根据平台选择对应的 URL 和签名
	platform := target + "-" + arch
	var url, sig string

	switch platform {
	case "darwin-aarch64":
		url, sig = latest.DarwinAarch64URL, latest.DarwinAarch64Sig
	case "darwin-x86_64":
		url, sig = latest.DarwinX8664URL, latest.DarwinX8664Sig
	case "windows-x86_64":
		url, sig = latest.WindowsX8664URL, latest.WindowsX8664Sig
	case "linux-x86_64":
		url, sig = latest.LinuxX8664URL, latest.LinuxX8664Sig
	}

	if url == "" {
		// 该平台暂无安装包
		c.Status(http.StatusNoContent)
		return
	}

	// 返回 Tauri updater 标准格式
	c.JSON(http.StatusOK, gin.H{
		"version":  latest.Version,
		"notes":    latest.Notes,
		"pub_date": latest.PubDate.Format("2006-01-02T15:04:05Z"),
		"platforms": gin.H{
			platform: gin.H{
				"url":       url,
				"signature": sig,
			},
		},
	})
}

// isNewer 比较版本号，latest 是否比 current 更新
// 支持 v2.7.5 和 2.7.5 两种格式
func isNewer(latest, current string) bool {
	latest = strings.TrimPrefix(latest, "v")
	current = strings.TrimPrefix(current, "v")

	lParts := strings.Split(latest, ".")
	cParts := strings.Split(current, ".")

	maxLen := len(lParts)
	if len(cParts) > maxLen {
		maxLen = len(cParts)
	}

	for i := 0; i < maxLen; i++ {
		var l, r int
		if i < len(lParts) {
			l, _ = strconv.Atoi(lParts[i])
		}
		if i < len(cParts) {
			r, _ = strconv.Atoi(cParts[i])
		}
		if l > r {
			return true
		}
		if l < r {
			return false
		}
	}
	return false
}

// --- 管理后台 API ---

// AdminListVersions 版本列表
func AdminListVersions(c *gin.Context) {
	var versions []model.AppVersion
	model.DB.Order("id DESC").Limit(20).Find(&versions)
	c.JSON(http.StatusOK, gin.H{"code": 200, "data": versions})
}

// AdminCreateVersion 创建新版本
func AdminCreateVersion(c *gin.Context) {
	var ver model.AppVersion
	if err := c.ShouldBindJSON(&ver); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	if ver.Version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "版本号不能为空"})
		return
	}

	if ver.PubDate.IsZero() {
		ver.PubDate = ver.CreatedAt
	}
	ver.IsActive = true

	if err := model.DB.Create(&ver).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "创建失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 200, "data": ver})
}

// AdminUpdateVersion 更新版本信息
func AdminUpdateVersion(c *gin.Context) {
	id := c.Param("id")

	var ver model.AppVersion
	if err := model.DB.First(&ver, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "版本不存在"})
		return
	}

	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
		return
	}

	model.DB.Model(&ver).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"code": 200, "data": ver})
}

// AdminDeleteVersion 删除版本
func AdminDeleteVersion(c *gin.Context) {
	id := c.Param("id")
	model.DB.Delete(&model.AppVersion{}, id)
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "已删除"})
}
