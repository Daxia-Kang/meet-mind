# MeetMind 课堂助手

> 帮助学生在课堂上标记困惑点，课后通过 AI 家教补懂知识

## 🎯 项目定位

MeetMind 是一个面向 K12 学生的课堂学习辅助工具，核心理念是"课堂对齐"——让学生在课上标记没听懂的地方，课后通过 AI 家教基于老师原话进行补习。

---

## 📊 当前功能状态（2026-01-06 更新）

### ✅ 已实现且可用的功能

| 功能 | 说明 |
|------|------|
| **录音采集** | 浏览器端麦克风录音，支持开始/停止 |
| **困惑点标记** | "我没听懂"一键标记当前时间戳 |
| **复习模式三栏布局** | 时间轴 + AI家教 + 行动清单 |
| **AI 家教对话** | 通义千问 qwen3-max 真实调用 |
| **模型选择** | 支持 Qwen/Gemini/OpenAI 多模型切换 |
| **时间轴展示** | 显示转录文本，困惑点红点标记 |
| **行动清单** | AI 生成学习任务，可勾选完成 |
| **家长端** | 困惑点统计、AI 陪学脚本 |
| **教师端** | 班级困惑热力图、教学建议 |
| **服务状态指示** | 显示后端服务连接状态 |

### ⚠️ 使用演示数据的功能

| 功能 | 说明 |
|------|------|
| **转录文本** | 复习模式使用预设的"二次函数"演示数据 |
| **困惑点** | 默认显示演示困惑点 |

### ❌ 需要后端服务的功能

| 功能 | 依赖服务 | 说明 |
|------|----------|------|
| **实时语音转录** | Discussion 后端 | 通义听悟实时转写 |
| **向量知识搜索** | Open Notebook | 知识库语义搜索 |

---

## 🚀 快速开始

### 最简启动（推荐）

```bash
cd meetmind
npm install
npm run dev
```

访问 http://localhost:3001

> 此模式使用演示数据，可体验完整 UI 和 AI 对话功能

### 完整启动（含语音转录）

```bash
# 1. 启动 Discussion 后端（通义听悟）
cd ../discussion_new2/backend
npm install
npm run start

# 2. 启动 MeetMind
cd ../../open_notebook/meetmind
npm run dev
```

---

## 📱 功能演示

### 1. 学生端 - 录音模式

**访问：** http://localhost:3001

![录音模式](docs/record-mode.png)

- 点击"开始录音"开始录制
- 遇到不懂的地方点击"我没听懂这里"
- 录音结束后切换到"复习模式"

### 2. 学生端 - 复习模式

**访问：** http://localhost:3001 → 点击"复习模式"

![复习模式](docs/review-mode.png)

**三栏布局：**

| 区域 | 功能 |
|------|------|
| **左栏 - 时间轴** | 课堂转录文本，红点标记困惑点，点击跳转 |
| **中栏 - AI 家教** | 选择困惑点后 AI 分析解释，支持追问 |
| **右栏 - 行动清单** | AI 建议的学习任务，可勾选完成 |

**AI 家教功能：**
- 🎯 引用老师原话（带时间戳）
- 🔍 分析可能卡住的点
- ❓ 追问定位具体问题
- ✅ 生成行动清单

### 3. 家长端

**访问：** http://localhost:3001/parent

- 今日学习概览
- 困惑点详情列表
- AI 陪学脚本
- 任务完成进度

### 4. 教师端

**访问：** http://localhost:3001/teacher

- 班级困惑点热力图
- 高频困惑点排行
- AI 教学建议
- 学生困惑详情

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     MeetMind (Next.js)                      │
│                    http://localhost:3001                    │
├─────────────────────────────────────────────────────────────┤
│  学生端 (/)     │   家长端 (/parent)   │  教师端 (/teacher) │
├─────────────────────────────────────────────────────────────┤
│                      服务层 (services/)                      │
│  llm-service    │  tingwu-service  │  notebook-service     │
└────────┬────────────────┬────────────────────┬──────────────┘
         │                │                    │
         ▼                ▼                    ▼
┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ 通义千问 API │  │ Discussion 后端  │  │ Open Notebook   │
│ (DashScope) │  │ :4000 (通义听悟) │  │ :5055 (向量搜索) │
└─────────────┘  └─────────────────┘  └─────────────────┘
```

### 服务依赖

| 服务 | 端口 | 用途 | 必需? |
|------|------|------|-------|
| MeetMind | 3001 | 主应用 | ✅ 必需 |
| DashScope API | - | AI 对话 | ✅ 必需（需配置 API Key） |
| Discussion | 4000 | 语音转录 | ⚠️ 可选 |
| Open Notebook | 5055 | 向量搜索 | ⚠️ 可选 |

---

## 📁 项目结构

```
meetmind/
├── src/
│   ├── app/                    # Next.js 页面
│   │   ├── page.tsx           # 学生端首页
│   │   ├── parent/page.tsx    # 家长端
│   │   ├── teacher/page.tsx   # 教师端
│   │   └── api/               # API 路由
│   │       ├── chat/route.ts  # 通用对话
│   │       └── tutor/route.ts # AI 家教
│   ├── components/            # React 组件
│   │   ├── Recorder.tsx       # 录音组件
│   │   ├── AITutor.tsx        # AI 家教（主要）
│   │   ├── AIChat.tsx         # AI 聊天（简化版）
│   │   ├── TimelineView.tsx   # 时间轴
│   │   ├── ActionList.tsx     # 行动清单
│   │   ├── WaveformPlayer.tsx # 波形播放器
│   │   ├── ServiceStatus.tsx  # 服务状态指示
│   │   └── ModelSelector.tsx  # 模型选择
│   ├── lib/
│   │   ├── services/          # 服务层
│   │   │   ├── llm-service.ts      # LLM 调用
│   │   │   ├── tingwu-service.ts   # 通义听悟
│   │   │   ├── tutor-service.ts    # AI 家教逻辑
│   │   │   ├── health-check.ts     # 服务健康检查
│   │   │   ├── search-service.ts   # 搜索服务
│   │   │   ├── anchor-service.ts   # 断点管理
│   │   │   ├── memory-service.ts   # 时间轴构建
│   │   │   └── parent-service.ts   # 家长日报
│   │   ├── longcut/           # LongCut 算法复用
│   │   │   ├── quote-matcher.ts
│   │   │   ├── transcript-sentence-merger.ts
│   │   │   └── timestamp-utils.ts
│   │   └── db.ts              # IndexedDB 数据库
│   └── types/                 # 类型定义
├── .env.local                 # 环境变量
└── package.json
```

---

## ⚙️ 环境变量配置

```bash
# .env.local

# 通义千问（必需）
DASHSCOPE_API_KEY=sk-xxx
LLM_MODEL=qwen3-max
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Google Gemini（可选）
GOOGLE_API_KEY=xxx

# 服务地址（可选）
NEXT_PUBLIC_DISCUSSION_API=http://localhost:4000
NEXT_PUBLIC_NOTEBOOK_API=http://localhost:5055
```

---

## 🔌 三个开源项目复用情况

### Discussion 项目
- ✅ 通义千问 LLM 调用模式
- ✅ 通义听悟实时转写架构
- ✅ 录音采集架构参考

### LongCut 项目
- ✅ 时间戳格式化 `formatTimestamp()`
- ✅ 句子合并 `mergeSentences()`
- ✅ 引用匹配 `findTextInTranscript()`
- ✅ 转录索引 `buildTranscriptIndex()`

### Open Notebook 项目
- ✅ 向量搜索 API 调用
- ⚠️ 需要单独启动 Docker 服务

---

## 🐛 已知限制

1. **转录数据**：复习模式使用演示数据，录音产生的转录未持久化
2. **数据存储**：使用 localStorage，刷新后部分数据丢失
3. **波形播放器**：已创建但需要实际录音才显示
4. **用户认证**：无登录系统，角色通过 URL 切换

---

## 📝 后续优化方向

### P0 - 核心体验
- [ ] 录音转录数据持久化到 IndexedDB
- [ ] 波形播放器与时间轴联动
- [ ] 引用时间戳点击跳转播放

### P1 - 功能完善
- [ ] 对话历史持久化
- [ ] 断点备注功能
- [ ] 本地语音识别降级（Web Speech API）

### P2 - 体验优化
- [ ] 学生-家长数据同步
- [ ] 移动端适配
- [ ] 深色模式

---

## 📄 License

MIT
