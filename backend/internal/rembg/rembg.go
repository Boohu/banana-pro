package rembg

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// 模块对外暴露的状态/接口

var (
	initOnce      sync.Once
	initErr       error
	modelsRootDir string // ~/Library/Application Support/com.dztool.banana/models 之类
	ortInited     bool
)

// Options 初始化参数
type Options struct {
	// ModelsDir 用户模型存放目录（每次启动 sidecar 时由调用方传入工作目录下的 models/）
	ModelsDir string
	// SidecarBinDir sidecar 二进制所在目录，用于查找同目录下的 onnxruntime native lib
	// 例：desktop/src-tauri/bin/ 在打包后；dev 模式下可能是 backend 目录
	SidecarBinDir string
	// FallbackOrtLibPath 上面找不到时的 fallback 路径（dev 模式下用绝对路径）
	FallbackOrtLibPath string
}

// Init 模块初始化：配置 ONNX Runtime 共享库路径 + 创建 models 目录
// 必须在 sidecar 启动时调用一次。失败不影响其他功能（抠图功能仅在调用时报错）。
func Init(opts Options) error {
	var firstErr error
	initOnce.Do(func() {
		modelsRootDir = opts.ModelsDir
		if modelsRootDir == "" {
			firstErr = errors.New("rembg: ModelsDir is empty")
			return
		}
		if err := os.MkdirAll(modelsRootDir, 0o755); err != nil {
			firstErr = fmt.Errorf("rembg: mkdir models dir: %w", err)
			return
		}

		libPath := findOrtLibrary(opts.SidecarBinDir, opts.FallbackOrtLibPath)
		if libPath == "" {
			// 找不到也不算致命错误：用户调用抠图时再报错，不影响其他 API
			log.Printf("[rembg] ONNX Runtime native lib 未找到，抠图功能将不可用")
			initErr = errors.New("rembg: onnxruntime native lib not found")
			return
		}

		ort.SetSharedLibraryPath(libPath)
		if err := ort.InitializeEnvironment(); err != nil {
			initErr = fmt.Errorf("rembg: initialize ort: %w", err)
			return
		}
		ortInited = true
		log.Printf("[rembg] ONNX Runtime 初始化成功 lib=%s models=%s", libPath, modelsRootDir)
	})
	if firstErr != nil {
		return firstErr
	}
	return nil
}

// Shutdown 进程退出前清理（main.go defer）
func Shutdown() {
	destroyAllSessions()
	if ortInited {
		ort.DestroyEnvironment()
		ortInited = false
	}
}

// findOrtLibrary 按优先级查找 ONNX Runtime 动态库
// 1. SidecarBinDir/onnxruntime/<platform-libname>
// 2. FallbackOrtLibPath
func findOrtLibrary(sidecarDir, fallback string) string {
	libname := platformOrtLibName()
	if sidecarDir != "" {
		// 标准布局：bin/onnxruntime/<libname>
		candidates := []string{
			filepath.Join(sidecarDir, "onnxruntime", libname),
			filepath.Join(sidecarDir, libname),
		}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	if fallback != "" {
		if _, err := os.Stat(fallback); err == nil {
			return fallback
		}
	}
	return ""
}

func platformOrtLibName() string {
	switch runtime.GOOS {
	case "darwin":
		return "libonnxruntime.1.22.0.dylib"
	case "linux":
		return "libonnxruntime.so.1.22.0"
	case "windows":
		return "onnxruntime.dll"
	}
	return "libonnxruntime.dylib"
}

// ===== 模型管理 =====

// ModelStatus 单个预设模型的导入状态
type ModelStatus struct {
	ModelPreset
	Installed bool   `json:"installed"`
	FilePath  string `json:"file_path,omitempty"` // 已导入时的本地路径（脱敏后的）
	FileSize  int64  `json:"file_size,omitempty"`
}

// ListModels 列出所有预设模型 + 是否已导入
func ListModels() []ModelStatus {
	out := make([]ModelStatus, 0, len(Presets))
	for _, p := range Presets {
		st := ModelStatus{ModelPreset: p}
		path := modelFilePath(p.ID)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			st.Installed = true
			st.FilePath = path
			st.FileSize = info.Size()
		}
		out = append(out, st)
	}
	return out
}

// ImportModel 把用户提供的 .onnx 复制到 models/ 目录，重命名为标准文件名
// 不做哈希校验（因为我们不分发，无法预知用户下到的文件 hash）
func ImportModel(presetID, srcPath string) (*ModelStatus, error) {
	preset := FindPreset(presetID)
	if preset == nil {
		return nil, fmt.Errorf("unknown preset: %s", presetID)
	}
	srcPath = strings.TrimSpace(srcPath)
	if srcPath == "" {
		return nil, errors.New("srcPath is empty")
	}
	stat, err := os.Stat(srcPath)
	if err != nil {
		return nil, fmt.Errorf("stat src: %w", err)
	}
	if stat.IsDir() {
		return nil, errors.New("srcPath is a directory")
	}
	// 简单校验：必须是 .onnx 文件 + 体积接近 ExpectedMB
	if !strings.HasSuffix(strings.ToLower(srcPath), ".onnx") {
		return nil, errors.New("file must be .onnx")
	}
	expectedBytes := int64(preset.ExpectedMB) * 1024 * 1024
	low := expectedBytes / 2  // 允许 50% 浮动（不同 ONNX 量化版本体积差距大）
	high := expectedBytes * 3 // 允许 3 倍浮动（fp32 vs fp16 vs int8）
	if stat.Size() < low || stat.Size() > high {
		return nil, fmt.Errorf("file size %d MB looks wrong (expected ~%d MB)",
			stat.Size()/1024/1024, preset.ExpectedMB)
	}

	// 卸载旧 session（如果之前已导入并加载过）
	unloadSession(presetID)

	// 复制到目标
	dst := modelFilePath(presetID)
	if err := copyFile(srcPath, dst); err != nil {
		return nil, fmt.Errorf("copy file: %w", err)
	}

	st := ListModels()
	for _, m := range st {
		if m.ID == presetID {
			return &m, nil
		}
	}
	return nil, errors.New("import succeeded but list returned nothing")
}

// DeleteModel 删除已导入的模型文件
func DeleteModel(presetID string) error {
	preset := FindPreset(presetID)
	if preset == nil {
		return fmt.Errorf("unknown preset: %s", presetID)
	}
	unloadSession(presetID)
	path := modelFilePath(presetID)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// RemoveBackground 主接口：用指定模型抠图
// imgBytes: jpeg / png 输入
// 返回：带 alpha 通道的 PNG bytes
func RemoveBackground(presetID string, imgBytes []byte) ([]byte, error) {
	if !ortInited {
		return nil, errors.New("rembg: ONNX Runtime 未初始化（缺少动态库），无法抠图")
	}
	preset := FindPreset(presetID)
	if preset == nil {
		return nil, fmt.Errorf("unknown preset: %s", presetID)
	}
	path := modelFilePath(presetID)
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("model not installed (please import first via 设置 → 模型管理): %s", presetID)
	}
	entry, err := loadSession(preset, path)
	if err != nil {
		return nil, err
	}
	return runInference(entry, imgBytes)
}

// ===== 内部工具 =====

func modelFilePath(presetID string) string {
	return filepath.Join(modelsRootDir, presetID+".onnx")
}

func unloadSession(presetID string) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	if e, ok := sessions[presetID]; ok {
		if e.session != nil {
			_ = e.session.Destroy()
		}
		if e.input != nil {
			_ = e.input.Destroy()
		}
		if e.output != nil {
			_ = e.output.Destroy()
		}
		delete(sessions, presetID)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmpDst := dst + ".tmp"
	out, err := os.Create(tmpDst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmpDst)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmpDst)
		return err
	}
	return os.Rename(tmpDst, dst)
}
