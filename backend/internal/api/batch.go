package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"image-gen-service/internal/promptopt"
	"image-gen-service/internal/provider"
	"image-gen-service/internal/storage"
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

// PauseBatchHandler 暂停批次
// POST /batches/:batch_id/pause
func PauseBatchHandler(c *gin.Context) {
	batchID := c.Param("batch_id")
	worker.Pool.PauseBatch(batchID)
	// 更新数据库状态
	model.DB.Model(&model.Batch{}).Where("batch_id = ?", batchID).Update("status", "paused")
	Success(c, gin.H{"paused": true})
}

// ResumeBatchHandler 恢复批次
// POST /batches/:batch_id/resume
func ResumeBatchHandler(c *gin.Context) {
	batchID := c.Param("batch_id")
	worker.Pool.ResumeBatch(batchID)
	// 重算批次状态
	model.RecomputeBatchStatus(model.DB, batchID)
	Success(c, gin.H{"resumed": true})
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

// ProcessBatchHandler 批量图生图：接收多张图片，每张图创建一个图生图 Task
// POST /batches/process
func ProcessBatchHandler(c *gin.Context) {
	// 解析 multipart
	if err := c.Request.ParseMultipartForm(200 << 20); err != nil { // 200MB 上限
		Error(c, http.StatusBadRequest, 400, "解析请求失败: "+err.Error())
		return
	}
	form := c.Request.MultipartForm

	prompt := strings.TrimSpace(c.PostForm("prompt"))
	if prompt == "" {
		Error(c, http.StatusBadRequest, 400, "提示词不能为空")
		return
	}
	providerName := c.PostForm("provider")
	requestModelID := c.PostForm("model_id")
	aspectRatio := c.PostForm("aspectRatio")
	imageSize := c.PostForm("imageSize")
	promptOptimizeMode := c.PostForm("prompt_optimize_mode")
	outputFormat := c.PostForm("outputFormat")          // PNG/JPG/WebP（用户输出本地文件用）
	outputCompressionStr := c.PostForm("outputCompression") // 10-100，仅 jpeg/webp
	concurrencyStr := c.PostForm("concurrency")         // 1-6
	namingRule := c.PostForm("namingRule")              // 命名规则
	keepOriginalSize := c.PostForm("keepOriginalSize")  // true/false
	autoRetry := c.PostForm("autoRetry")                // true/false
	outputDir := c.PostForm("outputDir")                // 输出目录（桌面端）
	folderId := c.PostForm("folderId")                  // 指定文件夹 ID
	// OpenAI gpt-image-* 系列专属
	imageQuality := c.PostForm("imageQuality")       // low/medium/high/auto
	imageBackground := c.PostForm("imageBackground") // transparent/opaque/auto
	gptSize := strings.TrimSpace(c.PostForm("size")) // OpenAI/云雾的 size 字面量

	// outputCompression 兼容旧 quality 字段名（前端有可能还在传旧的）
	outputCompression := 100
	if outputCompressionStr == "" {
		outputCompressionStr = c.PostForm("quality")
	}
	if v, err := strconv.Atoi(outputCompressionStr); err == nil && v >= 10 && v <= 100 {
		outputCompression = v
	}
	concurrency := 3
	if v, err := strconv.Atoi(concurrencyStr); err == nil && v >= 1 && v <= 6 {
		concurrency = v
	}

	// 获取上传的文件
	files := form.File["files"]
	if len(files) == 0 {
		Error(c, http.StatusBadRequest, 400, "至少上传一张图片")
		return
	}

	// 验证 Provider
	p := provider.GetProvider(providerName)
	if p == nil {
		Error(c, http.StatusBadRequest, 400, "未找到指定的 Provider: "+providerName)
		return
	}

	resolved := provider.ResolveModelID(provider.ModelResolveOptions{
		ProviderName: providerName,
		RequestModel: requestModelID,
	})
	modelID := resolved.ID

	// 构建配置快照
	configParams := map[string]interface{}{
		"aspectRatio":        aspectRatio,
		"imageSize":          imageSize,
		"count":              1,
		"output_format":      outputFormat,
		"output_compression": outputCompression,
		"image_quality":      imageQuality,
		"image_background":   imageBackground,
		"concurrency":        concurrency,
		"naming_rule":        namingRule,
		"keep_original_size": keepOriginalSize == "true",
		"auto_retry":         autoRetry == "true",
	}
	if promptOptimizeMode != "" {
		configParams["prompt_optimize_mode"] = promptOptimizeMode
	}
	configSnapshot := buildConfigSnapshot(providerName, modelID, configParams)

	// 创建 Batch 记录
	batchID := uuid.New().String()
	batch := model.Batch{
		BatchID:        batchID,
		Prompt:         prompt,
		ProviderName:   providerName,
		ModelID:        modelID,
		TotalCount:     len(files),
		Status:         "pending",
		ConfigSnapshot: configSnapshot,
	}

	// 确定文件夹：优先用户指定 > 自动创建月份文件夹
	folderID := ""
	if folderId != "" {
		folderID = folderId
	} else {
		monthFolder, folderErr := getOrCreateMonthFolder(model.DB, time.Now())
		if folderErr != nil {
			log.Printf("[BatchProcess] 警告: 获取或创建月份文件夹失败: %v\n", folderErr)
		} else {
			folderID = strconv.FormatUint(uint64(monthFolder.ID), 10)
		}
	}
	batch.FolderID = folderID

	if err := model.DB.Create(&batch).Error; err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建批次失败: "+err.Error())
		return
	}

	// 读取每个文件内容并创建 Task
	tasks := make([]*model.Task, 0, len(files))
	fileContents := make([][]byte, 0, len(files))

	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			log.Printf("[BatchProcess] 打开文件失败 %s: %v\n", fh.Filename, err)
			continue
		}
		content, err := readAllAndClose(f)
		if err != nil {
			log.Printf("[BatchProcess] 读取文件失败 %s: %v\n", fh.Filename, err)
			continue
		}

		// 保存原始参考图到磁盘
		taskID := uuid.New().String()
		originalImagePath := ""
		if baseDir := storage.GetBaseDir(); baseDir != "" {
			origDir := filepath.Join(baseDir, "originals")
			_ = os.MkdirAll(origDir, 0755)
			ext := filepath.Ext(fh.Filename)
			if ext == "" {
				ext = ".jpg"
			}
			origPath := filepath.Join(origDir, "orig_"+taskID+ext)
			if writeErr := os.WriteFile(origPath, content, 0644); writeErr != nil {
				log.Printf("[BatchProcess] 保存原始图失败 %s: %v\n", fh.Filename, writeErr)
			} else {
				originalImagePath = "/storage/originals/orig_" + taskID + ext
			}
		}

		taskModel := &model.Task{
			TaskID:             taskID,
			BatchID:            batchID,
			Prompt:             prompt,
			PromptOriginal:     prompt,
			PromptOptimizeMode: promptOptimizeMode,
			ProviderName:       providerName,
			ModelID:            modelID,
			TotalCount:         1,
			Status:             "pending",
			FolderID:           folderID,
			ConfigSnapshot:     configSnapshot,
			OriginalFileName:   fh.Filename,
			OriginalImagePath:  originalImagePath,
		}
		tasks = append(tasks, taskModel)
		fileContents = append(fileContents, content)
	}

	if len(tasks) == 0 {
		Error(c, http.StatusBadRequest, 400, "没有可处理的图片文件")
		return
	}

	// 更新实际任务数（可能有文件读取失败的）
	if len(tasks) != batch.TotalCount {
		batch.TotalCount = len(tasks)
		model.DB.Model(&batch).Update("total_count", len(tasks))
	}

	// 事务批量创建 Task
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		for _, t := range tasks {
			if err := tx.Create(t).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		Error(c, http.StatusInternalServerError, 500, "创建子任务失败: "+err.Error())
		return
	}

	// 构建所有 Worker 任务
	workerTasks := make([]*worker.Task, 0, len(tasks))
	for i, taskModel := range tasks {
		taskParams := map[string]interface{}{
			"prompt":             prompt,
			"provider":           providerName,
			"model_id":           modelID,
			"aspect_ratio":       aspectRatio,
			"resolution_level":   imageSize,
			"count":              1,
			"reference_images":   []interface{}{fileContents[i]},
			"output_format":      outputFormat,
			"output_compression": outputCompression,
			// OpenAI gpt-image-* 系列专属（其他 provider 会忽略）
			"imageQuality":       imageQuality,
			"imageBackground":    imageBackground,
			"size":               gptSize, // 显式 size 字面量优先于 aspectRatio + resolution_level 推导
			"naming_rule":        namingRule,
			"original_file_name": taskModel.OriginalFileName,
			"keep_original_size": keepOriginalSize == "true",
			"auto_retry":         autoRetry == "true",
			"output_dir":         outputDir,
			"batch_concurrency":  concurrency,
		}
		if promptOptimizeMode != "" {
			taskParams["prompt_optimize_mode"] = promptOptimizeMode
		}
		diagnostic.AttachTaskID(taskParams, taskModel.TaskID)

		workerTasks = append(workerTasks, &worker.Task{
			TaskModel: taskModel,
			Params:    taskParams,
		})
	}

	// 按并发数提交：先提交 concurrency 个，剩余放入待提交队列
	submittedCount := 0
	for i, wt := range workerTasks {
		if i < concurrency {
			if worker.Pool.Submit(wt) {
				submittedCount++
			} else {
				model.DB.Model(wt.TaskModel).Updates(map[string]interface{}{
					"status":        "failed",
					"error_message": "任务队列已满",
				})
			}
		} else {
			// 放入待提交队列，任务完成时会自动提交下一个
			worker.Pool.EnqueuePending(batchID, wt)
		}
	}

	// 重算批次状态
	model.RecomputeBatchStatus(model.DB, batchID)

	// 返回结果
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

// readAllAndClose 读取文件内容并关闭
func readAllAndClose(f interface{ Read([]byte) (int, error); Close() error }) ([]byte, error) {
	defer f.Close()
	var buf []byte
	tmp := make([]byte, 32*1024)
	for {
		n, err := f.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, err
		}
	}
	return buf, nil
}

func batchSignature(batch *model.Batch) string {
	return fmt.Sprintf("%s|%d|%d|%d",
		batch.Status,
		batch.TotalCount,
		batch.CompletedCount,
		batch.FailedCount,
	)
}
