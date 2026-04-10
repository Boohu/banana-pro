package worker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"image-gen-service/internal/promptopt"
	"image-gen-service/internal/provider"
	"image-gen-service/internal/storage"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

// Task 表示一个生成任务
type Task struct {
	TaskModel *model.Task
	Params    map[string]interface{}
}

// WorkerPool 任务池结构
type WorkerPool struct {
	workerCount int
	taskQueue   chan *Task
	wg          sync.WaitGroup
	ctx         context.Context
	cancel      context.CancelFunc
	stopping    int32

	// 批量处理并发控制：每个 batchID 维护一个待提交队列
	pendingMu      sync.Mutex
	pendingQueue   map[string][]*Task // batchID → 待提交的任务
	pausedBatches  map[string]bool    // 暂停的批次
}

var Pool *WorkerPool

// InitPool 初始化全局任务池
func InitPool(workerCount, queueSize int) {
	ctx, cancel := context.WithCancel(context.Background())
	Pool = &WorkerPool{
		workerCount:  workerCount,
		taskQueue:    make(chan *Task, queueSize),
		ctx:          ctx,
		cancel:       cancel,
		pendingQueue:  make(map[string][]*Task),
		pausedBatches: make(map[string]bool),
	}
}

// Start 启动所有 Worker
func (wp *WorkerPool) Start() {
	for i := 0; i < wp.workerCount; i++ {
		wp.wg.Add(1)
		go wp.worker(i)
	}
	log.Printf("Worker 池已启动，Worker 数量: %d", wp.workerCount)
}

// Stop 优雅停止 Worker 池
func (wp *WorkerPool) Stop() {
	atomic.StoreInt32(&wp.stopping, 1)

	// 先 cancel，确保进行中的 provider 调用尽快退出，避免“退出后仍长时间运行”
	wp.cancel()
	close(wp.taskQueue)
	wp.wg.Wait()

	log.Println("Worker 池已停止，进行中的任务已中断，队列遗留任务已标记失败")
}

// Submit 提交任务到队列
func (wp *WorkerPool) Submit(task *Task) (ok bool) {
	if atomic.LoadInt32(&wp.stopping) == 1 {
		return false
	}
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	select {
	case wp.taskQueue <- task:
		return true
	default:
		// 队列已满
		return false
	}
}

func (wp *WorkerPool) worker(id int) {
	defer wp.wg.Done()
	log.Printf("Worker %d 启动", id)

	for {
		select {
		case <-wp.ctx.Done():
			log.Printf("Worker %d 收到停止信号", id)
			wp.drainPendingTasks(id)
			return
		case task, ok := <-wp.taskQueue:
			if !ok {
				return
			}
			wp.processTask(task)
		}
	}
}

func (wp *WorkerPool) drainPendingTasks(workerID int) {
	drained := 0
	for {
		select {
		case task, ok := <-wp.taskQueue:
			if !ok {
				if drained > 0 {
					log.Printf("Worker %d 退出前收敛了 %d 个队列遗留任务", workerID, drained)
				}
				return
			}
			if task == nil || task.TaskModel == nil {
				continue
			}
			wp.failTask(task, errors.New(model.STALE_TASK_ERROR_MESSAGE))
			drained++
		default:
			if drained > 0 {
				log.Printf("Worker %d 退出前收敛了 %d 个队列遗留任务", workerID, drained)
			}
			return
		}
	}
}

// processTask 处理单个任务（由 Worker 调用）
func (wp *WorkerPool) processTask(task *Task) {
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("任务处理异常崩溃: %v", r)
			log.Printf("任务 %s panic: %v\n%s", task.TaskModel.TaskID, r, string(debug.Stack()))
			wp.failTask(task, err)
		}
	}()

	if !task.TaskModel.CreatedAt.IsZero() {
		log.Printf("任务 %s 开始处理: provider=%s model=%s queue_wait=%s", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, time.Since(task.TaskModel.CreatedAt))
	} else {
		log.Printf("任务 %s 开始处理: provider=%s model=%s", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID)
	}
	if task.Params == nil {
		task.Params = map[string]interface{}{}
	}
	diagnostic.AttachTaskID(task.Params, task.TaskModel.TaskID)
	queueWait := time.Duration(0)
	if !task.TaskModel.CreatedAt.IsZero() {
		queueWait = time.Since(task.TaskModel.CreatedAt)
	}
	diagnostic.Logf(task.Params, "worker_start",
		"provider=%s model=%s total_count=%d queue_wait=%s status_before=%s",
		task.TaskModel.ProviderName,
		task.TaskModel.ModelID,
		task.TaskModel.TotalCount,
		queueWait,
		task.TaskModel.Status,
	)

	// 1. 更新状态为 processing
	startedAt := time.Now()
	model.DB.Model(task.TaskModel).Updates(map[string]interface{}{
		"status":                "processing",
		"processing_started_at": &startedAt,
	})

	// 2. 获取 Provider
	p := provider.GetProvider(task.TaskModel.ProviderName)
	if p == nil {
		wp.failTask(task, fmt.Errorf("Provider %s 不存在", task.TaskModel.ProviderName))
		return
	}

	// 3. 调用 API 生成图片（带任务级超时）
	timeout := fetchProviderTimeout(task.TaskModel.ProviderName)
	ctx, cancel := context.WithTimeout(wp.ctx, timeout)
	defer cancel()

	type generateResult struct {
		result *provider.ProviderResult
		err    error
	}

	callStartedAt := time.Now()
	log.Printf("任务 %s 调用 Provider 开始: provider=%s model=%s timeout=%s", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, timeout)
	diagnostic.Logf(task.Params, "provider_call_start",
		"provider=%s model=%s timeout=%s prompt_hash=%s prompt_len=%d",
		task.TaskModel.ProviderName,
		task.TaskModel.ModelID,
		timeout,
		diagnostic.PromptHash(task.TaskModel.Prompt),
		len([]rune(task.TaskModel.Prompt)),
	)

		if err := wp.optimizePromptForTask(ctx, task); err != nil {
			log.Printf("任务 %s 自动优化提示词失败，终止生图: %v", task.TaskModel.TaskID, err)
			diagnostic.Logf(task.Params, "prompt_optimize_failed",
				"mode=%s provider=%s model=%s err=%q fallback=%t",
				task.TaskModel.PromptOptimizeMode,
				promptopt.ExtractProvider(task.Params),
				promptopt.ExtractModel(task.Params),
				err.Error(),
				false,
			)
			wp.failTask(task, fmt.Errorf("提示词优化失败: %w", err))
			return
		}

	done := make(chan generateResult, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- generateResult{
					err: fmt.Errorf("Provider 执行异常崩溃: %v", r),
				}
			}
		}()
		result, err := p.Generate(ctx, task.Params)
		elapsed := time.Since(callStartedAt)
		if err != nil {
			log.Printf("任务 %s 调用 Provider 失败: provider=%s model=%s elapsed=%s err=%v", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, elapsed, err)
			summary := diagnostic.SummarizeError(err)
			diagnostic.Logf(task.Params, "provider_call_error",
				"provider=%s model=%s elapsed=%s error_type=%s error_code=%s category=%s retryable=%t request_id=%s user_message=%q raw_error=%q",
				task.TaskModel.ProviderName,
				task.TaskModel.ModelID,
				elapsed,
				summary.Type,
				summary.Code,
				summary.Category,
				summary.Retryable,
				summary.RequestID,
				summary.UserMessage,
				err.Error(),
			)
		} else {
			imageCount := 0
			if result != nil {
				imageCount = len(result.Images)
			}
			log.Printf("任务 %s 调用 Provider 成功: provider=%s model=%s elapsed=%s images=%d", task.TaskModel.TaskID, task.TaskModel.ProviderName, task.TaskModel.ModelID, elapsed, imageCount)
			diagnostic.Logf(task.Params, "provider_call_success",
				"provider=%s model=%s elapsed=%s images=%d metadata=%v",
				task.TaskModel.ProviderName,
				task.TaskModel.ModelID,
				elapsed,
				imageCount,
				func() map[string]interface{} {
					if result == nil || result.Metadata == nil {
						return map[string]interface{}{}
					}
					return result.Metadata
				}(),
			)
		}
		done <- generateResult{result: result, err: err}
	}()

	var result *provider.ProviderResult
	select {
	case <-ctx.Done():
		err := ctx.Err()
		if errors.Is(err, context.DeadlineExceeded) {
			wp.failTask(task, fmt.Errorf("生成超时(%s)", timeout))
		} else {
			wp.failTask(task, err)
		}
		return
	case out := <-done:
		if out.err != nil {
			if errors.Is(out.err, context.DeadlineExceeded) {
				wp.failTask(task, fmt.Errorf("生成超时(%s)", timeout))
			} else {
				wp.failTask(task, out.err)
			}
			return
		}
		result = out.result
	}

	// 记录配置快照
	configSnapshot := ""
	if task.TaskModel.ModelID != "" {
		configSnapshot = fmt.Sprintf("Model: %s", task.TaskModel.ModelID)
	}

	// 4. 存储图片（含缩略图生成）
	// 文件后缀由 storage 层根据实际图片格式自动确定
	if len(result.Images) > 0 {
		// 批量处理后处理：格式转换、质量调整、保留原始尺寸
		if _, hasFmt := task.Params["output_format"]; hasFmt {
			result.Images[0] = postProcessImage(result.Images[0], task.Params)
		}

		// 批量处理命名规则
		baseFileName := buildBatchFileName(task.Params)
		if baseFileName == "" {
			baseFileName = task.TaskModel.TaskID
		}
		// 警告：当前只保存第一张图片，其余丢弃
		if len(result.Images) > 1 {
			log.Printf("任务 %s 生成了 %d 张图片，当前只保存第1张，其余 %d 张已丢弃", task.TaskModel.TaskID, len(result.Images), len(result.Images)-1)
		}
		diagnostic.Logf(task.Params, "storage_start",
			"image_count=%d first_image_bytes=%d",
			len(result.Images),
			len(result.Images[0]),
		)
		reader := bytes.NewReader(result.Images[0])
		localPath, remoteURL, thumbLocalPath, thumbRemoteURL, width, height, err := storage.GlobalStorage.SaveWithThumbnail(baseFileName, reader)
		if err != nil {
			wp.failTask(task, err)
			return
		}

		// 如果指定了 outputDir，额外复制一份到目标目录
		if outputDir, ok := task.Params["output_dir"].(string); ok && outputDir != "" {
			go func() {
				if copyErr := copyFileToOutputDir(localPath, outputDir, baseFileName); copyErr != nil {
					log.Printf("[BatchProcess] 复制到输出目录失败: %v", copyErr)
				} else {
					log.Printf("[BatchProcess] 已复制到输出目录: %s", outputDir)
				}
			}()
		}

		// 5. 更新成功状态
		now := time.Now()
		updates := map[string]interface{}{
			"status":         "completed",
			"image_url":      remoteURL,
			"local_path":     localPath,
			"thumbnail_url":  thumbRemoteURL,
			"thumbnail_path": thumbLocalPath,
			"width":          width,
			"height":         height,
			"completed_at":   &now,
		}

		// 兼容：历史版本可能未写入 config_snapshot，这里只在为空时补充
		if task.TaskModel.ConfigSnapshot == "" && configSnapshot != "" {
			updates["config_snapshot"] = configSnapshot
		}

		if dbResult := model.DB.Model(task.TaskModel).Updates(updates); dbResult.Error != nil {
			log.Printf("任务 %s 数据库更新失败（图片文件已保存至磁盘）: %v", task.TaskModel.TaskID, dbResult.Error)
		} else {
			log.Printf("任务 %s 处理完成", task.TaskModel.TaskID)
			diagnostic.Logf(task.Params, "storage_success",
				"local_path=%q remote_url=%q thumbnail_path=%q thumbnail_url=%q width=%d height=%d",
				localPath,
				remoteURL,
				thumbLocalPath,
				thumbRemoteURL,
				width,
				height,
			)
			diagnostic.Logf(task.Params, "db_update_success",
				"status=%s completed_at=%s",
				"completed",
				now.Format(time.RFC3339Nano),
			)
		}
		// 更新批次聚合状态并提交下一个待处理任务
		if task.TaskModel.BatchID != "" {
			model.RecomputeBatchStatus(model.DB, task.TaskModel.BatchID)
			wp.submitNextPending(task.TaskModel.BatchID)
		}
	} else {
		wp.failTask(task, fmt.Errorf("未生成任何图片"))
	}
}

func (wp *WorkerPool) optimizePromptForTask(ctx context.Context, task *Task) error {
	if task == nil || task.TaskModel == nil {
		return nil
	}
	mode := promptopt.NormalizeMode(task.TaskModel.PromptOptimizeMode)
	if !promptopt.Enabled(mode) {
		return nil
	}

	rawPrompt := strings.TrimSpace(task.TaskModel.PromptOriginal)
	if rawPrompt == "" {
		rawPrompt = promptopt.ExtractOriginalPrompt(task.Params)
	}
	if rawPrompt == "" {
		rawPrompt = strings.TrimSpace(task.TaskModel.Prompt)
	}
	if rawPrompt == "" {
		rawPrompt = promptopt.ExtractPrompt(task.Params)
	}
	if rawPrompt == "" {
		return fmt.Errorf("原始提示词为空")
	}

	optProvider := promptopt.ExtractProvider(task.Params)
	optModel := promptopt.ExtractModel(task.Params)
	startedAt := time.Now()
	diagnostic.Logf(task.Params, "prompt_optimize_start",
		"mode=%s provider=%s model=%s prompt_hash=%s prompt_len=%d",
		mode,
		optProvider,
		optModel,
		diagnostic.PromptHash(rawPrompt),
		len([]rune(rawPrompt)),
	)

	result, err := promptopt.OptimizePrompt(ctx, promptopt.Request{
		Provider: optProvider,
		Model:    optModel,
		Prompt:   rawPrompt,
		Mode:     mode,
	})
	if err != nil {
		return err
	}

	optimized := strings.TrimSpace(result.Prompt)
	if optimized == "" || optimized == rawPrompt {
		task.TaskModel.PromptOriginal = rawPrompt
		task.TaskModel.Prompt = rawPrompt
		task.TaskModel.PromptOptimized = ""
		return nil
	}

	updates := map[string]interface{}{
		"prompt_original":      rawPrompt,
		"prompt_optimized":     optimized,
		"prompt":               optimized,
		"prompt_optimize_mode": mode,
	}
	if err := model.DB.Model(task.TaskModel).Updates(updates).Error; err != nil {
		return fmt.Errorf("保存优化后的提示词失败: %w", err)
	}

	task.TaskModel.PromptOriginal = rawPrompt
	task.TaskModel.PromptOptimized = optimized
	task.TaskModel.Prompt = optimized
	if task.Params == nil {
		task.Params = map[string]interface{}{}
	}
	task.Params["prompt_original"] = rawPrompt
	task.Params["prompt_optimized"] = optimized
	task.Params["prompt"] = optimized
	task.Params["prompt_optimize_mode"] = mode
	task.Params["prompt_optimize_provider"] = result.Provider
	task.Params["prompt_optimize_model"] = result.Model

	diagnostic.Logf(task.Params, "prompt_optimize_success",
		"mode=%s provider=%s model=%s elapsed=%s original_hash=%s optimized_hash=%s optimized_len=%d",
		mode,
		result.Provider,
		result.Model,
		time.Since(startedAt),
		diagnostic.PromptHash(rawPrompt),
		diagnostic.PromptHash(optimized),
		len([]rune(optimized)),
	)
	return nil
}

func (wp *WorkerPool) failTask(task *Task, err error) {
	if task == nil || task.TaskModel == nil {
		log.Printf("任务失败，但任务信息缺失: %v", err)
		return
	}
	taskModel := task.TaskModel
	log.Printf("任务 %s 失败: %v", taskModel.TaskID, err)
	params := task.Params
	if params == nil {
		params = map[string]interface{}{}
	}
	diagnostic.AttachTaskID(params, taskModel.TaskID)
	summary := diagnostic.SummarizeError(err)
	diagnostic.Logf(params, "task_failed",
		"provider=%s model=%s error_type=%s error_code=%s category=%s retryable=%t request_id=%s user_message=%q raw_error=%q",
		taskModel.ProviderName,
		taskModel.ModelID,
		summary.Type,
		summary.Code,
		summary.Category,
		summary.Retryable,
		summary.RequestID,
		summary.UserMessage,
		err.Error(),
	)
	if dbResult := model.DB.Model(taskModel).Updates(map[string]interface{}{
		"status":        "failed",
		"error_message": err.Error(),
	}); dbResult.Error != nil {
		log.Printf("任务 %s 写入失败状态到数据库时出错: %v", taskModel.TaskID, dbResult.Error)
	}
	// 更新批次聚合状态并提交下一个待处理任务
	if taskModel.BatchID != "" {
		model.RecomputeBatchStatus(model.DB, taskModel.BatchID)
		wp.submitNextPending(taskModel.BatchID)

		// 自动重试：如果启用且未超过最大重试次数
		if autoRetry, ok := task.Params["auto_retry"].(bool); ok && autoRetry {
			retryCount := 0
			if v, ok := task.Params["retry_count"].(int); ok {
				retryCount = v
			}
			if retryCount < 2 {
				log.Printf("[AutoRetry] 任务 %s 第 %d 次重试", taskModel.TaskID, retryCount+1)
				// 重置状态
				model.DB.Model(taskModel).Updates(map[string]interface{}{
					"status":        "pending",
					"error_message": "",
				})
				task.Params["retry_count"] = retryCount + 1
				wp.Submit(task)
			}
		}
	}
}

// EnqueuePending 将任务放入批次待提交队列（并发控制用）
func (wp *WorkerPool) EnqueuePending(batchID string, task *Task) {
	wp.pendingMu.Lock()
	defer wp.pendingMu.Unlock()
	wp.pendingQueue[batchID] = append(wp.pendingQueue[batchID], task)
}

// PauseBatch 暂停批次：停止提交后续任务
func (wp *WorkerPool) PauseBatch(batchID string) {
	wp.pendingMu.Lock()
	defer wp.pendingMu.Unlock()
	wp.pausedBatches[batchID] = true
	log.Printf("[WorkerPool] 批次 %s 已暂停", batchID)
}

// ResumeBatch 恢复批次：继续提交待处理任务
func (wp *WorkerPool) ResumeBatch(batchID string) {
	wp.pendingMu.Lock()
	delete(wp.pausedBatches, batchID)
	wp.pendingMu.Unlock()
	log.Printf("[WorkerPool] 批次 %s 已恢复", batchID)
	// 立即尝试提交下一个
	wp.submitNextPending(batchID)
}

// IsBatchPaused 检查批次是否暂停
func (wp *WorkerPool) IsBatchPaused(batchID string) bool {
	wp.pendingMu.Lock()
	defer wp.pendingMu.Unlock()
	return wp.pausedBatches[batchID]
}

// submitNextPending 从待提交队列取出下一个任务并提交
func (wp *WorkerPool) submitNextPending(batchID string) {
	wp.pendingMu.Lock()
	// 暂停中则不提交
	if wp.pausedBatches[batchID] {
		wp.pendingMu.Unlock()
		return
	}
	queue, ok := wp.pendingQueue[batchID]
	if !ok || len(queue) == 0 {
		wp.pendingMu.Unlock()
		return
	}
	next := queue[0]
	wp.pendingQueue[batchID] = queue[1:]
	if len(wp.pendingQueue[batchID]) == 0 {
		delete(wp.pendingQueue, batchID)
	}
	wp.pendingMu.Unlock()

	if !wp.Submit(next) {
		model.DB.Model(next.TaskModel).Updates(map[string]interface{}{
			"status":        "failed",
			"error_message": "任务队列已满",
		})
		model.RecomputeBatchStatus(model.DB, batchID)
	}
}

// postProcessImage 批量处理图片后处理：格式转换、质量调整、保留原始尺寸
func postProcessImage(imageData []byte, params map[string]interface{}) []byte {
	outputFormat, _ := params["output_format"].(string)
	quality, _ := params["quality"].(int)
	keepOriginal, _ := params["keep_original_size"].(bool)

	outputFormat = strings.ToUpper(strings.TrimSpace(outputFormat))
	if outputFormat == "" || (outputFormat != "JPG" && outputFormat != "PNG" && outputFormat != "WEBP") {
		// 不需要转换，检查是否需要保留原始尺寸
		if !keepOriginal {
			return imageData
		}
	}

	// 解码生成的图片
	resultImg, _, err := image.Decode(bytes.NewReader(imageData))
	if err != nil {
		log.Printf("[PostProcess] 解码图片失败，跳过后处理: %v", err)
		return imageData
	}

	// 保留原始尺寸：将结果图缩放到参考图的尺寸
	if keepOriginal {
		if refImages, ok := params["reference_images"].([]interface{}); ok && len(refImages) > 0 {
			if refBytes, ok := refImages[0].([]byte); ok {
				refImg, _, refErr := image.Decode(bytes.NewReader(refBytes))
				if refErr == nil {
					refBounds := refImg.Bounds()
					if refBounds.Dx() > 0 && refBounds.Dy() > 0 {
						resultImg = imaging.Resize(resultImg, refBounds.Dx(), refBounds.Dy(), imaging.Lanczos)
					}
				}
			}
		}
	}

	// 编码为目标格式
	var buf bytes.Buffer
	switch outputFormat {
	case "JPG":
		q := jpeg.DefaultQuality
		if quality > 0 && quality <= 100 {
			q = quality
		}
		if err := jpeg.Encode(&buf, resultImg, &jpeg.Options{Quality: q}); err != nil {
			return imageData
		}
	case "PNG":
		if err := png.Encode(&buf, resultImg); err != nil {
			return imageData
		}
	default:
		// WebP 或未知格式：回退为 PNG
		if err := png.Encode(&buf, resultImg); err != nil {
			return imageData
		}
	}
	return buf.Bytes()
}

// buildBatchFileName 根据命名规则生成输出文件名（不含后缀）
func buildBatchFileName(params map[string]interface{}) string {
	namingRule, _ := params["naming_rule"].(string)
	originalName, _ := params["original_file_name"].(string)

	if originalName == "" {
		return ""
	}

	// 去掉原始文件后缀
	baseName := strings.TrimSuffix(originalName, filepath.Ext(originalName))

	switch namingRule {
	case "原文件名_时间戳":
		return fmt.Sprintf("%s_%d", baseName, time.Now().UnixMilli())
	case "序号":
		// 序号模式下用 taskID 保证唯一，实际序号由前端根据顺序展示
		return ""
	default: // "原文件名_edited"
		return baseName + "_edited"
	}
}

// copyFileToOutputDir 将生成的图片复制到用户指定的输出目录
func copyFileToOutputDir(srcPath, outputDir, baseName string) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("创建输出目录失败: %w", err)
	}
	ext := filepath.Ext(srcPath)
	dstPath := filepath.Join(outputDir, baseName+ext)

	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

func fetchProviderTimeout(providerName string) time.Duration {
	name := strings.TrimSpace(strings.ToLower(providerName))
	if strings.HasPrefix(name, "gemini") {
		name = "gemini"
	} else if strings.HasPrefix(name, "openai") {
		name = "openai"
	}

	defaultTimeout := func(p string) time.Duration {
		switch p {
		case "gemini", "openai":
			return 500 * time.Second
		default:
			return 150 * time.Second
		}
	}

	if model.DB == nil || name == "" {
		return defaultTimeout(name)
	}
	var cfg model.ProviderConfig
	if err := model.DB.Select("timeout_seconds").Where("provider_name = ?", name).First(&cfg).Error; err != nil {
		return defaultTimeout(name)
	}
	if cfg.TimeoutSeconds <= 0 {
		return defaultTimeout(name)
	}
	return time.Duration(cfg.TimeoutSeconds) * time.Second
}
