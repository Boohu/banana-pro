package rembg

import (
	"bytes"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	_ "image/png"

	"golang.org/x/image/draw"
)

// 归一化常量
var (
	u2netMean = [3]float32{0.485, 0.456, 0.406}
	u2netStd  = [3]float32{0.229, 0.224, 0.225}
)

// preprocessImage 把原图转成 NCHW float32 输入张量
// 返回值长度 = 1*3*size*size
func preprocessImage(img image.Image, size int, mode NormalizeMode) []float32 {
	resized := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(resized, resized.Rect, img, img.Bounds(), draw.Over, nil)

	out := make([]float32, 1*3*size*size)
	chSize := size * size
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			r, g, b, _ := resized.At(x, y).RGBA()
			rf := float32(r>>8) / 255.0
			gf := float32(g>>8) / 255.0
			bf := float32(b>>8) / 255.0

			switch mode {
			case NormalizeU2Net:
				rf = (rf - u2netMean[0]) / u2netStd[0]
				gf = (gf - u2netMean[1]) / u2netStd[1]
				bf = (bf - u2netMean[2]) / u2netStd[2]
			case NormalizeRMBG:
				fallthrough
			default:
				rf = (rf - 0.5) / 1.0
				gf = (gf - 0.5) / 1.0
				bf = (bf - 0.5) / 1.0
			}

			idx := y*size + x
			out[0*chSize+idx] = rf
			out[1*chSize+idx] = gf
			out[2*chSize+idx] = bf
		}
	}
	return out
}

// applyMaskToImage 用 mask 给原图加 alpha 通道，返回 RGBA PNG bytes
// maskData: 模型输出，长度 size*size，值在 [0,1]（U2Net 可能不在）
func applyMaskToImage(srcImg image.Image, maskData []float32, size int) ([]byte, error) {
	srcW, srcH := srcImg.Bounds().Dx(), srcImg.Bounds().Dy()

	// 1) maskData → Gray 图
	maskImg := image.NewGray(image.Rect(0, 0, size, size))
	// 找 min/max 用于归一化（U2Net 输出不一定在 [0,1]）
	var mn, mx float32 = 1, 0
	for _, v := range maskData {
		if v < mn {
			mn = v
		}
		if v > mx {
			mx = v
		}
	}
	rng := mx - mn
	if rng < 1e-6 {
		rng = 1
	}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			v := maskData[y*size+x]
			// 如果超出 [0,1]，做线性归一化（U2Net 场景）
			if mn < 0 || mx > 1.0001 {
				v = (v - mn) / rng
			}
			if v < 0 {
				v = 0
			}
			if v > 1 {
				v = 1
			}
			maskImg.SetGray(x, y, color.Gray{Y: uint8(v * 255)})
		}
	}

	// 2) mask 缩放到原图大小
	maskFull := image.NewGray(image.Rect(0, 0, srcW, srcH))
	draw.CatmullRom.Scale(maskFull, maskFull.Rect, maskImg, maskImg.Bounds(), draw.Over, nil)

	// 3) 应用 mask 作为 alpha 通道
	// 注意：必须用 NRGBA（非预乘）。RGBA 是预乘格式，PNG 编码时会反向除 alpha 把颜色拉爆
	// 同时要注意 srcImg.Bounds() 不一定从 (0,0) 起
	srcMin := srcImg.Bounds().Min
	out := image.NewNRGBA(image.Rect(0, 0, srcW, srcH))
	for y := 0; y < srcH; y++ {
		for x := 0; x < srcW; x++ {
			r, g, b, _ := srcImg.At(srcMin.X+x, srcMin.Y+y).RGBA()
			a := maskFull.GrayAt(x, y).Y
			out.SetNRGBA(x, y, color.NRGBA{
				R: uint8(r >> 8),
				G: uint8(g >> 8),
				B: uint8(b >> 8),
				A: a,
			})
		}
	}

	// 4) 编码 PNG
	var buf bytes.Buffer
	enc := &png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
