package rembg

// 预设抠图模型清单。我们不分发模型文件，只提供「引擎 + 元信息」，用户自己去 HuggingFace 下载后导入。
// 这样规避 RMBG-2.0 商用许可纠纷（许可责任在用户）。

// NormalizeMode 描述预处理的归一化方式
type NormalizeMode int

const (
	// NormalizeRMBG: x = (x/255 - 0.5) / 1.0  → [-0.5, 0.5]
	// 适用于 BRIA RMBG 系列
	NormalizeRMBG NormalizeMode = iota
	// NormalizeU2Net: x = x/255 - mean / std  其中 mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]
	// 适用于 U2Net / ISNet 默认权重
	NormalizeU2Net
)

// ModelPreset 预设模型元信息
type ModelPreset struct {
	ID         string        `json:"id"`          // 唯一 id，文件名也用这个：例 "rmbg-1.4" → models/rmbg-1.4.onnx
	Name       string        `json:"name"`        // 显示名
	Tagline    string        `json:"tagline"`     // 一句话描述
	License    string        `json:"license"`     // 许可证（用于 UI 提醒商用风险）
	HFLink     string        `json:"hf_link"`     // HuggingFace 模型页 URL
	InputSize  int           `json:"input_size"`  // 模型输入分辨率（边长）
	Normalize  NormalizeMode `json:"-"`           // 归一化方式（前端不需要）
	InputName  string        `json:"-"`           // ONNX 输入张量名（前端不需要）
	OutputName string        `json:"-"`           // ONNX 输出张量名（前端不需要）
	ExpectedMB int           `json:"expected_mb"` // 预期文件大小（MB）— 用于 UI 显示和导入时简单校验
}

// Presets 所有支持的抠图模型
var Presets = []ModelPreset{
	{
		ID:         "rmbg-1.4",
		Name:       "RMBG-1.4（轻量版）",
		Tagline:    "BRIA AI 出品，照片抠图主力，离线 CPU 可用",
		License:    "BRIA RAIL-M（个人 + 商用免费）",
		HFLink:     "https://huggingface.co/briaai/RMBG-1.4/tree/main/onnx",
		InputSize:  1024,
		Normalize:  NormalizeRMBG,
		InputName:  "input",
		OutputName: "output",
		ExpectedMB: 168,
	},
	{
		ID:         "rmbg-2.0",
		Name:       "RMBG-2.0（精细版）",
		Tagline:    "毛发 / 半透明 / 复杂边缘最佳，体积大",
		License:    "BRIA 商用许可（商用需联系 BRIA 付费）",
		HFLink:     "https://huggingface.co/briaai/RMBG-2.0",
		InputSize:  1024,
		Normalize:  NormalizeU2Net, // RMBG-2.0 用 ImageNet 归一化（mean/std），不是 RMBG-1.4 那种 (x/255-0.5)
		InputName:  "pixel_values", // RMBG-2.0 实际输入张量名
		OutputName: "alphas",       // RMBG-2.0 实际输出张量名
		ExpectedMB: 880,
	},
}

// FindPreset 按 id 查预设
func FindPreset(id string) *ModelPreset {
	for i := range Presets {
		if Presets[i].ID == id {
			return &Presets[i]
		}
	}
	return nil
}
