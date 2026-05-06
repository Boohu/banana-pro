package api

import (
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"image-gen-service/internal/rembg"
)

// 抠图相关 HTTP endpoints
//
// 业务模式：BYO Model
// - 不分发模型文件（避开 BRIA RAIL-M 等许可问题）
// - 用户从 HuggingFace 自行下载 .onnx，通过「模型管理」UI 导入到本地 models/ 目录
// - 用户调用 POST /rembg/remove 时指定 preset_id，sidecar 用对应模型推理

// ListRembgModelsHandler GET /api/v1/rembg/models
// 返回所有预设模型 + 当前导入状态
func ListRembgModelsHandler(c *gin.Context) {
	models := rembg.ListModels()
	Success(c, gin.H{"models": models})
}

// ImportRembgModelRequest 导入模型请求体
type ImportRembgModelRequest struct {
	PresetID string `json:"preset_id" binding:"required"`
	FilePath string `json:"file_path" binding:"required"` // 用户机器上的 .onnx 路径
}

// ImportRembgModelHandler POST /api/v1/rembg/import
// 把用户选的 .onnx 文件复制到 sidecar 的 models/ 目录
// 由桌面端通过 Tauri 文件选择对话框拿到本地路径，再 POST 给 sidecar
func ImportRembgModelHandler(c *gin.Context) {
	var req ImportRembgModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, 400, "参数错误: "+err.Error())
		return
	}
	// 简单路径合法性检查（防止路径遍历到 sidecar 工作目录之外）
	if strings.Contains(req.FilePath, "\x00") {
		Error(c, http.StatusBadRequest, 400, "非法的文件路径")
		return
	}

	st, err := rembg.ImportModel(req.PresetID, req.FilePath)
	if err != nil {
		log.Printf("[rembg] 导入失败: preset=%s err=%v", req.PresetID, err)
		Error(c, http.StatusBadRequest, 400, "导入失败: "+err.Error())
		return
	}
	Success(c, gin.H{"model": st})
}

// DeleteRembgModelHandler DELETE /api/v1/rembg/models/:id
func DeleteRembgModelHandler(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		Error(c, http.StatusBadRequest, 400, "缺少模型 id")
		return
	}
	if err := rembg.DeleteModel(id); err != nil {
		Error(c, http.StatusBadRequest, 400, "删除失败: "+err.Error())
		return
	}
	Success(c, gin.H{"deleted": id})
}

// RemoveBackgroundHandler POST /api/v1/rembg/remove
// multipart: image=<file>, model_id=<preset_id>
// 返回带 alpha 通道的 PNG（Content-Type: image/png）
func RemoveBackgroundHandler(c *gin.Context) {
	// 限制请求体大小，防 DoS
	const maxImageSize = 20 * 1024 * 1024
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxImageSize)

	modelID := strings.TrimSpace(c.PostForm("model_id"))
	if modelID == "" {
		Error(c, http.StatusBadRequest, 400, "缺少 model_id 参数")
		return
	}

	file, _, err := c.Request.FormFile("image")
	if err != nil {
		Error(c, http.StatusBadRequest, 400, "缺少 image 文件: "+err.Error())
		return
	}
	defer file.Close()

	limited := io.LimitReader(file, maxImageSize+1)
	imgBytes, err := io.ReadAll(limited)
	if err != nil {
		Error(c, http.StatusBadRequest, 400, "读取图片失败: "+err.Error())
		return
	}
	if len(imgBytes) > maxImageSize {
		Error(c, http.StatusBadRequest, 400, "图片大小超过 20MB 限制")
		return
	}
	if len(imgBytes) == 0 {
		Error(c, http.StatusBadRequest, 400, "图片为空")
		return
	}

	pngBytes, err := rembg.RemoveBackground(modelID, imgBytes)
	if err != nil {
		log.Printf("[rembg] 抠图失败: model=%s err=%v", modelID, err)
		Error(c, http.StatusBadRequest, 400, "抠图失败: "+err.Error())
		return
	}

	c.Header("Content-Type", "image/png")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Rembg-Model", modelID)
	c.Data(http.StatusOK, "image/png", pngBytes)
}
