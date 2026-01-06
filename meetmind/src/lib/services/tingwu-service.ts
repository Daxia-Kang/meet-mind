/**
 * 通义听悟服务 - 实时语音转写
 * 
 * 架构（基于阿里云官方最佳实践）：
 * 1. 前端通过 HTTP 创建任务，获取 meetingJoinUrl
 * 2. 前端直接通过 WebSocket 连接 meetingJoinUrl
 * 3. 前端发送音频数据，实时接收转录结果
 * 
 * 关键事件：
 * - SentenceBegin: 句子开始
 * - TranscriptionResultChanged: 中间结果（用于实时显示）
 * - SentenceEnd: 句子结束（最终结果）
 */

// Discussion 后端 API 地址
const DISCUSSION_API = process.env.NEXT_PUBLIC_DISCUSSION_API || 'http://localhost:4000';

export interface TingwuSession {
  sessionId: string;
  taskId: string;
  meetingJoinUrl: string;
  status: 'created' | 'connecting' | 'connected' | 'transcribing' | 'stopped' | 'error';
}

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
  isFinal: boolean;
}

export interface TingwuCallbacks {
  onTranscript?: (segment: TranscriptSegment) => void;
  onInterim?: (text: string, index: number) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: TingwuSession['status']) => void;
}

// 通义听悟 WebSocket 消息类型
interface TingwuMessage {
  header: {
    name: string;
    namespace: string;
    message_id?: string;
    task_id?: string;
    status?: number;
    status_text?: string;
  };
  payload?: {
    index?: number;
    time?: number;
    begin_time?: number;
    end_time?: number;
    result?: string;
    confidence?: number;
    words?: Array<{
      text: string;
      begin_time: number;
      end_time: number;
    }>;
  };
}

/**
 * 通义听悟客户端 - WebSocket 实时转写
 */
export class TingwuClient {
  private sessionId: string;
  private backendSessionId: string | null = null;
  private taskId: string | null = null;
  private meetingJoinUrl: string | null = null;
  private status: TingwuSession['status'] = 'created';
  private callbacks: TingwuCallbacks;
  
  // WebSocket 相关
  private ws: WebSocket | null = null;
  private wsReconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private audioQueue: ArrayBuffer[] = [];
  private isWsReady = false;
  
  // 转录计数
  private sentenceIndex = 0;
  private currentInterimText = '';

  constructor(sessionId: string, callbacks: TingwuCallbacks = {}) {
    this.sessionId = sessionId;
    this.callbacks = callbacks;
  }

  /**
   * 检查 Discussion 后端是否可用
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${DISCUSSION_API}/sessions/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 创建实时转写任务
   */
  async createTask(topic?: string): Promise<boolean> {
    try {
      console.log('[Tingwu] Creating task...');
      this.updateStatus('connecting');
      
      const response = await fetch(`${DISCUSSION_API}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: this.sessionId,
          topic: topic || `课堂录音 - ${new Date().toLocaleString()}`,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Tingwu] Failed to create task:', error);
        this.updateStatus('error');
        this.callbacks.onError?.('创建转写任务失败');
        return false;
      }

      const data = await response.json();
      this.backendSessionId = data.sessionId;
      this.taskId = data.taskId;
      this.meetingJoinUrl = data.meetingJoinUrl;
      
      console.log('[Tingwu] Task created:', { 
        sessionId: this.backendSessionId, 
        taskId: this.taskId,
        meetingJoinUrl: this.meetingJoinUrl 
      });
      
      // 如果有 meetingJoinUrl，建立 WebSocket 连接
      if (this.meetingJoinUrl) {
        this.connectWebSocket();
      } else {
        // 降级到轮询模式
        console.warn('[Tingwu] No meetingJoinUrl, falling back to polling mode');
        this.updateStatus('connected');
      }
      
      return true;
    } catch (error) {
      console.error('[Tingwu] Failed to create task:', error);
      this.updateStatus('error');
      this.callbacks.onError?.('连接转写服务失败');
      return false;
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  private connectWebSocket(): void {
    if (!this.meetingJoinUrl) {
      console.error('[Tingwu] No meetingJoinUrl');
      return;
    }

    console.log('[Tingwu] Connecting WebSocket:', this.meetingJoinUrl);
    
    try {
      this.ws = new WebSocket(this.meetingJoinUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[Tingwu] WebSocket connected');
        this.wsReconnectAttempts = 0;
        this.isWsReady = true;
        this.updateStatus('connected');
        
        // 发送开始转写命令
        this.sendStartCommand();
        
        // 发送队列中的音频数据
        this.flushAudioQueue();
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };

      this.ws.onerror = (error) => {
        console.error('[Tingwu] WebSocket error:', error);
        this.callbacks.onError?.('WebSocket 连接错误');
      };

      this.ws.onclose = (event) => {
        console.log('[Tingwu] WebSocket closed:', event.code, event.reason);
        this.isWsReady = false;
        
        // 尝试重连
        if (this.status !== 'stopped' && this.wsReconnectAttempts < this.maxReconnectAttempts) {
          this.wsReconnectAttempts++;
          console.log(`[Tingwu] Reconnecting... attempt ${this.wsReconnectAttempts}`);
          setTimeout(() => this.connectWebSocket(), 1000 * this.wsReconnectAttempts);
        }
      };
    } catch (error) {
      console.error('[Tingwu] Failed to create WebSocket:', error);
      this.callbacks.onError?.('创建 WebSocket 连接失败');
    }
  }

  /**
   * 发送开始转写命令
   */
  private sendStartCommand(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const startCmd = {
      header: {
        name: 'StartTranscription',
        namespace: 'SpeechTranscriber',
        message_id: `msg-${Date.now()}`,
        task_id: this.taskId,
      },
      payload: {
        format: 'pcm',
        sample_rate: 16000,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
      },
    };

    console.log('[Tingwu] Sending StartTranscription command');
    this.ws.send(JSON.stringify(startCmd));
    this.updateStatus('transcribing');
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    if (typeof event.data === 'string') {
      try {
        const msg: TingwuMessage = JSON.parse(event.data);
        const eventName = msg.header?.name;
        
        console.log('[Tingwu] Received:', eventName, msg.payload);

        switch (eventName) {
          case 'TranscriptionStarted':
            console.log('[Tingwu] Transcription started');
            break;

          case 'SentenceBegin':
            // 句子开始
            this.currentInterimText = '';
            break;

          case 'TranscriptionResultChanged':
            // 中间结果 - 实时显示
            if (msg.payload?.result) {
              this.currentInterimText = msg.payload.result;
              this.callbacks.onInterim?.(msg.payload.result, msg.payload.index || 0);
            }
            break;

          case 'SentenceEnd':
            // 句子结束 - 最终结果
            if (msg.payload?.result) {
              const segment: TranscriptSegment = {
                id: `seg-${Date.now()}-${this.sentenceIndex}`,
                text: msg.payload.result,
                startMs: msg.payload.begin_time || 0,
                endMs: msg.payload.end_time || 0,
                confidence: msg.payload.confidence || 0.9,
                isFinal: true,
              };
              
              this.sentenceIndex++;
              this.currentInterimText = '';
              this.callbacks.onTranscript?.(segment);
            }
            break;

          case 'TranscriptionCompleted':
            console.log('[Tingwu] Transcription completed');
            break;

          case 'TaskFailed':
            console.error('[Tingwu] Task failed:', msg.header?.status_text);
            this.callbacks.onError?.(msg.header?.status_text || '转写任务失败');
            break;
        }
      } catch (error) {
        console.warn('[Tingwu] Failed to parse message:', error);
      }
    }
  }

  /**
   * 发送音频数据
   */
  async sendAudio(audioData: ArrayBuffer | Blob): Promise<void> {
    let buffer: ArrayBuffer;
    
    if (audioData instanceof Blob) {
      buffer = await audioData.arrayBuffer();
    } else {
      buffer = audioData;
    }

    // 如果 WebSocket 已连接，直接发送
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isWsReady) {
      this.sendAudioChunk(buffer);
    } else if (this.meetingJoinUrl) {
      // WebSocket 未就绪，加入队列
      this.audioQueue.push(buffer);
      console.log('[Tingwu] Audio queued, queue size:', this.audioQueue.length);
    } else {
      // 降级模式：发送到 HTTP API
      await this.sendAudioViaHttp(buffer);
    }
  }

  /**
   * 通过 WebSocket 发送音频块
   */
  private sendAudioChunk(buffer: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 将音频数据分片发送（每 4KB 一包）
    const chunkSize = 4096;
    const uint8Array = new Uint8Array(buffer);
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, Math.min(i + chunkSize, uint8Array.length));
      this.ws.send(chunk.buffer);
    }
    
    console.log('[Tingwu] Audio sent via WebSocket, size:', buffer.byteLength);
  }

  /**
   * 发送队列中的音频数据
   */
  private flushAudioQueue(): void {
    while (this.audioQueue.length > 0) {
      const buffer = this.audioQueue.shift();
      if (buffer) {
        this.sendAudioChunk(buffer);
      }
    }
  }

  /**
   * 通过 HTTP 发送音频（降级模式）
   */
  private async sendAudioViaHttp(buffer: ArrayBuffer): Promise<void> {
    if (!this.backendSessionId) {
      console.warn('[Tingwu] Session not created, dropping audio chunk');
      return;
    }

    try {
      const base64Data = this.arrayBufferToBase64(buffer);

      const response = await fetch(
        `${DISCUSSION_API}/sessions/${this.backendSessionId}/audio`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunk: base64Data }),
        }
      );

      if (!response.ok) {
        console.warn('[Tingwu] Failed to send audio via HTTP');
      }
    } catch (error) {
      console.warn('[Tingwu] Failed to send audio via HTTP:', error);
    }
  }

  /**
   * 开始轮询转录结果（降级模式）
   */
  startPolling(intervalMs: number = 1000): void {
    // 如果已经有 WebSocket 连接，不需要轮询
    if (this.meetingJoinUrl && this.ws) {
      console.log('[Tingwu] WebSocket mode, skipping polling');
      return;
    }

    console.log('[Tingwu] Starting polling mode, interval:', intervalMs);
    
    // 轮询逻辑保留作为降级方案
    const poll = async () => {
      if (this.status === 'stopped') return;
      
      try {
        const response = await fetch(
          `${DISCUSSION_API}/sessions/${this.backendSessionId}/transcripts`
        );
        
        if (response.ok) {
          const data = await response.json();
          // 处理轮询结果...
          this.handlePollingResult(data);
        }
      } catch (error) {
        console.warn('[Tingwu] Polling failed:', error);
      }
      
      if (this.status !== 'stopped') {
        setTimeout(poll, intervalMs);
      }
    };
    
    poll();
  }

  /**
   * 处理轮询结果
   */
  private handlePollingResult(data: Record<string, unknown>): void {
    let transcripts: Array<Record<string, unknown>> = [];
    
    if (Array.isArray(data)) {
      transcripts = data;
    } else if (data.transcription && Array.isArray(data.transcription)) {
      transcripts = data.transcription as Array<Record<string, unknown>>;
    } else if (data.segments && Array.isArray(data.segments)) {
      transcripts = data.segments as Array<Record<string, unknown>>;
    }

    // 只处理新的转录结果
    const newTranscripts = transcripts.slice(this.sentenceIndex);
    
    newTranscripts.forEach((item, index) => {
      const segment: TranscriptSegment = {
        id: (item.id as string) || `seg-${Date.now()}-${this.sentenceIndex + index}`,
        text: (item.text as string) || (item.content as string) || '',
        startMs: (item.startMs as number) || (item.begin_time as number) || 0,
        endMs: (item.endMs as number) || (item.end_time as number) || 0,
        confidence: (item.confidence as number) || 0.9,
        isFinal: true,
      };
      
      this.callbacks.onTranscript?.(segment);
    });
    
    this.sentenceIndex = transcripts.length;
  }

  /**
   * ArrayBuffer 转 Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 停止转写
   */
  async stop(): Promise<void> {
    this.updateStatus('stopped');

    // 发送停止命令
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const stopCmd = {
        header: {
          name: 'StopTranscription',
          namespace: 'SpeechTranscriber',
          message_id: `msg-${Date.now()}`,
          task_id: this.taskId,
        },
        payload: {},
      };
      
      this.ws.send(JSON.stringify(stopCmd));
      
      // 延迟关闭，确保最后的数据传输完成
      setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      }, 1000);
    }

    // 通知后端完成会话
    if (this.backendSessionId) {
      try {
        await fetch(
          `${DISCUSSION_API}/sessions/${this.backendSessionId}/complete`,
          { method: 'POST' }
        );
      } catch (error) {
        console.warn('Failed to complete session:', error);
      }
    }
  }

  /**
   * 更新状态
   */
  private updateStatus(status: TingwuSession['status']) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  /**
   * 获取当前状态
   */
  getStatus(): TingwuSession['status'] {
    return this.status;
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取后端会话 ID
   */
  getBackendSessionId(): string | null {
    return this.backendSessionId;
  }
}

/**
 * 通义听悟服务（简化接口）
 */
export const tingwuService = {
  /**
   * 检查服务是否可用
   */
  isAvailable: TingwuClient.isAvailable,

  /**
   * 创建客户端实例
   */
  createClient(sessionId: string, callbacks?: TingwuCallbacks): TingwuClient {
    return new TingwuClient(sessionId, callbacks);
  },

  /**
   * 获取历史转录
   */
  async getTranscript(sessionId: string): Promise<TranscriptSegment[]> {
    try {
      const response = await fetch(`${DISCUSSION_API}/sessions/${sessionId}/transcripts`);
      if (!response.ok) {
        return [];
      }
      return await response.json();
    } catch {
      return [];
    }
  },
};
