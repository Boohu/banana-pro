package provider

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image-gen-service/internal/diagnostic"
	"image-gen-service/internal/model"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type OpenAIProvider struct {
	config     *model.ProviderConfig
	httpClient *http.Client
	apiBase    string
	userAgent  string
}

func NewOpenAIProvider(config *model.ProviderConfig) (*OpenAIProvider, error) {
	if config == nil {
		return nil, fmt.Errorf("config 不能为空")
	}

	timeout := time.Duration(config.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 500 * time.Second
	}

	apiBase := NormalizeOpenAIBaseURL(config.APIBase)
	userAgent := "image-gen-service/1.0"

	return &OpenAIProvider{
		config:     config,
		httpClient: newOpenAIHTTPClient(timeout),
		apiBase:    apiBase,
		userAgent:  userAgent,
	}, nil
}

func newOpenAIHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DisableKeepAlives:   true,
			ForceAttemptHTTP2:   false,
			MaxIdleConns:        0,
			MaxIdleConnsPerHost: 0,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: false,
				MinVersion:         tls.VersionTLS12,
			},
		},
	}
}

func (p *OpenAIProvider) Name() string {
	return "openai"
}

func (p *OpenAIProvider) Generate(ctx context.Context, params map[string]interface{}) (*ProviderResult, error) {
	logParams := make(map[string]interface{})
	for k, v := range params {
		if k == "reference_images" {
			if list, ok := v.([]interface{}); ok {
				logParams[k] = fmt.Sprintf("[%d images]", len(list))
			} else {
				logParams[k] = v
			}
		} else {
			logParams[k] = v
		}
	}
	log.Printf("[OpenAI] Generate 被调用, Params: %+v\n", logParams)

	modelID := ResolveModelID(ModelResolveOptions{
		ProviderName: p.Name(),
		Purpose:      PurposeImage,
		Params:       params,
		Config:       p.config,
	}).ID
	if modelID == "" {
		return nil, fmt.Errorf("缺少 model_id 参数")
	}

	// gpt-image-* 走专用 images 端点（/v1/images/generations | /v1/images/edits）
	if isGPTImageModel(modelID) {
		log.Printf("[OpenAI] 路由到 images API: model=%s", modelID)
		return p.generateViaImagesAPI(ctx, params, modelID)
	}
	log.Printf("[OpenAI] 路由到 chat/completions: model=%s (未命中 gpt-image-*)", modelID)

	reqBody, refCount, promptPreview, err := p.buildChatRequestBody(modelID, params)
	if err != nil {
		return nil, err
	}

	diagnostic.Logf(params, "request_prepare",
		"provider=%s model=%s count=%v modalities=%v ref_image_count=%d prompt_hash=%s prompt_preview=%q",
		p.Name(),
		modelID,
		reqBody["n"],
		reqBody["modalities"],
		refCount,
		diagnostic.PromptHash(promptPreview),
		diagnostic.Preview(promptPreview, 160),
	)

	respBytes, headers, err := p.doChatRequest(ctx, reqBody, params)
	if err != nil {
		return nil, err
	}

	images, summary, err := p.extractImages(ctx, respBytes)
	if err != nil {
		return nil, err
	}

	requestID := extractRequestIDFromHeaders(headers)
	diagnostic.Logf(params, "response_summary",
		"provider=%s model=%s data_count=%d choice_count=%d image_count=%d text_preview=%q request_id=%s",
		p.Name(),
		modelID,
		summary.DataCount,
		summary.ChoiceCount,
		len(images),
		summary.TextPreview,
		requestID,
	)

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider":       "openai",
			"model":          modelID,
			"type":           "image",
			"request_id":     requestID,
			"oneapi_request": strings.TrimSpace(headers.Get("X-Oneapi-Request-Id")),
		},
	}, nil
}

func (p *OpenAIProvider) ValidateParams(params map[string]interface{}) error {
	if _, ok := params["messages"]; ok {
		return nil
	}
	prompt, _ := params["prompt"].(string)
	if prompt == "" {
		return fmt.Errorf("prompt 不能为空")
	}
	return nil
}

func (p *OpenAIProvider) buildChatRequestBody(modelID string, params map[string]interface{}) (map[string]interface{}, int, string, error) {
	rawMessages, hasMessages := params["messages"]
	reqBody := map[string]interface{}{
		"model": modelID,
	}

	promptPreview := ""
	refCount := 0

	if hasMessages {
		reqBody["messages"] = rawMessages
		promptPreview = "[custom messages]"
	} else {
		prompt, _ := params["prompt"].(string)
		if prompt == "" {
			return nil, 0, "", fmt.Errorf("缺少 prompt 参数")
		}

		prompt = appendPromptHints(prompt, params)
		promptPreview = prompt

		refParts, err := buildImageParts(params["reference_images"])
		if err != nil {
			return nil, 0, "", err
		}
		refCount = len(refParts)

		if len(refParts) == 0 {
			reqBody["messages"] = []map[string]interface{}{
				{
					"role":    "user",
					"content": prompt,
				},
			}
		} else {
			content := make([]map[string]interface{}, 0, len(refParts)+1)
			content = append(content, refParts...)
			content = append(content, map[string]interface{}{
				"type": "text",
				"text": prompt,
			})
			reqBody["messages"] = []map[string]interface{}{
				{
					"role":    "user",
					"content": content,
				},
			}
		}
	}

	if count, ok := toInt(params["count"]); ok && count > 1 {
		reqBody["n"] = count
	} else {
		reqBody["n"] = 1
	}
	if _, ok := reqBody["modalities"]; !ok {
		reqBody["modalities"] = []string{"text", "image"}
	}
	applyOpenAIOptions(reqBody, params)

	return reqBody, refCount, promptPreview, nil
}

func (p *OpenAIProvider) doChatRequest(ctx context.Context, body map[string]interface{}, params map[string]interface{}) ([]byte, http.Header, error) {
	payloadBytes, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化 OpenAI 请求失败: %w", err)
	}

	requestURL := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/chat/completions"
	diagnostic.Logf(params, "request_payload",
		"url=%s body=%q",
		diagnostic.RedactSensitive(requestURL),
		diagnostic.RedactSensitive(string(payloadBytes)),
	)
	maxRetries := providerMaxRetries(p.config)
	var elapsed time.Duration
	resp, _, err := doRequestWithRetry(ctx, params, p.Name(), maxRetries, func(attempt int) (*http.Response, error) {
		req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payloadBytes))
		if buildErr != nil {
			return nil, fmt.Errorf("构建 OpenAI 请求失败: %w", buildErr)
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.config.APIKey))
		req.Header.Set("Connection", "close")
		if strings.TrimSpace(p.userAgent) != "" {
			req.Header.Set("User-Agent", p.userAgent)
		}

		startedAt := time.Now()
		resp, doErr := p.httpClient.Do(req)
		elapsed = time.Since(startedAt)
		return resp, doErr
	})
	if err != nil {
		return nil, nil, fmt.Errorf("doRequest: error sending request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.Header.Clone(), fmt.Errorf("读取 OpenAI 响应失败: %w", err)
	}

	requestID := extractRequestIDFromHeaders(resp.Header)
	diagnostic.Logf(params, "response_headers",
		"status=%s elapsed=%s request_id=%s headers=%q",
		resp.Status,
		elapsed,
		requestID,
		diagnostic.Preview(strings.Join(headerLines(resp.Header), " | "), 1000),
	)
	diagnostic.Logf(params, "response_body",
		"status=%s elapsed=%s request_id=%s body=%q",
		resp.Status,
		elapsed,
		requestID,
		diagnostic.RedactSensitive(string(respBody)),
	)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview := diagnostic.Preview(parseOpenAIError(respBody), 1200)
		if requestID == "" {
			requestID = diagnostic.ExtractRequestID(string(respBody))
		}
		return nil, resp.Header.Clone(), fmt.Errorf("OpenAI HTTP %d request_id=%s body=%s", resp.StatusCode, requestID, bodyPreview)
	}

	if len(respBody) == 0 {
		return nil, resp.Header.Clone(), fmt.Errorf("接口未返回内容")
	}

	return respBody, resp.Header.Clone(), nil
}

type openAIResponseSummary struct {
	DataCount   int
	ChoiceCount int
	TextPreview string
}

func (p *OpenAIProvider) extractImages(ctx context.Context, respBytes []byte) ([][]byte, openAIResponseSummary, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(respBytes, &raw); err != nil {
		return nil, openAIResponseSummary{}, fmt.Errorf("解析响应失败: %w", err)
	}

	summary := openAIResponseSummary{}

	if data, ok := raw["data"].([]interface{}); ok && len(data) > 0 {
		summary.DataCount = len(data)
		images, err := p.extractImagesFromData(ctx, data)
		if err == nil && len(images) > 0 {
			return images, summary, nil
		}
	}

	choices, ok := raw["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil, summary, fmt.Errorf("响应中未找到 choices")
	}
	summary.ChoiceCount = len(choices)

	var images [][]byte
	var textSnippets []string
	for _, choice := range choices {
		choiceMap, ok := choice.(map[string]interface{})
		if !ok {
			continue
		}
		message, ok := choiceMap["message"].(map[string]interface{})
		if !ok {
			continue
		}
		content := message["content"]
		imgs, texts := p.extractImagesFromContent(ctx, content)
		images = append(images, imgs...)
		textSnippets = append(textSnippets, texts...)
	}
	summary.TextPreview = diagnostic.Preview(strings.TrimSpace(strings.Join(textSnippets, " | ")), 240)

	if len(images) == 0 {
		extra := strings.TrimSpace(strings.Join(textSnippets, " | "))
		if extra != "" {
			return nil, summary, fmt.Errorf("未在响应中找到图片数据: %s", extra)
		}
		return nil, summary, fmt.Errorf("未在响应中找到图片数据")
	}

	return images, summary, nil
}

func (p *OpenAIProvider) extractImagesFromData(ctx context.Context, data []interface{}) ([][]byte, error) {
	var images [][]byte
	for _, item := range data {
		obj, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if b64, ok := obj["b64_json"].(string); ok && b64 != "" {
			imgBytes, err := base64.StdEncoding.DecodeString(b64)
			if err != nil {
				log.Printf("[OpenAI] base64解码失败，跳过此图: err=%v", err)
				continue
			}
			images = append(images, imgBytes)
			continue
		}
		if url, ok := obj["url"].(string); ok && url != "" {
			imgBytes, err := p.fetchImage(ctx, url)
			if err != nil {
				log.Printf("[OpenAI] 下载图片失败，跳过此图: url=%s, err=%v", url, err)
				continue
			}
			images = append(images, imgBytes)
		}
	}
	return images, nil
}

func (p *OpenAIProvider) extractImagesFromContent(ctx context.Context, content interface{}) ([][]byte, []string) {
	var images [][]byte
	var texts []string

	switch v := content.(type) {
	case string:
		texts = append(texts, v)
		images = append(images, extractImagesFromText(v)...)
	case []interface{}:
		for _, part := range v {
			partMap, ok := part.(map[string]interface{})
			if !ok {
				continue
			}
			if partType, _ := partMap["type"].(string); partType == "text" {
				if text, _ := partMap["text"].(string); text != "" {
					texts = append(texts, text)
				}
			}
			if partType, _ := partMap["type"].(string); partType == "image_url" {
				if imgMap, ok := partMap["image_url"].(map[string]interface{}); ok {
					if url, _ := imgMap["url"].(string); url != "" {
						imgBytes, err := p.decodeImageURL(ctx, url)
						if err != nil {
							log.Printf("[OpenAI] choices路径下载图片失败，跳过此图: url=%s, err=%v", url, err)
							continue
						}
						images = append(images, imgBytes)
					}
				}
			}
		}
	case map[string]interface{}:
		if partType, _ := v["type"].(string); partType == "image_url" {
			if imgMap, ok := v["image_url"].(map[string]interface{}); ok {
				if url, _ := imgMap["url"].(string); url != "" {
					imgBytes, err := p.decodeImageURL(ctx, url)
					if err != nil {
						log.Printf("[OpenAI] choices路径下载图片失败: url=%s, err=%v", url, err)
					} else {
						images = append(images, imgBytes)
					}
				}
			}
		}
		if partType, _ := v["type"].(string); partType == "text" {
			if text, _ := v["text"].(string); text != "" {
				texts = append(texts, text)
			}
		}
	}

	return images, texts
}

func (p *OpenAIProvider) decodeImageURL(ctx context.Context, url string) ([]byte, error) {
	if strings.HasPrefix(url, "data:image/") {
		return decodeDataURL(url)
	}
	return p.fetchImage(ctx, url)
}

func (p *OpenAIProvider) fetchImage(ctx context.Context, url string) ([]byte, error) {
	const maxRetries = 3
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := p.httpClient.Do(req)
		if err != nil {
			lastErr = err
			log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, err=%v", attempt, url, err)
			if attempt < maxRetries {
				time.Sleep(time.Second)
			}
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("下载图片失败: %s", resp.Status)
			log.Printf("[OpenAI] fetchImage 第%d次尝试失败, url=%s, status=%s", attempt, url, resp.Status)
			if attempt < maxRetries {
				time.Sleep(time.Second)
			}
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("下载图片失败: %s", resp.Status)
		}
		return io.ReadAll(resp.Body)
	}
	return nil, fmt.Errorf("下载图片失败（重试%d次）: %w", maxRetries, lastErr)
}

func buildImageParts(raw interface{}) ([]map[string]interface{}, error) {
	refImgs, ok := raw.([]interface{})
	if !ok || len(refImgs) == 0 {
		return nil, nil
	}

	var parts []map[string]interface{}
	for idx, ref := range refImgs {
		var imgBytes []byte
		switch v := ref.(type) {
		case string:
			base64Data := v
			if strings.Contains(base64Data, ",") {
				partsSplit := strings.Split(base64Data, ",")
				base64Data = partsSplit[len(partsSplit)-1]
			}
			decoded, err := base64.StdEncoding.DecodeString(base64Data)
			if err != nil {
				return nil, fmt.Errorf("解码第 %d 张参考图失败: %w", idx, err)
			}
			imgBytes = decoded
		case []byte:
			imgBytes = v
		default:
			continue
		}

		mimeType := http.DetectContentType(imgBytes)
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = "image/png"
		}
		dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(imgBytes))
		parts = append(parts, map[string]interface{}{
			"type": "image_url",
			"image_url": map[string]interface{}{
				"url": dataURL,
			},
		})
	}
	return parts, nil
}

func appendPromptHints(prompt string, params map[string]interface{}) string {
	ar, _ := params["aspect_ratio"].(string)
	if ar == "" {
		ar, _ = params["aspectRatio"].(string)
	}
	size, _ := params["resolution_level"].(string)
	if size == "" {
		size, _ = params["imageSize"].(string)
	}
	if size == "" {
		size, _ = params["image_size"].(string)
	}

	if ar == "" && size == "" {
		return prompt
	}

	var hintParts []string
	if ar != "" {
		hintParts = append(hintParts, "画面比例: "+ar)
	}
	if size != "" {
		hintParts = append(hintParts, "分辨率: "+strings.ToUpper(strings.TrimSpace(size)))
	}

	return fmt.Sprintf("%s\n\n%s", prompt, strings.Join(hintParts, "，"))
}

func applyOpenAIOptions(body map[string]interface{}, params map[string]interface{}) {
	keys := []string{
		"temperature",
		"top_p",
		"max_tokens",
		"presence_penalty",
		"frequency_penalty",
		"response_format",
		"modalities",
		"stream",
		"stop",
		"user",
		"tools",
		"tool_choice",
	}
	for _, key := range keys {
		if val, ok := params[key]; ok {
			body[key] = val
		}
	}
}

func NormalizeOpenAIBaseURL(apiBase string) string {
	base := strings.TrimSpace(apiBase)
	if base == "" {
		return "https://api.openai.com/v1"
	}

	base = strings.TrimRight(base, "/")
	if strings.Contains(base, "/chat/completions") {
		base = strings.Split(base, "/chat/completions")[0]
		base = strings.TrimRight(base, "/")
	}
	if strings.Contains(base, "/v1/") {
		base = strings.Split(base, "/v1/")[0] + "/v1"
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base
	}
	return base + "/v1"
}

func parseOpenAIError(resp []byte) string {
	var payload map[string]interface{}
	if err := json.Unmarshal(resp, &payload); err != nil {
		return string(resp)
	}
	if errObj, ok := payload["error"].(map[string]interface{}); ok {
		if msg, ok := errObj["message"].(string); ok && msg != "" {
			return msg
		}
	}
	if msg, ok := payload["message"].(string); ok && msg != "" {
		return msg
	}
	return string(resp)
}

func decodeDataURL(dataURL string) ([]byte, error) {
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("无效的 data URL")
	}
	return base64.StdEncoding.DecodeString(parts[1])
}

func extractImagesFromText(text string) [][]byte {
	re := regexp.MustCompile(`data:image/[^;]+;base64,[A-Za-z0-9+/=]+`)
	matches := re.FindAllString(text, -1)
	var images [][]byte
	for _, match := range matches {
		img, err := decodeDataURL(match)
		if err == nil {
			images = append(images, img)
		}
	}
	return images
}

func toInt(v interface{}) (int, bool) {
	switch value := v.(type) {
	case int:
		return value, true
	case int32:
		return int(value), true
	case int64:
		return int(value), true
	case float64:
		return int(value), true
	case float32:
		return int(value), true
	default:
		return 0, false
	}
}

// ============ gpt-image-* 专用分支（images/generations + images/edits）============

// isGPTImageModel 判断模型是否走 images 端点
func isGPTImageModel(modelID string) bool {
	m := strings.ToLower(strings.TrimSpace(modelID))
	return strings.HasPrefix(m, "gpt-image-")
}

// generateViaImagesAPI 分流入口：根据是否有参考图选择 /images/generations 或 /images/edits
func (p *OpenAIProvider) generateViaImagesAPI(ctx context.Context, params map[string]interface{}, modelID string) (*ProviderResult, error) {
	prompt, _ := params["prompt"].(string)
	if prompt == "" {
		return nil, fmt.Errorf("prompt 不能为空")
	}
	log.Printf("[OpenAI-Images] 准备发送请求: model=%s prompt_len=%d api_base=%s", modelID, len(prompt), p.apiBase)

	count := 1
	if n, ok := toInt(params["count"]); ok && n > 0 {
		count = n
	}

	refs, err := extractRefImageBytes(params["reference_images"])
	if err != nil {
		return nil, err
	}
	hasRef := len(refs) > 0

	size := resolveGPTImageSize(params, hasRef)
	quality := firstString(params, "quality", "imageQuality")
	format := firstString(params, "format", "imageFormat", "output_format")
	log.Printf("[OpenAI-Images] 参数解析: aspectRatio=%v imageSize=%v hasRef=%v → 发送 size=%q quality=%q format=%q",
		params["aspectRatio"], params["imageSize"], hasRef, size, quality, format)

	diagnostic.Logf(params, "request_prepare",
		"provider=%s model=%s endpoint=%s count=%d size=%s quality=%s format=%s ref_count=%d prompt_hash=%s prompt_preview=%q",
		p.Name(),
		modelID,
		map[bool]string{true: "/v1/images/edits", false: "/v1/images/generations"}[hasRef],
		count,
		size,
		quality,
		format,
		len(refs),
		diagnostic.PromptHash(prompt),
		diagnostic.Preview(prompt, 160),
	)

	var respBytes []byte
	var headers http.Header
	if hasRef {
		respBytes, headers, err = p.doImagesEdits(ctx, params, modelID, prompt, refs, count, size, quality)
	} else {
		respBytes, headers, err = p.doImagesGenerations(ctx, params, modelID, prompt, count, size, quality, format)
	}
	if err != nil {
		return nil, err
	}

	images, summary, err := p.extractImages(ctx, respBytes)
	if err != nil {
		return nil, err
	}

	requestID := extractRequestIDFromHeaders(headers)
	diagnostic.Logf(params, "response_summary",
		"provider=%s model=%s data_count=%d choice_count=%d image_count=%d text_preview=%q request_id=%s",
		p.Name(),
		modelID,
		summary.DataCount,
		summary.ChoiceCount,
		len(images),
		summary.TextPreview,
		requestID,
	)

	return &ProviderResult{
		Images: images,
		Metadata: map[string]interface{}{
			"provider":   "openai",
			"model":      modelID,
			"type":       "image",
			"endpoint":   map[bool]string{true: "images/edits", false: "images/generations"}[hasRef],
			"request_id": requestID,
			"oneapi_request": strings.TrimSpace(headers.Get("X-Oneapi-Request-Id")),
		},
	}, nil
}

// doImagesGenerations 文生图：POST /v1/images/generations （JSON body）
func (p *OpenAIProvider) doImagesGenerations(ctx context.Context, params map[string]interface{}, modelID, prompt string, count int, size, quality, format string) ([]byte, http.Header, error) {
	body := map[string]interface{}{
		"model":  modelID,
		"prompt": prompt,
		"n":      count,
	}
	if size != "" {
		body["size"] = size
	}
	if quality != "" {
		body["quality"] = quality
	}
	if format != "" {
		body["format"] = format
	}

	payloadBytes, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("序列化 images/generations 请求失败: %w", err)
	}

	url := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/images/generations"
	return p.doImagesRequest(ctx, params, url, "application/json", payloadBytes)
}

// doImagesEdits 图生图：POST /v1/images/edits （multipart/form-data，多张图都用 name=image）
func (p *OpenAIProvider) doImagesEdits(ctx context.Context, params map[string]interface{}, modelID, prompt string, refs [][]byte, count int, size, quality string) ([]byte, http.Header, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	for i, ref := range refs {
		mimeType := http.DetectContentType(ref)
		ext := ".png"
		if strings.Contains(mimeType, "jpeg") {
			ext = ".jpg"
		} else if strings.Contains(mimeType, "webp") {
			ext = ".webp"
		}
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="ref%d%s"`, i+1, ext))
		h.Set("Content-Type", mimeType)
		part, err := mw.CreatePart(h)
		if err != nil {
			return nil, nil, fmt.Errorf("创建 multipart 文件失败: %w", err)
		}
		if _, err := part.Write(ref); err != nil {
			return nil, nil, fmt.Errorf("写入 multipart 文件失败: %w", err)
		}
	}
	_ = mw.WriteField("prompt", prompt)
	_ = mw.WriteField("model", modelID)
	_ = mw.WriteField("n", strconv.Itoa(count))
	if size != "" {
		_ = mw.WriteField("size", size)
	}
	if quality != "" {
		_ = mw.WriteField("quality", quality)
	}
	if err := mw.Close(); err != nil {
		return nil, nil, fmt.Errorf("关闭 multipart 失败: %w", err)
	}

	url := strings.TrimRight(strings.TrimSpace(p.apiBase), "/") + "/images/edits"
	return p.doImagesRequest(ctx, params, url, mw.FormDataContentType(), buf.Bytes())
}

// doImagesRequest images 端点通用发送
// 关键：不做任何重试（即使连接层错误也不重试），避免云雾已收到请求但回程连接断开时重复扣费
func (p *OpenAIProvider) doImagesRequest(ctx context.Context, params map[string]interface{}, url, contentType string, payload []byte) ([]byte, http.Header, error) {
	log.Printf("[OpenAI-Images] POST %s content_type=%s payload=%d bytes (no retry)", url, contentType, len(payload))
	diagnostic.Logf(params, "request_payload",
		"url=%s content_type=%s payload_size=%d",
		diagnostic.RedactSensitive(url),
		contentType,
		len(payload),
	)

	req, buildErr := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if buildErr != nil {
		return nil, nil, fmt.Errorf("构建 images 请求失败: %w", buildErr)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.config.APIKey))
	req.Header.Set("Connection", "close")
	if strings.TrimSpace(p.userAgent) != "" {
		req.Header.Set("User-Agent", p.userAgent)
	}

	startedAt := time.Now()
	resp, err := p.httpClient.Do(req)
	elapsed := time.Since(startedAt)
	if err != nil {
		return nil, nil, fmt.Errorf("doRequest: error sending request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.Header.Clone(), fmt.Errorf("读取 images 响应失败: %w", err)
	}

	requestID := extractRequestIDFromHeaders(resp.Header)
	diagnostic.Logf(params, "response_headers",
		"status=%s elapsed=%s request_id=%s headers=%q",
		resp.Status, elapsed, requestID,
		diagnostic.Preview(strings.Join(headerLines(resp.Header), " | "), 1000),
	)
	diagnostic.Logf(params, "response_body",
		"status=%s elapsed=%s request_id=%s body=%q",
		resp.Status, elapsed, requestID,
		diagnostic.RedactSensitive(string(respBody)),
	)

	log.Printf("[OpenAI-Images] 响应: status=%s elapsed=%s size=%d request_id=%s", resp.Status, elapsed, len(respBody), requestID)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview := diagnostic.Preview(parseOpenAIError(respBody), 1200)
		if requestID == "" {
			requestID = diagnostic.ExtractRequestID(string(respBody))
		}
		return nil, resp.Header.Clone(), fmt.Errorf("Images HTTP %d request_id=%s body=%s", resp.StatusCode, requestID, bodyPreview)
	}
	if len(respBody) == 0 {
		return nil, resp.Header.Clone(), fmt.Errorf("接口未返回内容")
	}
	return respBody, resp.Header.Clone(), nil
}

// resolveGPTImageSize 把前端的 aspectRatio + imageSize 转成 gpt-image-2 的 size 字符串
// isEdit=true 时只保留 images/edits 支持的 4 档（1:1 / 3:2 / 2:3 / auto）
func resolveGPTImageSize(params map[string]interface{}, isEdit bool) string {
	if explicit, _ := params["size"].(string); explicit != "" {
		return explicit
	}
	ar := firstString(params, "aspectRatio", "aspect_ratio")
	sizeLvl := strings.ToLower(firstString(params, "imageSize", "resolution_level", "image_size"))

	if sizeLvl == "auto" || ar == "auto" {
		return "auto"
	}

	// images/edits 只支持 1K 三档 + auto
	if isEdit {
		switch ar {
		case "3:2", "16:9":
			return "1536x1024"
		case "2:3", "9:16":
			return "1024x1536"
		case "1:1":
			return "1024x1024"
		default:
			return "auto"
		}
	}

	// images/generations 支持 1K / 2K / 4K 三档
	switch sizeLvl {
	case "4k":
		switch ar {
		case "3:2", "16:9":
			return "3840x2160"
		case "2:3", "9:16":
			return "2160x3840"
		case "1:1":
			return "2048x2048" // 没有 4K 方图，回落到 2K
		default:
			return "3840x2160"
		}
	case "2k":
		switch ar {
		case "3:2", "16:9":
			return "2048x1152"
		case "2:3", "9:16":
			return "1024x1536" // 没有 2K 竖图，回落到 1K
		case "1:1":
			return "2048x2048"
		default:
			return "2048x2048"
		}
	default: // 1K or 空
		switch ar {
		case "3:2", "16:9":
			return "1536x1024"
		case "2:3", "9:16":
			return "1024x1536"
		case "1:1":
			return "1024x1024"
		default:
			return "1024x1024"
		}
	}
}

// extractRefImageBytes 把 params["reference_images"] 解码成 []byte 数组
func extractRefImageBytes(raw interface{}) ([][]byte, error) {
	refImgs, ok := raw.([]interface{})
	if !ok || len(refImgs) == 0 {
		return nil, nil
	}
	var out [][]byte
	for idx, ref := range refImgs {
		switch v := ref.(type) {
		case string:
			data := v
			if strings.Contains(data, ",") {
				parts := strings.Split(data, ",")
				data = parts[len(parts)-1]
			}
			decoded, err := base64.StdEncoding.DecodeString(data)
			if err != nil {
				return nil, fmt.Errorf("解码第 %d 张参考图失败: %w", idx, err)
			}
			out = append(out, decoded)
		case []byte:
			out = append(out, v)
		}
	}
	return out, nil
}

func firstString(params map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if s, _ := params[k].(string); strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}
