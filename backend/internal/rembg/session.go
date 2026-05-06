package rembg

import (
	"bytes"
	"fmt"
	"image"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// Session 缓存：每个模型一个 ONNX session（懒加载，进程退出时销毁）
type sessionEntry struct {
	preset  *ModelPreset
	session *ort.AdvancedSession
	input   *ort.Tensor[float32]
	output  *ort.Tensor[float32]
	mu      sync.Mutex // 单个 session 的推理是串行的（ORT session 本身线程不安全）
}

var (
	sessionsMu sync.Mutex
	sessions   = map[string]*sessionEntry{}
)

// loadSession 懒加载单个模型的 ONNX session
func loadSession(preset *ModelPreset, modelPath string) (*sessionEntry, error) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()

	if entry, ok := sessions[preset.ID]; ok {
		return entry, nil
	}

	size := preset.InputSize
	inputShape := ort.NewShape(1, 3, int64(size), int64(size))
	inputData := make([]float32, 1*3*size*size)
	inputTensor, err := ort.NewTensor(inputShape, inputData)
	if err != nil {
		return nil, fmt.Errorf("create input tensor: %w", err)
	}

	// U2Net 输出可能是 (1,1,size,size)；RMBG 也是 (1,1,size,size)
	outputShape := ort.NewShape(1, 1, int64(size), int64(size))
	outputTensor, err := ort.NewEmptyTensor[float32](outputShape)
	if err != nil {
		inputTensor.Destroy()
		return nil, fmt.Errorf("create output tensor: %w", err)
	}

	session, err := ort.NewAdvancedSession(
		modelPath,
		[]string{preset.InputName},
		[]string{preset.OutputName},
		[]ort.Value{inputTensor},
		[]ort.Value{outputTensor},
		nil,
	)
	if err != nil {
		inputTensor.Destroy()
		outputTensor.Destroy()
		return nil, fmt.Errorf("create session: %w", err)
	}

	entry := &sessionEntry{
		preset:  preset,
		session: session,
		input:   inputTensor,
		output:  outputTensor,
	}
	sessions[preset.ID] = entry
	return entry, nil
}

// runInference 跑一次推理：原图 → 输出 PNG bytes（带 alpha）
func runInference(entry *sessionEntry, imgBytes []byte) ([]byte, error) {
	srcImg, _, err := image.Decode(bytes.NewReader(imgBytes))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}

	preset := entry.preset
	inputData := preprocessImage(srcImg, preset.InputSize, preset.Normalize)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	// 把 inputData 拷贝到 session 持有的 tensor buffer
	tensorData := entry.input.GetData()
	if len(tensorData) != len(inputData) {
		return nil, fmt.Errorf("tensor size mismatch: %d vs %d", len(tensorData), len(inputData))
	}
	copy(tensorData, inputData)

	if err := entry.session.Run(); err != nil {
		return nil, fmt.Errorf("inference: %w", err)
	}

	maskData := entry.output.GetData()
	return applyMaskToImage(srcImg, maskData, preset.InputSize)
}

// destroyAllSessions 进程退出时清理（main.go defer 调用）
func destroyAllSessions() {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	for _, e := range sessions {
		if e.session != nil {
			_ = e.session.Destroy()
		}
		if e.input != nil {
			_ = e.input.Destroy()
		}
		if e.output != nil {
			_ = e.output.Destroy()
		}
	}
	sessions = map[string]*sessionEntry{}
}
