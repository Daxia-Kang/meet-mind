# 需求文档：MeetMind 课堂助手 MVP

## 介绍

MeetMind 是一款面向 K12 学生的"课堂对齐"学习辅助工具。核心理念是：**让学生在课上标记没听懂的地方，课后通过 AI 家教基于老师原话进行补习**。

### 设计原则

**复用优先，降低设计熵**：

```
设计熵 = 自研代码量 × 维护复杂度 × 技术债务风险
目标：将设计熵降到最低，仅自研业务编排层
```

1. **不造轮子** - 优先复用现有三个开源项目（Discussion、LongCut、Open Notebook）的成熟能力
2. **不造模型** - 使用通义千问等成熟商业模型，通过 Prompt 工程实现教学能力
3. **不造组件** - 复用 GitHub 高 star 开源组件（wavesurfer.js、Dexie.js、nivo 等）
4. **接口标准化** - 遵循 OpenAI 兼容 API 格式，方便模型切换
5. **单一职责** - 每个模块只做一件事，复用开源组件的单一能力
6. **依赖倒置** - 业务层依赖抽象接口，具体实现由开源组件提供

### 能力复用矩阵

| 能力域 | 复用来源 | 复用方式 | 自研比例 |
|--------|----------|----------|----------|
| 语音转录 | Discussion (通义听悟) | HTTP/WebSocket 代理 | 0% |
| LLM 调用 | Discussion (通义千问) | OpenAI 兼容 API | 0% |
| 引用匹配 | LongCut (quote-matcher.ts) | 直接复制 | 0% |
| 句子合并 | LongCut (transcript-sentence-merger.ts) | 直接复制 | 0% |
| 时间戳工具 | LongCut (timestamp-utils.ts) | 直接复制 | 0% |
| 主题提取 | LongCut (topic-utils.ts) | 直接复制 | 0% |
| 向量搜索 | Open Notebook (/search API) | HTTP API 调用 | 0% |
| 音频波形 | wavesurfer.js (10k stars) | npm 依赖 | 0% |
| 本地存储 | Dexie.js (13.9k stars) | npm 依赖 | 0% |
| 热力图 | @nivo/heatmap (13.9k stars) | npm 依赖 | 0% |
| AI 聊天 UI | Vercel AI SDK (20.6k stars) | npm 依赖 | 0% |
| 语音降级 | Web Speech API (浏览器原生) | 直接调用 | 0% |

---

## 需求

### 需求 1 - 课堂录音与回放

**用户故事：** 作为学生，我希望能录制完整的课堂音频，并在课后随时回放，这样我就能重听老师讲解的内容。

**复用能力：**
- 音频存储：Dexie.js (IndexedDB 封装)
- 音频播放：wavesurfer.js (波形可视化 + 播放器)
- 音频转码：Discussion 后端 ffmpeg (WebM → PCM)

#### 验收标准

1. When 用户点击"开始录音"按钮，the MeetMind shall 使用 MediaRecorder API 在 2 秒内启动麦克风采集，并使用 Web Audio API AnalyserNode 显示实时音量波形。

2. While 录音进行中，when 用户点击"暂停"按钮，the MeetMind shall 暂停 MediaRecorder 但保留已录制的 Blob 数据，用户可点击"继续"恢复录音。

3. When 用户点击"结束录音"按钮，the MeetMind shall 使用 Dexie.js 将音频 Blob 保存到 IndexedDB，同时自动切换到复习模式。

4. While 用户在复习模式，when wavesurfer.js 初始化完成，the MeetMind shall 渲染完整音频波形，点击波形任意位置可跳转播放。

5. While 音频正在播放，when 用户点击转录文本中的任意段落，the MeetMind shall 调用 wavesurfer.seekTo() 跳转到该段落对应的时间点。

---

### 需求 2 - 实时语音转录

**用户故事：** 作为学生，我希望录音时能看到实时转录的文字，这样我就能确认录音正在工作，并且课后可以通过文字快速定位内容。

**复用能力：**
- 主方案：Discussion 后端 → 通义听悟 WebSocket 实时转写
- 降级方案：Web Speech API (浏览器原生)
- 句子合并：LongCut transcript-sentence-merger.ts

#### 验收标准

1. While 录音进行中且 Discussion 后端可用，when 系统建立 WebSocket 连接成功，the MeetMind shall 将 MediaRecorder 输出的 WebM 数据实时发送到 Discussion 后端，后端转换为 PCM 后转发给通义听悟。

2. When 通义听悟返回 SentenceEnd 事件，the MeetMind shall 在 3 秒内显示最终转录结果（正常样式），中间结果 TranscriptionResultChanged 用灰色斜体显示。

3. While Discussion 后端不可用（health check 失败），when 用户开始录音，the MeetMind shall 自动降级使用 Web Speech API，并在界面显示"本地识别模式（精度较低）"提示。

4. When 录音结束，the MeetMind shall 调用 LongCut 的 mergeTranscriptSegmentsIntoSentences() 函数，将短句合并为完整段落，并根据时间间隔自动划分主题分块。

---

### 需求 3 - 困惑点一键标记

**用户故事：** 作为学生，我希望在课堂上遇到不懂的地方时，能一键标记，这样课后就能精准定位到我的困惑点。

**复用能力：**
- 状态管理：Dexie.js (持久化存储)
- 时间戳格式化：LongCut timestamp-utils.ts

#### 验收标准

1. While 录音进行中，when 用户点击"🎯 我没听懂这里"按钮，the MeetMind shall 使用 LongCut formatTimestamp() 记录当前时间戳，并在按钮下方显示"5秒内可撤销"提示。

2. While "5秒内可撤销"提示显示中，when 用户再次点击按钮，the MeetMind shall 撤销刚才标记的困惑点，并恢复按钮为正常状态。

3. When 困惑点标记成功（超过5秒），the MeetMind shall 使用 Dexie.js 将困惑点持久化到 IndexedDB，并在录音界面下方的列表中显示。

4. While 用户在复习模式查看时间轴，when wavesurfer.js 渲染完成，the MeetMind shall 使用 wavesurfer.addRegion() 在波形上用红色标记所有困惑点位置。

5. While 困惑点被选中，when 用户点击"标记为已懂"按钮，the MeetMind shall 更新 Dexie.js 中的状态，波形标记从红色变为绿色。

---

### 需求 4 - AI 家教问答（证据链）

**用户故事：** 作为学生，我希望选中困惑点后，AI 能基于老师的原话给我解释，而不是泛泛而谈，这样我就能真正理解老师当时讲的内容。

**复用能力：**
- LLM 调用：Discussion LLM 适配器 → 通义千问 API
- 引用匹配：LongCut quote-matcher.ts (精确定位老师原话)
- 上下文提取：LongCut transcript-sentence-merger.ts

#### 验收标准

1. When 用户选中一个困惑点，the MeetMind shall 提取困惑点前 60 秒、后 30 秒的转录内容，调用 LongCut 的 buildTranscriptIndex() 构建索引。

2. When AI 解释生成完成，the MeetMind shall 调用 LongCut 的 findTextInTranscript() 匹配老师原话，展示以下结构化内容：
   - "老师是这样讲的"：引用老师原话，格式为 [引用 mm:ss-mm:ss] "原话内容"
   - "你可能卡在这里"：列出 2-3 个可能的卡点
   - "让我问你一个问题"：一个追问，帮助定位具体卡点
   - "今晚行动清单"：≤3 个可执行任务，总计约 20 分钟

3. While AI 解释显示中，when 用户点击引用的时间戳，the MeetMind shall 调用 wavesurfer.seekTo() 跳转到对应时间点并开始播放。

4. While AI 解释显示中，when 用户在输入框输入追问并发送，the MeetMind shall 携带历史对话上下文调用通义千问 API，在 10 秒内返回回答。

5. When 用户点击快捷回复按钮（如"我不理解这个公式"），the MeetMind shall 自动填充到输入框并发送。

---

### 需求 5 - 模型选择与切换

**用户故事：** 作为用户，我希望能选择不同的 AI 模型，这样我可以根据需要选择更快或更智能的模型。

**复用能力：**
- 模型抽象：Discussion LLM 适配器 (OpenAI 兼容格式)
- 多模型支持：Open Notebook Esperanto 库 (16+ 提供商)

#### 验收标准

1. When AI 家教界面加载完成，the MeetMind shall 在右上角显示模型选择器，默认选中"通义千问 qwen3-max"。

2. When 用户展开模型选择器，the MeetMind shall 显示按提供商分组的模型列表：
   - 通义千问（推荐）：qwen3-max、qwen-max、qwen-plus、qwen-turbo
   - Google Gemini：gemini-2.0-flash、gemini-1.5-pro
   - OpenAI：gpt-4o、gpt-4o-mini
   - DeepSeek：deepseek-chat（可选）

3. When 用户切换模型，the MeetMind shall 使用新模型重新生成当前困惑点的解释，并在解释下方显示"模型: xxx | Token: xxx"。

---

### 需求 6 - 知识库语义搜索

**用户故事：** 作为学生，我希望能搜索课堂内容中的相关知识点，这样我可以找到老师讲过的类似内容进行对比学习。

**复用能力：**
- 向量搜索：Open Notebook /search API
- 嵌入模型：Open Notebook 默认嵌入模型
- 降级方案：LongCut quote-matcher.ts (本地关键词匹配)

#### 验收标准

1. While Open Notebook 服务可用（:5055 健康检查通过），when AI 家教界面加载完成，the MeetMind shall 显示"知识库搜索"功能区。

2. When 用户输入搜索词并点击搜索，the MeetMind shall 调用 Open Notebook /search API，在 3 秒内返回最相关的 5 条结果。

3. When 搜索结果返回，the MeetMind shall 展示每条结果的：内容摘要、来源、相似度百分比、时间戳（如有）。

4. While Open Notebook 服务不可用，when 用户尝试搜索，the MeetMind shall 调用 LongCut 的 findTextInTranscript() 进行本地关键词匹配。

---

### 需求 7 - 家长端日报

**用户故事：** 作为家长，我希望能看到孩子今天的学习情况和困惑点，这样我就知道晚上该怎么帮助孩子复习。

**复用能力：**
- LLM 生成：Discussion 通义千问 API
- 数据存储：Dexie.js (跨端共享 IndexedDB)

#### 验收标准

1. When 家长访问 /parent 页面，the MeetMind shall 从 Dexie.js 读取今日学习数据，显示概览卡片：今日课程数、总困惑点数、已解决数、完成率。

2. When 页面加载完成，the MeetMind shall 按课程分组展示所有困惑点，每个困惑点显示：时间、学科、老师原话摘要（使用 LongCut 句子合并）、解决状态。

3. When 家长点击"生成陪学脚本"按钮，the MeetMind shall 调用通义千问 API 生成一份 20 分钟的陪学指南。

4. When 陪学脚本生成完成，the MeetMind shall 展示脚本内容，并提供"复制"和"分享"按钮。

---

### 需求 8 - 教师端困惑热区

**用户故事：** 作为教师，我希望能看到班级学生的困惑分布，这样我就知道哪些知识点需要重点讲解。

**复用能力：**
- 热力图：@nivo/heatmap (专业热力图组件，13.9k stars)
- 数据聚合：LongCut topic-utils.ts (主题提取与水合)
- LLM 分析：Discussion 通义千问 API

#### 验收标准

1. When 教师访问 /teacher 页面，the MeetMind shall 使用 @nivo/heatmap 渲染班级困惑热力图，横轴为课堂时间，纵轴为困惑密度。

2. When 热力图渲染完成，the MeetMind shall 使用 LongCut 的 hydrateTopicsWithTranscript() 提取"高频困惑点 TOP 5"，每项包含：时间段、困惑人数、知识点摘要。

3. When 教师点击热力图上的某个区域，the MeetMind shall 展开该时段的详细信息：转录内容、困惑学生列表、AI 分析的可能原因。

4. When 教师点击"生成教学建议"按钮，the MeetMind shall 调用通义千问 API 生成教学改进建议。

---

### 需求 9 - 数据持久化

**用户故事：** 作为用户，我希望我的录音、转录和困惑点数据能够保存，这样刷新页面或下次访问时数据不会丢失。

**复用能力：**
- 数据库封装：Dexie.js (IndexedDB 简化 API)
- 数据结构：参考 LongCut types.ts

#### 验收标准

1. When 录音结束，the MeetMind shall 使用 Dexie.js 将音频 Blob 保存到 IndexedDB 的 audioSessions 表，生成唯一的会话 ID。

2. When 困惑点被标记/解决，the MeetMind shall 立即使用 Dexie.js 将状态同步到 anchors 表。

3. When 用户访问首页，the MeetMind shall 查询 Dexie.js 检查是否有未完成的会话，如有则提示"继续上次的课程"或"开始新课程"。

4. When 用户选择"开始新课程"，the MeetMind shall 将上一个会话的 status 更新为 'archived'，并创建新的空白会话。

---

### 需求 10 - 服务状态与降级

**用户故事：** 作为用户，我希望在外部服务不可用时，系统仍能正常使用核心功能，并告诉我当前的服务状态。

**复用能力：**
- 健康检查：标准 HTTP /health 端点
- 降级策略：参考 LongCut ai-providers/registry.ts 的 fallback 机制

#### 验收标准

1. When 页面加载完成，the MeetMind shall 并行检查 Discussion(:4000/health) 和 Open Notebook(:5055/health)，在顶部导航栏显示状态指示器。

2. While Discussion 服务不可用，when 用户开始录音，the MeetMind shall 显示"本地录音模式"提示，使用 Web Speech API 进行语音识别。

3. While Open Notebook 服务不可用，when 用户尝试知识库搜索，the MeetMind shall 隐藏知识库搜索功能区，或显示"服务暂不可用"提示。

4. While 任何外部服务恢复，when 系统检测到连接成功（每 30 秒轮询），the MeetMind shall 自动切换到完整功能模式，并更新状态指示器。

---

## 非功能需求

### 性能要求

| 指标 | 目标值 | 实现方式 |
|------|--------|----------|
| 首屏加载时间 | < 3 秒 | Next.js 静态优化 |
| 录音启动延迟 | < 2 秒 | MediaRecorder 预热 |
| 转录显示延迟 | < 3 秒 | 通义听悟实时流 |
| AI 解释生成时间 | < 10 秒 | 通义千问流式输出 |
| 音频跳转响应 | < 500ms | wavesurfer.js 原生 |

### 兼容性要求

| 平台 | 要求 | 降级方案 |
|------|------|----------|
| 浏览器 | Chrome 90+、Edge 90+、Safari 14+ | 功能检测提示升级 |
| 麦克风 | 需要用户授权 | 无麦克风时禁用录音 |
| IndexedDB | 必须支持 | 不支持时提示 |

### 数据安全

| 要求 | 说明 | 实现方式 |
|------|------|----------|
| API Key 保护 | 敏感配置仅在服务端使用 | Next.js API Routes |
| 本地存储 | 音频和转录数据存储在用户设备 | Dexie.js + IndexedDB |
| 隐私提示 | 首次使用时告知用户数据存储方式 | 弹窗确认 |

---

## 附录：开源项目复用清单

### 必须复用（核心能力）

| 项目 | 能力 | 文件/API | GitHub Stars |
|------|------|----------|--------------|
| Discussion | 通义听悟实时转写 | POST /sessions, WebSocket | 内部项目 |
| Discussion | 通义千问 LLM | OpenAI 兼容 API | 内部项目 |
| LongCut | 引用匹配算法 | lib/quote-matcher.ts | 内部项目 |
| LongCut | 句子合并算法 | lib/transcript-sentence-merger.ts | 内部项目 |
| LongCut | 时间戳工具 | lib/timestamp-utils.ts | 内部项目 |
| LongCut | 主题提取水合 | lib/topic-utils.ts | 内部项目 |
| LongCut | 类型定义 | lib/types.ts | 内部项目 |
| Open Notebook | 向量搜索 | /search API (localhost:5055/docs) | 17.3k |

### 推荐复用（UI 组件）

| 组件 | 用途 | npm 包 | GitHub Stars |
|------|------|--------|--------------|
| wavesurfer.js | 音频波形播放器 | wavesurfer.js | 10k |
| Dexie.js | IndexedDB 封装 | dexie + dexie-react-hooks | 13.9k |
| nivo | 热力图可视化 | @nivo/heatmap | 13.9k |
| Vercel AI SDK | AI 聊天 UI + 流式输出 | ai + @ai-sdk/react | 20.6k |
| deep-chat | AI 聊天组件 (可选) | deep-chat | 3.5k |

### 开源组件使用规范

#### wavesurfer.js 使用规范
```typescript
// ✅ 正确：使用 useRef + useEffect 管理生命周期
const containerRef = useRef<HTMLDivElement>(null);
const wavesurferRef = useRef<WaveSurfer | null>(null);

useEffect(() => {
  if (!containerRef.current) return;
  const ws = WaveSurfer.create({
    container: containerRef.current,
    waveColor: '#4F46E5',
    progressColor: '#818CF8',
  });
  wavesurferRef.current = ws;
  return () => ws.destroy(); // 必须销毁防止内存泄漏
}, []);

// ❌ 错误：不要在每次渲染时创建新实例
```

#### Dexie.js 使用规范
```typescript
// ✅ 正确：使用 useLiveQuery 实现响应式
import { useLiveQuery } from 'dexie-react-hooks';
const anchors = useLiveQuery(() => db.anchors.where('sessionId').equals(id).toArray());
// anchors 会自动响应数据变化

// ❌ 错误：不要在组件中直接 await db.xxx.toArray()
```

#### Vercel AI SDK 使用规范
```typescript
// ✅ 正确：使用 useChat hook + status 状态管理
const { messages, sendMessage, status, stop } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
});
// status: 'ready' | 'submitted' | 'streaming' | 'error'

// ❌ 错误：不要自己实现流式解析逻辑
```

#### @nivo/heatmap 使用规范
```typescript
// ✅ 正确：数据格式必须符合 nivo 规范
const data = [
  { id: '09:00-09:10', data: [{ x: '困惑密度', y: '09:00-09:10', v: 5 }] },
  { id: '09:10-09:20', data: [{ x: '困惑密度', y: '09:10-09:20', v: 12 }] },
];
<ResponsiveHeatMap data={data} />

// ❌ 错误：不要传入不符合格式的数据
```

### 可选复用（增强能力）

| 项目 | 能力 | 条件 | GitHub Stars |
|------|------|------|--------------|
| visx | 低级可视化组件 | 需要自定义图表时 | 20.5k |
| react-calendar-heatmap | 日历热力图 | 需要 GitHub 风格贡献图时 | 1.3k |
| chatbot-ui | 完整聊天界面 | 需要独立聊天应用时 | 32.9k |
| LongCut | 翻译能力 | 需要多语言支持时 | 内部项目 |
| Open Notebook | 播客生成 | 需要音频总结时 | 17.3k |
| Discussion | 图像生成 | 需要可视化解释时 | 内部项目 |

### Discussion 后端 API 参考

基于实际代码调研，Discussion 后端提供以下 API：

```typescript
// 创建实时转写会话
POST /sessions
Body: { meetingId?: string, topic?: string }
Response: { sessionId, taskId, meetingJoinUrl }

// 健康检查
GET /sessions/health
Response: { ok: true }

// 获取转录结果
GET /sessions/:id/transcripts
Response: Transcript[]

// 上传音频块
POST /sessions/:id/audio
Body: { chunk: base64 }

// 完成会话
POST /sessions/:id/complete

// AI 问答
POST /sessions/:id/qa
Body: { question: string }
```

### Open Notebook API 参考

基于官方文档 (localhost:5055/docs)：

```typescript
// 向量搜索
POST /search
Body: { query: string, notebook_id?: string }
Response: { results: [{ content, score, source, metadata }] }

// 健康检查
GET /health
Response: { status: "ok" }
```
