# 实施计划：MeetMind MVP

## 设计原则

**复用优先，降低设计熵**：

```
设计熵 = 自研代码量 × 维护复杂度 × 技术债务风险

目标：自研代码 < 800 行，复用比例 > 95%
```

- 每个任务优先标注"复用来源"
- 自研代码量占比目标 < 30%
- 优先完成复用集成任务，再做业务定制
- 遵循 KISS、DRY、YAGNI 原则

## 任务状态说明

- ✅ 已完成
- 🔄 进行中
- ⏳ 待开始
- ❌ 已取消

---

## Phase 0: 复用准备 (Day 1)

**目标：** 完成所有开源能力的集成准备

### 0.1 LongCut 文件复制

- [0.1]. ✅ 复制 LongCut 核心算法文件
  — 源: `c:/Users/Li Hao/Desktop/longcut/lib/`
  — 目标: `src/lib/longcut/`
  — 文件清单:
    - quote-matcher.ts (引用匹配，11.74 KB)
    - transcript-sentence-merger.ts (句子合并，13.49 KB)
    - timestamp-utils.ts (时间戳工具，3.24 KB)
    - topic-utils.ts (主题提取水合，10.63 KB)
    - types.ts (类型定义，4.24 KB)
  — 创建 index.ts 统一导出
  — 自研比例: 0%

### 0.2 npm 依赖安装

- [0.2]. ✅ 安装开源组件依赖
  — `npm install wavesurfer.js dexie dexie-react-hooks @nivo/heatmap @nivo/core ai @ai-sdk/react`
  — wavesurfer.js (10k stars): 音频波形播放器
  — dexie + dexie-react-hooks (13.9k stars): IndexedDB 封装 + React 响应式
  — @nivo/heatmap (13.9k stars): 专业热力图可视化
  — ai + @ai-sdk/react (20.6k stars): Vercel AI SDK，聊天 UI + 流式输出
  — 自研比例: 0%

### 0.3 Dexie.js 数据库初始化

- [0.3]. ✅ 创建 Dexie.js 数据库定义
  — 创建 `src/lib/db.ts`
  — 定义表: audioSessions, anchors, transcripts, preferences
  — 参考 LongCut types.ts 的数据结构
  — 自研比例: 10% (仅业务字段定制)

**代码模板：**
```typescript
// src/lib/db.ts
import Dexie, { Table } from 'dexie';

export interface AudioSession {
  id?: number;
  sessionId: string;
  blob: Blob;
  mimeType: string;
  duration: number;
  status: 'recording' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface Anchor {
  id?: number;
  sessionId: string;
  timestamp: number;
  type: 'confusion' | 'important';
  status: 'active' | 'resolved';
  note?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface TranscriptSegment {
  id?: number;
  sessionId: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
  isFinal: boolean;
}

class MeetMindDB extends Dexie {
  audioSessions!: Table<AudioSession>;
  anchors!: Table<Anchor>;
  transcripts!: Table<TranscriptSegment>;

  constructor() {
    super('MeetMindDB');
    this.version(1).stores({
      audioSessions: '++id, sessionId, status, createdAt',
      anchors: '++id, sessionId, timestamp, status',
      transcripts: '++id, sessionId, startMs'
    });
  }
}

export const db = new MeetMindDB();
```

---

## Phase 1: 核心录音与回放 (Day 2-3)

**目标：** 使用 wavesurfer.js + Dexie.js 实现完整录音回放

### 1.1 录音组件重构

- [1.1]. ✅ 录音组件基础功能 (已完成)
  — MediaRecorder 录音采集
  — 暂停/继续功能
  — Web Audio API 音量可视化
  — 复用: 无 (浏览器原生 API)

- [1.2]. ✅ 集成 Dexie.js 音频存储
  — 替换现有 IndexedDB 直接操作
  — 使用 `db.audioSessions.add(blob)`
  — 实现会话管理 (新建/继续/归档)
  — 复用: Dexie.js 100%
  — 自研比例: 5%

**代码模板：**
```typescript
// src/hooks/useAudioSession.ts
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';

// ✅ 使用 useLiveQuery 实现响应式
export function useAudioSessions() {
  return useLiveQuery(
    () => db.audioSessions.orderBy('createdAt').reverse().toArray()
  ) ?? [];
}

export async function saveAudioSession(blob: Blob, sessionId: string) {
  await db.audioSessions.add({
    sessionId,
    blob,
    mimeType: blob.type,
    duration: 0,
    status: 'completed',
    createdAt: new Date(),
    updatedAt: new Date()
  });
}
```

### 1.2 音频播放器重构

- [1.3]. ✅ 集成 wavesurfer.js 播放器
  — 替换现有 AudioPlayer 组件
  — 实现波形可视化
  — 实现点击跳转播放
  — 复用: wavesurfer.js 100%
  — 自研比例: 10% (UI 定制)

**代码模板：**
```typescript
// src/components/AudioPlayer.tsx
import { useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';

export function AudioPlayer({ audioUrl, onReady }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4F46E5',
      progressColor: '#818CF8',
      height: 80,
      plugins: [RegionsPlugin.create()]
    });
    
    ws.load(audioUrl);
    ws.on('ready', onReady);
    wsRef.current = ws;
    
    return () => ws.destroy(); // ✅ 关键：必须销毁
  }, [audioUrl]);

  return <div ref={containerRef} />;
}
```

- [1.4]. ✅ wavesurfer.js 困惑点标记
  — 使用 RegionsPlugin 添加红/绿色区域
  — 点击区域选中困惑点
  — 与 Dexie.js anchors 表同步
  — 复用: wavesurfer.js Regions 100%
  — 自研比例: 10%

---

## Phase 2: 语音转录 (Day 4-5)

**目标：** 集成 Discussion 通义听悟 + Web Speech API 降级

### 2.1 通义听悟集成

- [2.1]. ✅ tingwu-service.ts (已完成)
  — Discussion 后端 WebSocket 连接
  — 音频数据发送
  — 转录结果回调
  — 复用: Discussion 100%

- [2.2]. ✅ 转录数据持久化
  — 使用 Dexie.js 存储转录片段
  — `db.transcripts.add(segment)`
  — 支持增量更新
  — 复用: Dexie.js 100%
  — 自研比例: 5%

### 2.2 降级方案

- [2.3]. ✅ Web Speech API 降级实现
  — 创建 `src/lib/services/speech-service.ts`
  — 实现 SpeechRecognition 封装
  — 显示"本地识别模式"提示
  — 复用: 浏览器原生 API 100%
  — 自研比例: 20% (封装逻辑)

- [2.4]. ✅ 统一转录服务
  — 创建 `src/lib/services/transcription-service.ts`
  — 自动检测 Discussion 可用性
  — 自动降级切换
  — 复用: Discussion + Web Speech API
  — 自研比例: 30% (编排逻辑)

### 2.3 句子合并

- [2.5]. ✅ 集成 LongCut 句子合并
  — 录音结束时调用 `mergeTranscriptSegmentsIntoSentences()`
  — 合并后的段落存储到 Dexie.js
  — 复用: LongCut 100%
  — 自研比例: 0%

---

## Phase 3: AI 家教问答 (Day 6-7)

**目标：** 集成 LongCut 引用匹配 + Discussion LLM

### 3.1 引用匹配集成

- [3.1]. ✅ 集成 LongCut 引用匹配
  — 调用 `buildTranscriptIndex()` 构建索引
  — 调用 `findTextInTranscript()` 匹配引用
  — 返回匹配结果和置信度
  — 复用: LongCut 100%
  — 自研比例: 0%

- [3.2]. ✅ 重构 tutor-service.ts
  — 使用 LongCut 引用匹配替换现有逻辑
  — 提取上下文 (前60秒后30秒)
  — 生成带时间戳的引用
  — 复用: LongCut + Discussion LLM
  — 自研比例: 20% (Prompt 工程)

**代码模板（使用 Vercel AI SDK useChat）：**
```typescript
// src/components/AITutor.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export function AITutor({ anchorId, context }) {
  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { anchorId, context },
    }),
  });

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>
          {m.parts.map((p, i) => p.type === 'text' ? <span key={i}>{p.text}</span> : null)}
        </div>
      ))}
      {status === 'streaming' && <button onClick={stop}>停止</button>}
    </div>
  );
}

// src/app/api/chat/route.ts
import { streamText, convertToModelMessages } from 'ai';

export async function POST(req: Request) {
  const { messages, context } = await req.json();
  const result = streamText({
    model: 'qwen/qwen3-max',
    system: buildSystemPrompt(context),
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
```

### 3.2 AI 解释展示

- [3.3]. ✅ 结构化内容展示 (已完成)
  — "老师是这样讲的"
  — "你可能卡在这里"
  — "让我问你一个问题"
  — "今晚行动清单"

- [3.4]. ✅ 引用跳转播放
  — 点击引用时间戳
  — 调用 wavesurfer.seekTo()
  — 开始播放
  — 复用: wavesurfer.js 100%
  — 自研比例: 5%

### 3.3 追问对话

- [3.5]. ✅ 追问对话功能 (已完成)
  — 对话历史维护
  — 追问发送
  — 快捷回复按钮

---

## Phase 4: 知识库搜索 (Day 8)

**目标：** 集成 Open Notebook 向量搜索 + LongCut 降级

### 4.1 向量搜索集成

- [4.1]. ✅ 创建 search-service.ts
  — 调用 Open Notebook /search API
  — 返回相似度排序结果
  — 复用: Open Notebook 100%
  — 自研比例: 10% (接口封装)

- [4.2]. ✅ 本地搜索降级
  — Open Notebook 不可用时
  — 使用 LongCut findTextInTranscript()
  — N-gram 模糊匹配
  — 复用: LongCut 100%
  — 自研比例: 0%

### 4.2 搜索 UI

- [4.3]. ✅ 搜索功能 UI (已完成)
  — 搜索输入框
  — 搜索按钮
  — 结果展示

---

## Phase 5: 服务状态与降级 (Day 9)

**目标：** 实现完整的服务状态检测和降级机制

### 5.1 健康检查

- [5.1]. ✅ 创建 health-check.ts
  — 并行检查 Discussion(:4000) 和 Open Notebook(:5055)
  — 检测 Web Speech API 支持
  — 检测 IndexedDB 支持
  — 复用: 无 (简单 HTTP 检查)
  — 自研比例: 100% (但代码量极小)

- [5.2]. ✅ Header 服务状态指示器
  — 显示 Discussion 状态 (绿/灰)
  — 显示 Notebook 状态 (绿/灰)
  — 30 秒轮询更新
  — 复用: 无
  — 自研比例: 100% (UI 组件)

### 5.2 降级提示

- [5.3]. ✅ 录音降级提示
  — Discussion 不可用时显示"本地识别模式"
  — 提示精度可能较低
  — 复用: 无
  — 自研比例: 100% (UI 提示)

---

## Phase 6: 家长端 (Day 10)

**目标：** 使用 Dexie.js 跨端共享数据

### 6.1 数据读取

- [6.1]. ✅ 家长端页面框架 (已完成)
  — /parent 页面
  — 今日概览卡片

- [6.2]. ✅ Dexie.js 数据读取
  — 从 IndexedDB 读取今日会话
  — 读取困惑点列表
  — 计算完成率
  — 复用: Dexie.js 100%
  — 自研比例: 10%

### 6.2 陪学脚本

- [6.3]. ✅ 陪学脚本生成 (已完成)
  — AI 生成陪学指南
  — 展示脚本内容
  — 复用: Discussion LLM 100%

---

## Phase 7: 教师端 (Day 11-12)

**目标：** 使用 @nivo/heatmap 实现热力图

### 7.1 热力图

- [7.1]. ✅ @nivo/heatmap 热力图集成
  — 使用 @nivo/heatmap ResponsiveHeatMap 组件
  — 横轴: 课堂时间（分钟区间）
  — 纵轴: 困惑密度
  — 复用: @nivo/heatmap 100%
  — 自研比例: 20% (数据处理)

**代码模板：**
```typescript
// src/components/ConfusionHeatmap.tsx
import { ResponsiveHeatMap } from '@nivo/heatmap';

export function ConfusionHeatmap({ data, onCellClick }) {
  // ✅ 转换为 nivo 要求的数据格式
  const nivoData = data.map(item => ({
    id: item.timeSlot,
    data: [{ x: '困惑密度', y: item.density }]
  }));

  return (
    <div style={{ height: 400 }}>
      <ResponsiveHeatMap
        data={nivoData}
        margin={{ top: 60, right: 90, bottom: 60, left: 90 }}
        colors={{ type: 'sequential', scheme: 'reds' }}
        onClick={(cell) => onCellClick?.(cell.serieId)}
      />
    </div>
  );
}
```

- [7.2]. ✅ 高频困惑点排行
  — 使用 LongCut hydrateTopicsWithTranscript() 提取主题
  — 显示 TOP 5 困惑点
  — 复用: LongCut topic-utils.ts 100%
  — 自研比例: 10%

### 7.2 详情展开

- [7.3]. ✅ 困惑详情展开
  — 点击热区展开详情
  — 显示转录内容
  — 显示困惑学生列表
  — 复用: 无
  — 自研比例: 100% (UI 组件)

- [7.4]. ✅ 教学建议生成
  — 调用 Discussion LLM
  — 生成教学改进建议
  — 复用: Discussion LLM 100%
  — 自研比例: 20% (Prompt)

---

## Phase 8: 收尾优化 (Day 13-14)

### 8.1 会话管理

- [8.1]. ✅ 会话管理 UI
  — 检测未完成会话
  — 提示继续或新建
  — 归档历史会话
  — 复用: Dexie.js 100%
  — 自研比例: 20%

### 8.2 数据清理

- [8.2]. ✅ 存储空间管理
  — 显示已用存储空间
  — 提供清理旧数据功能
  — 复用: Dexie.js 100%
  — 自研比例: 20%

---

## 任务优先级排序

### P0 - 复用集成 (Week 1)

| 任务 | 状态 | 复用来源 | 自研比例 |
|------|------|----------|----------|
| [0.1] LongCut 文件复制 | ✅ | LongCut | 0% |
| [0.2] npm 依赖安装 | ✅ | 开源组件 | 0% |
| [0.3] Dexie.js 数据库 | ✅ | Dexie.js | 10% |
| [1.2] Dexie.js 音频存储 | ✅ | Dexie.js | 5% |
| [1.3] wavesurfer.js 播放器 | ✅ | wavesurfer.js | 10% |
| [2.3] Web Speech 降级 | ✅ | 浏览器原生 | 20% |
| [3.1] LongCut 引用匹配 | ✅ | LongCut | 0% |

### P1 - 核心功能 (Week 2)

| 任务 | 状态 | 复用来源 | 自研比例 |
|------|------|----------|----------|
| [1.4] wavesurfer 困惑点标记 | ✅ | wavesurfer.js | 10% |
| [2.4] 统一转录服务 | ✅ | Discussion | 30% |
| [2.5] 句子合并集成 | ✅ | LongCut | 0% |
| [3.2] tutor-service 重构 | ✅ | LongCut + LLM | 20% |
| [3.4] 引用跳转播放 | ✅ | wavesurfer.js | 5% |
| [4.1] search-service | ✅ | Open Notebook | 10% |
| [4.2] 本地搜索降级 | ✅ | LongCut | 0% |

### P2 - 体验完善 (Week 3)

| 任务 | 状态 | 复用来源 | 自研比例 |
|------|------|----------|----------|
| [5.1] health-check | ✅ | 无 | 100% |
| [5.2] 状态指示器 | ✅ | 无 | 100% |
| [6.2] 家长端数据读取 | ✅ | Dexie.js | 10% |
| [7.1] @nivo/heatmap 热力图 | ✅ | @nivo/heatmap | 20% |
| [7.2] 高频困惑排行 | ✅ | LongCut topic-utils | 10% |
| [8.1] 会话管理 | ✅ | Dexie.js | 20% |

---

## 完成度统计

| 阶段 | 总任务 | 已完成 | 进行中 | 待开始 | 完成率 | 平均自研比例 |
|------|--------|--------|--------|--------|--------|--------------|
| Phase 0 | 3 | 3 | 0 | 0 | 100% | 3% |
| Phase 1 | 4 | 4 | 0 | 0 | 100% | 8% |
| Phase 2 | 5 | 5 | 0 | 0 | 100% | 11% |
| Phase 3 | 5 | 5 | 0 | 0 | 100% | 5% |
| Phase 4 | 3 | 3 | 0 | 0 | 100% | 5% |
| Phase 5 | 3 | 3 | 0 | 0 | 100% | 100% |
| Phase 6 | 3 | 3 | 0 | 0 | 100% | 10% |
| Phase 7 | 4 | 4 | 0 | 0 | 100% | 38% |
| Phase 8 | 2 | 2 | 0 | 0 | 100% | 20% |
| **总计** | **32** | **32** | **0** | **0** | **100%** | **~15%** |

---

## 复用效益分析

### 代码量预估

| 类别 | 代码行数 | 来源 |
|------|----------|------|
| LongCut 复制 | ~2,000 行 | 直接复制 (含 topic-utils) |
| wavesurfer.js | ~10,000 行 | npm 依赖 (10k stars) |
| Dexie.js | ~5,000 行 | npm 依赖 (13.9k stars) |
| @nivo/heatmap | ~15,000 行 | npm 依赖 (13.9k stars) |
| Vercel AI SDK | ~8,000 行 | npm 依赖 (20.6k stars) |
| Discussion 调用 | ~2,000 行 | HTTP/WS 调用 |
| **自研代码** | **~800 行** | 业务逻辑 |

**复用比例：** 98% (自研仅 ~800 行)

### 开发时间预估

| 方案 | 预估时间 | 风险 |
|------|----------|------|
| 全部自研 | 8-10 周 | 高 |
| 复用优先 | 2-3 周 | 低 |

**节省时间：** 70%+

---

## 下一步行动

1. **立即执行 (Day 1):**
   - [0.1] 复制 LongCut 文件
   - [0.2] 安装 npm 依赖
   - [0.3] 创建 Dexie.js 数据库

2. **本周完成 (Week 1):**
   - [1.2] [1.3] [1.4] wavesurfer.js + Dexie.js 集成
   - [2.3] [2.4] 转录服务统一

3. **下周完成 (Week 2):**
   - [3.1] [3.2] [3.4] AI 家教引用匹配
   - [4.1] [4.2] 知识库搜索

---

## 附录：复用文件清单

### 从 LongCut 复制

```bash
# 执行复制命令
mkdir -p src/lib/longcut
cp "c:/Users/Li Hao/Desktop/longcut/lib/quote-matcher.ts" src/lib/longcut/
cp "c:/Users/Li Hao/Desktop/longcut/lib/transcript-sentence-merger.ts" src/lib/longcut/
cp "c:/Users/Li Hao/Desktop/longcut/lib/timestamp-utils.ts" src/lib/longcut/
cp "c:/Users/Li Hao/Desktop/longcut/lib/topic-utils.ts" src/lib/longcut/
cp "c:/Users/Li Hao/Desktop/longcut/lib/types.ts" src/lib/longcut/
```

### npm 安装命令

```bash
npm install wavesurfer.js dexie dexie-react-hooks @nivo/heatmap @nivo/core ai @ai-sdk/react
npm install -D @types/wavesurfer.js
```

### 环境变量配置

```bash
# .env.local
NEXT_PUBLIC_DISCUSSION_API=http://localhost:4000
NEXT_PUBLIC_NOTEBOOK_API=http://localhost:5055
DASHSCOPE_API_KEY=sk-xxx
```
