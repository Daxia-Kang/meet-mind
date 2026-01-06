/**
 * Discussion 服务调用层
 * 
 * 复用能力：
 * - 通义听悟 (课堂音频转写)
 * - 通义千问 (AI 对话)
 * - 图像生成
 */

const DISCUSSION_API = '/api/discussion';

export interface TingwuTask {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    sentences: Array<{
      text: string;
      beginTime: number;
      endTime: number;
      speakerId?: string;
    }>;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  content: string;
  citations?: Array<{
    text: string;
    startTime: number;
    endTime: number;
  }>;
}

/**
 * Discussion 服务客户端
 */
export const discussionService = {
  /**
   * 创建通义听悟转写任务
   */
  async createTranscribeTask(audioUrl: string): Promise<{ taskId: string }> {
    const res = await fetch(`${DISCUSSION_API}/tingwu/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl }),
    });
    if (!res.ok) throw new Error('创建转写任务失败');
    return res.json();
  },

  /**
   * 查询转写任务状态
   */
  async getTaskStatus(taskId: string): Promise<TingwuTask> {
    const res = await fetch(`${DISCUSSION_API}/tingwu/task/${taskId}`);
    if (!res.ok) throw new Error('查询任务状态失败');
    return res.json();
  },

  /**
   * 开始实时转写 (WebSocket)
   */
  createRealtimeSession(): WebSocket {
    const wsUrl = `ws://localhost:4000/tingwu/stream`;
    return new WebSocket(wsUrl);
  },

  /**
   * AI 对话 (通义千问)
   */
  async chat(
    messages: ChatMessage[],
    context?: string
  ): Promise<ChatResponse> {
    const res = await fetch(`${DISCUSSION_API}/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
    });
    if (!res.ok) throw new Error('AI 对话失败');
    return res.json();
  },

  /**
   * 流式 AI 对话
   */
  async *chatStream(
    messages: ChatMessage[],
    context?: string
  ): AsyncGenerator<string> {
    const res = await fetch(`${DISCUSSION_API}/session/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
    });
    
    if (!res.ok) throw new Error('AI 对话失败');
    if (!res.body) throw new Error('无响应体');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  },
};
