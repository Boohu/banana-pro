package model

import (
	"fmt"
	"log"
	"os"
	"strings"

	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDB 初始化数据库（支持 MySQL 和 SQLite）
func InitDB() error {
	var dialector gorm.Dialector

	dsn := os.Getenv("DB_DSN")
	dbDriver := os.Getenv("DB_DRIVER")

	if dbDriver == "mysql" && dsn != "" {
		// MySQL: user:pass@tcp(host:port)/dbname?charset=utf8mb4&parseTime=True&loc=Local
		dialector = mysql.Open(dsn)
		log.Println("[DB] 使用 MySQL")
	} else {
		// 默认 SQLite（开发用）
		dbPath := os.Getenv("DB_PATH")
		if dbPath == "" {
			dbPath = "auth.db"
		}
		dialector = sqlite.Open(dbPath + "?_busy_timeout=5000")
		log.Printf("[DB] 使用 SQLite: %s\n", dbPath)
	}

	var err error
	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("连接数据库失败: %w", err)
	}

	// 自动迁移
	if err := DB.AutoMigrate(&User{}, &Subscription{}, &PaymentOrder{}, &VerifyCode{}, &SystemConfig{}); err != nil {
		return fmt.Errorf("数据库迁移失败: %w", err)
	}

	log.Println("[DB] 数据库初始化成功")
	return nil
}

// GetConfig 获取系统配置，优先读数据库，fallback 到环境变量
func GetConfig(key string) string {
	var config SystemConfig
	if err := DB.Where("`key` = ?", key).First(&config).Error; err == nil && config.Value != "" {
		return config.Value
	}
	// fallback 到环境变量（key 转大写）
	return os.Getenv(strings.ToUpper(key))
}
