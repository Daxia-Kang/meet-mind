/**
 * 语音识别服务 - 统一接口
 * 
 * 优先级：
 * 1. 通义听悟（通过 Discussion 后端）
 * 2. Web Speech API（浏览器原生）
 * 3. 离线模式（仅录音，不转写）
 */

import { TingwuClient, tingwuService, type TranscriptSegment, type TingwuCallbacks } from './tingwu-service';

// Web Speech API 类型声明
interface SpeechRecognitionType extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionType, ev: Event) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((this: SpeechRecognitionType, ev: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((this: SpeechRecognitionType, ev: any) => void) | null;
  onend: ((this: SpeechRecognitionType, ev: Event) => void) | null;
}

export type SpeechProvider = 'tingwu' | 'webspeech' | 'offline';

export interface SpeechServiceCallbacks {
  onTranscript?: (segment: TranscriptSegment) => void;
  onInterim?: (text: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'listening' | 'error') => void;
  onProviderChange?: (provider: SpeechProvider) => void;
}

export interface SpeechServiceConfig {
  preferredProvider?: SpeechProvider;
  language?: string;
  continuous?: boolean;
}

/**
 * 统一语音识别服务
 */
export class SpeechService {
  private sessionId: string;
  private callbacks: SpeechServiceCallbacks;
  private config: SpeechServiceConfig;
  
  private provider: SpeechProvider = 'offline';
  private tingwuClient: TingwuClient | null = null;
  private webSpeechRecognition: SpeechRecognitionType | null = null;
  private segmentIndex = 0;
  private startTime = 0;

  constructor(
    sessionId: string,
    callbacks: SpeechServiceCallbacks = {},
    config: SpeechServiceConfig = {}
  ) {
    this.sessionId = sessionId;
    this.callbacks = callbacks;
    this.config = {
      preferredProvider: 'tingwu',
      language: 'zh-CN',
      continuous: true,
      ...config,
    };
  }

  /**
   * 检测可用的语音识别提供商
   */
  static async detectAvailableProviders(): Promise<SpeechProvider[]> {
    const providers: SpeechProvider[] = [];

    // 检查通义听悟
    const tingwuAvailable = await tingwuService.isAvailable();
    if (tingwuAvailable) {
      providers.push('tingwu');
    }

    // 检查 Web Speech API
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      providers.push('webspeech');
    }

    // 离线模式始终可用
    providers.push('offline');

    return providers;
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<SpeechProvider> {
    const availableProviders = await SpeechService.detectAvailableProviders();
    
    // 按优先级选择提供商
    if (this.config.preferredProvider && availableProviders.includes(this.config.preferredProvider)) {
      this.provider = this.config.preferredProvider;
    } else if (availableProviders.includes('tingwu')) {
      this.provider = 'tingwu';
    } else if (availableProviders.includes('webspeech')) {
      this.provider = 'webspeech';
    } else {
      this.provider = 'offline';
    }

    console.log(`SpeechService: Using provider "${this.provider}"`);
    this.callbacks.onProviderChange?.(this.provider);

    return this.provider;
  }

  /**
   * 开始语音识别
   */
  async start(): Promise<boolean> {
    this.startTime = Date.now();
    this.segmentIndex = 0;
    this.callbacks.onStatusChange?.('connecting');

    switch (this.provider) {
      case 'tingwu':
        return this.startTingwu();
      case 'webspeech':
        return this.startWebSpeech();
      case 'offline':
        this.callbacks.onStatusChange?.('listening');
        return true;
    }
  }

  /**
   * 发送音频数据（仅通义听悟需要）
   */
  sendAudio(audioData: ArrayBuffer | Blob): void {
    if (this.provider === 'tingwu' && this.tingwuClient) {
      this.tingwuClient.sendAudio(audioData);
    }
    // Web Speech API 不需要手动发送音频
  }

  /**
   * 停止语音识别
   */
  async stop(): Promise<void> {
    this.callbacks.onStatusChange?.('idle');

    if (this.tingwuClient) {
      await this.tingwuClient.stop();
      this.tingwuClient = null;
    }

    if (this.webSpeechRecognition) {
      this.webSpeechRecognition.stop();
      this.webSpeechRecognition = null;
    }
  }

  /**
   * 获取当前提供商
   */
  getProvider(): SpeechProvider {
    return this.provider;
  }

  /**
   * 获取提供商显示名称
   */
  getProviderName(): string {
    switch (this.provider) {
      case 'tingwu':
        return '通义听悟';
      case 'webspeech':
        return '浏览器语音识别';
      case 'offline':
        return '离线模式';
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 启动通义听悟
   */
  private async startTingwu(): Promise<boolean> {
    const tingwuCallbacks: TingwuCallbacks = {
      onTranscript: (segment) => {
        this.callbacks.onTranscript?.(segment);
      },
      onInterim: (text) => {
        this.callbacks.onInterim?.(text);
      },
      onError: (error) => {
        this.callbacks.onError?.(error);
        // 降级到 Web Speech API
        this.fallbackToWebSpeech();
      },
      onStatusChange: (status) => {
        if (status === 'transcribing') {
          this.callbacks.onStatusChange?.('listening');
        } else if (status === 'error') {
          this.callbacks.onStatusChange?.('error');
        }
      },
    };

    this.tingwuClient = new TingwuClient(this.sessionId, tingwuCallbacks);
    
    const taskCreated = await this.tingwuClient.createTask();
    if (!taskCreated) {
      console.warn('Failed to create Tingwu task, falling back to WebSpeech');
      return this.fallbackToWebSpeech();
    }

    const connected = await this.tingwuClient.connect();
    if (!connected) {
      console.warn('Failed to connect Tingwu WebSocket, falling back to WebSpeech');
      return this.fallbackToWebSpeech();
    }

    this.callbacks.onStatusChange?.('listening');
    return true;
  }

  /**
   * 启动 Web Speech API
   */
  private startWebSpeech(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionConstructor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) {
      this.callbacks.onError?.('浏览器不支持语音识别');
      return false;
    }

    try {
      this.webSpeechRecognition = new SpeechRecognitionConstructor() as SpeechRecognitionType;
      this.webSpeechRecognition.lang = this.config.language || 'zh-CN';
      this.webSpeechRecognition.continuous = this.config.continuous ?? true;
      this.webSpeechRecognition.interimResults = true;

      this.webSpeechRecognition.onstart = () => {
        this.callbacks.onStatusChange?.('listening');
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.webSpeechRecognition.onresult = (event: any) => {
        const results = event.results;
        const lastResult = results[results.length - 1];
        const transcript = lastResult[0].transcript;
        const isFinal = lastResult.isFinal;

        if (isFinal) {
          const segment: TranscriptSegment = {
            id: `seg-${this.sessionId}-${this.segmentIndex++}`,
            text: transcript,
            startMs: Date.now() - this.startTime - 2000,
            endMs: Date.now() - this.startTime,
            confidence: lastResult[0].confidence || 0.9,
            isFinal: true,
          };
          this.callbacks.onTranscript?.(segment);
        } else {
          this.callbacks.onInterim?.(transcript);
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.webSpeechRecognition.onerror = (event: any) => {
        console.error('WebSpeech error:', event.error);
        
        if (event.error === 'no-speech') {
          // 静默，继续监听
          return;
        }
        
        this.callbacks.onError?.(`语音识别错误: ${event.error}`);
        this.callbacks.onStatusChange?.('error');
      };

      this.webSpeechRecognition.onend = () => {
        // 如果是连续模式，自动重启
        if (this.config.continuous && this.webSpeechRecognition) {
          try {
            this.webSpeechRecognition.start();
          } catch {
            // 忽略重启错误
          }
        }
      };

      this.webSpeechRecognition.start();
      return true;
    } catch (error) {
      console.error('Failed to start WebSpeech:', error);
      this.callbacks.onError?.('启动语音识别失败');
      return false;
    }
  }

  /**
   * 降级到 Web Speech API
   */
  private async fallbackToWebSpeech(): Promise<boolean> {
    if (this.tingwuClient) {
      await this.tingwuClient.stop();
      this.tingwuClient = null;
    }

    this.provider = 'webspeech';
    this.callbacks.onProviderChange?.(this.provider);
    
    return this.startWebSpeech();
  }
}

/**
 * 创建语音服务实例
 */
export function createSpeechService(
  sessionId: string,
  callbacks?: SpeechServiceCallbacks,
  config?: SpeechServiceConfig
): SpeechService {
  return new SpeechService(sessionId, callbacks, config);
}

/**
 * 检查语音识别支持情况
 */
export async function checkSpeechSupport(): Promise<{
  tingwu: boolean;
  webSpeech: boolean;
  recommended: SpeechProvider;
}> {
  const providers = await SpeechService.detectAvailableProviders();
  
  return {
    tingwu: providers.includes('tingwu'),
    webSpeech: providers.includes('webspeech'),
    recommended: providers[0] || 'offline',
  };
}
