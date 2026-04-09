package model

import (
	"log"

	"gorm.io/gorm"
)

// deriveBatchStatus 根据任务计数推导批次状态
func deriveBatchStatus(total, completed, failed int64) string {
	finished := completed + failed
	if finished == 0 {
		return "processing"
	}
	if finished >= total {
		if failed == 0 {
			return "completed"
		}
		if completed == 0 {
			return "failed"
		}
		return "partial"
	}
	return "processing"
}

// RecomputeBatchStatus 根据子任务状态重新计算批次的聚合状态
func RecomputeBatchStatus(db *gorm.DB, batchID string) {
	if batchID == "" {
		return
	}

	var completed, failed int64
	db.Model(&Task{}).Where("batch_id = ? AND status = ? AND deleted_at IS NULL", batchID, "completed").Count(&completed)
	db.Model(&Task{}).Where("batch_id = ? AND status = ? AND deleted_at IS NULL", batchID, "failed").Count(&failed)

	var batch Batch
	if err := db.Where("batch_id = ?", batchID).First(&batch).Error; err != nil {
		log.Printf("[Batch] recompute: batch %s not found: %v", batchID, err)
		return
	}

	total := int64(batch.TotalCount)
	status := deriveBatchStatus(total, completed, failed)

	if err := db.Model(&Batch{}).Where("batch_id = ?", batchID).Updates(map[string]interface{}{
		"completed_count": completed,
		"failed_count":    failed,
		"status":          status,
	}).Error; err != nil {
		log.Printf("[Batch] recompute: update batch %s failed: %v", batchID, err)
	}
}
