package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"image-gen-service/internal/promptopt"
	"image-gen-service/internal/provider"
	"image-gen-service/internal/worker"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ---------- Request / Response ----------

type DraftBatchRequest struct {
	BatchID  string                 `json:"batch_id"`  // 可选：传则 upsert
	Prompt   string                 `json:"prompt"`
	Provider string                 `json:"provider"`
	ModelID  string                 `json:"model_id"`
	Params   map[string]interface{} `json:"params"`
}

type BatchResponse struct {
	model.Batch
	Tasks []model.Task `json:"tasks,omitempty"`
}

// ---------- Handlers ----------

// CreateDraftBatchHandler 创建或更新 draft 批次
// POST /batches/draft
func CreateDraftBatchHandler(c *gin.Context) {
	var req DraftBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, 400, err.Error())
		return
	}

	if strings.TrimSpace(req.Prompt) == "" {
		Error(c, http.StatusBadRequest, 400, "prompt 不能为空")
		return
	}

	count := 1
	if v, ok := req.Params["count"].(float64); ok && v > 0 {
		count = int(v)
	} else if v, ok := req.Params["count"].(int); ok && v > 0 {
		count = v
	}
	if count < 1 {
		count = 1
	}
	if count > 10 {
		count = 10
	}

	configSnapshot := buildConfigSnapshot(req.Provider, req.ModelID, req.Params)

	// Upsert: 如果传了 batch_id 且存在 draft，则更新
	if req.BatchID != "" {
		var existing model.Batch
		if err := model.DB.Where("batch_id = ? AND status = ?", req.BatchID, "draft").First(&existing).Error; err == nil {
			updates := map[string]interface{}{
				"prompt":          strings.TrimSpace(req.Prompt),
				"provider_name":   req.Provider,
				"model_id":        req.ModelID,
				"total_count":     count,
				"config_snapshot": configSnapshot,
			}
			model.DB.Model(&existing).Updates(updates)
			// 重新查一次返回完整数据
			model.DB.Where("batch_id = ?", req.BatchID).First(&existing)
			Success(c, existing)
			return
		}
	}

	// 新建 draft
	batch := model.Batch{
		BatchID:        uuid.New().String(),
		Prompt:         strings.TrimSpace(req.Prompt),
		ProviderName:   req.Provider,
		ModelID:        req.ModelID,
		TotalCount:     count,
		Status:         "draft",
		ConfigSnapshot: configSnapshot,
	}

	if err := model.DB.Create(&batch).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建批次失败")
		return
	}

	Success(c, batch)
}

// SubmitBatchHandler 提交 draft 批次，创建 N 个 Task 并提交 worker
// POST /batches/:batch_id/submit
func SubmitBatchHandler(c *gin.Context) {
	batchID := c.Param("batch_id")

	var batch model.Batch
	if err := model.DB.Where("batch_id = ?", batchID).First(&batch).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "批次未找到")
		return
	}
	if batch.Status != "draft" {
		Error(c, http.StatusBadRequest, 400, "批次状态不是 draft，无法提交")
		return
	}

	// 解析 provider
	p := provider.GetProvider(batch.ProviderName)
	if p == nil {
		Error(c, http.StatusBadRequest, 400, "未找到指定的 Provider: "+batch.ProviderName)
		return
	}

	resolved := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: batch.ProviderName,
		RequestModel: batch.ModelID,
	})
	modelID := resolved.ID

	// 解析 config snapshot 中的参数
	var snapshotParams map[string]interface{}
	if batch.ConfigSnapshot != "" {
		_ = json.Unmarshal([]byte(batch.ConfigSnapshot), &snapshotParams)
	}
	if snapshotParams == nil {
		snapshotParams = map[string]interface{}{}
	}

	// 确保 prompt 和 model_id 在 params 中
	snapshotParams["prompt"] = batch.Prompt
	snapshotParams["model_id"] = modelID
	snapshotParams["count"] = 1 // 每个子任务生成 1 张

	promptOptimizeMode := promptopt.ExtractMode(snapshotParams)

	// 获取月份文件夹
	monthFolder, err := getOrCreateMonthFolder(model.DB, time.Now())
	folderID := ""
	if err != nil {
		log.Printf("[Batch] 警告: 获取或创建月份文件夹失败: %v\n", err)
	} else {
		folderID = strconv.FormatUint(uint64(monthFolder.ID), 10)
	}

	// 在事务中创建 N 个 Task
	tasks := make([]*model.Task, 0, batch.TotalCount)
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < batch.TotalCount; i++ {
			taskID := uuid.New().String()
			taskModel := &model.Task{
				TaskID:             taskID,
				BatchID:            batch.BatchID,
				Prompt:             batch.Prompt,
				PromptOriginal:     batch.Prompt,
				PromptOptimizeMode: promptOptimizeMode,
				ProviderName:       batch.ProviderName,
				ModelID:            modelID,
				TotalCount:         1,
				Status:             "pending",
				FolderID:           folderID,
				ConfigSnapshot:     batch.ConfigSnapshot,
			}
			if err := tx.Create(taskModel).Error; err != nil {
				return err
			}
			tasks = append(tasks, taskModel)
		}
		return nil
	})
	if err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建子任务失败: "+err.Error())
		return
	}

	// 更新批次状态和文件夹
	model.DB.Model(&batch).Updates(map[string]interface{}{
		"status":    "pending",
		"folder_id": folderID,
	})

	// 事务提交后逐个提交到 worker
	submittedCount := 0
	for _, taskModel := range tasks {
		// 每个 task 需要独立的 params 副本
		taskParams := make(map[string]interface{})
		for k, v := range snapshotParams {
			taskParams[k] = v
		}
		diagnostic.AttachTaskID(taskParams, taskModel.TaskID)

		task := &worker.Task{
			TaskModel: taskModel,
			Params:    taskParams,
		}

		if worker.Pool.Submit(task) {
			submittedCount++
			diagnostic.Logf(taskParams, "batch_task_submitted",
				"batch_id=%s task_index=%d/%d",
				batch.BatchID, submittedCount, batch.TotalCount,
			)
		} else {
			// 队列满，标记该任务失败
			model.DB.Model(taskModel).Updates(map[string]interface{}{
				"status":        "failed",
				"error_message": "任务队列已满",
			})
		}
	}

	// 立即重算一次状态（可能有部分任务队列满失败）
	model.RecomputeBatchStatus(model.DB, batch.BatchID)

	// 重新加载批次和子任务返回
	var updatedBatch model.Batch
	model.DB.Where("batch_id = ?", batchID).First(&updatedBatch)

	var taskList []model.Task
	model.DB.Where("batch_id = ?", batchID).Order("created_at ASC").Find(&taskList)
	sanitizeTaskImagePathsBatch(taskList)

	Success(c, BatchResponse{
		Batch: updatedBatch,
		Tasks: taskList,
	})
}

// GetBatchHandler 查询批次详情（含子任务）
// GET /batches/:batch_id
func GetBatchHandler(c *gin.Context) {
	batchID := c.Param("batch_id")

	var batch model.Batch
	if err := model.DB.Where("batch_id = ?", batchID).First(&batch).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "批次未找到")
		return
	}

	var tasks []model.Task
	model.DB.Where("batch_id = ?", batchID).Order("created_at ASC").Find(&tasks)
	sanitizeTaskImagePathsBatch(tasks)
	enrichTaskErrors(tasks)

	Success(c, BatchResponse{
		Batch: batch,
		Tasks: tasks,
	})
}

// ListBatchesHandler 分页查询批次列表
// GET /batches
func ListBatchesHandler(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", c.DefaultQuery("pageSize", "20")))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	var total int64
	model.DB.Model(&model.Batch{}).Count(&total)

	var batches []model.Batch
	model.DB.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&batches)

	Success(c, gin.H{
		"total": total,
		"list":  batches,
	})
}

// DeleteBatchHandler 软删除批次（不删子任务）
// DELETE /batches/:batch_id
func DeleteBatchHandler(c *gin.Context) {
	batchID := c.Param("batch_id")

	var batch model.Batch
	if err := model.DB.Where("batch_id = ?", batchID).First(&batch).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "批次未找到")
		return
	}

	if err := model.DB.Delete(&batch).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "删除批次失败")
		return
	}

	Success(c, gin.H{"deleted": true})
}

// ---------- Batch SSE Streaming ----------

const (
	batchStreamPollInterval = 1 * time.Second
	batchStreamKeepAlive    = 3 * time.Second
)

// StreamBatchHandler SSE 推送批次聚合进度
// GET /batches/:batch_id/stream
func StreamBatchHandler(c *gin.Context) {
	batchID := c.Param("batch_id")

	var batch model.Batch
	if err := model.DB.Where("batch_id = ?", batchID).First(&batch).Error; err != nil {
		Error(c, http.StatusNotFound, 404, "批次未找到")
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Error(c, http.StatusInternalServerError, 500, "Streaming unsupported")
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// 首次推送：batch + 当前已完成的图片
	lastSignature := batchSignature(&batch)
	if !writeBatchEvent(c.Writer, flusher, &batch, batchID) {
		return
	}

	ticker := time.NewTicker(batchStreamPollInterval)
	defer ticker.Stop()
	keepAliveTicker := time.NewTicker(batchStreamKeepAlive)
	defer keepAliveTicker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			var latest model.Batch
			if err := model.DB.Where("batch_id = ?", batchID).First(&latest).Error; err != nil {
				return
			}

			signature := batchSignature(&latest)
			if signature != lastSignature {
				if !writeBatchEvent(c.Writer, flusher, &latest, batchID) {
					return
				}
				lastSignature = signature
			}

			if latest.Status == "completed" || latest.Status == "failed" || latest.Status == "partial" {
				return
			}
		case <-keepAliveTicker.C:
			if _, err := fmt.Fprintf(c.Writer, "event: ping\ndata: {}\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// batchStreamPayload 是 SSE 推送的数据结构
type batchStreamPayload struct {
	BatchID        string       `json:"batch_id"`
	Status         string       `json:"status"`
	TotalCount     int          `json:"total_count"`
	CompletedCount int          `json:"completed_count"`
	FailedCount    int          `json:"failed_count"`
	Tasks          []model.Task `json:"tasks"`
}

func writeBatchEvent(w http.ResponseWriter, flusher http.Flusher, batch *model.Batch, batchID string) bool {
	// 查询所有已完成的子任务（含图片信息）
	var tasks []model.Task
	model.DB.Where("batch_id = ? AND (status = ? OR status = ?)", batchID, "completed", "failed").
		Order("completed_at ASC").
		Find(&tasks)
	sanitizeTaskImagePathsBatch(tasks)
	enrichTaskErrors(tasks)

	payload := batchStreamPayload{
		BatchID:        batch.BatchID,
		Status:         batch.Status,
		TotalCount:     batch.TotalCount,
		CompletedCount: batch.CompletedCount,
		FailedCount:    batch.FailedCount,
		Tasks:          tasks,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

func batchSignature(batch *model.Batch) string {
	return fmt.Sprintf("%s|%d|%d|%d",
		batch.Status,
		batch.TotalCount,
		batch.CompletedCount,
		batch.FailedCount,
	)
}
