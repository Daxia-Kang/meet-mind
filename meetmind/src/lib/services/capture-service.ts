/**
 * 课堂采集服务 - 录音 + 实时转写
 * 
 * 复用 Discussion 项目的通义听悟能力
 * 支持浏览器端录音，通过 WebSocket 实时转写
 */

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence: number;
}

export interface CaptureSession {
  sessionId: string;
  status: 'idle' | 'recording' | 'paused' | 'stopped';
  startTime: number;
  elapsedMs: number;
  segments: TranscriptSegment[];
}

// Discussion 后端 API 地址
const DISCUSSION_API = process.env.NEXT_PUBLIC_DISCUSSION_API || 'http://localhost:4000';

/**
 * 课堂采集服务
 */
export const captureService = {
  /**
   * 创建录音会话
   */
  async createSession(lessonId: string): Promise<{ sessionId: string; wsUrl: string }> {
    const response = await fetch(`${DISCUSSION_API}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: lessonId,
        topic: `课堂录音 - ${lessonId}`,
      }),
    });

    if (!response.ok) {
      throw new Error('创建录音会话失败');
    }

    const data = await response.json();
    return {
      sessionId: data.sessionId,
      wsUrl: data.wsUrl || `ws://localhost:4000/audio/${data.sessionId}`,
    };
  },

  /**
   * 停止录音会话
   */
  async stopSession(sessionId: string): Promise<void> {
    await fetch(`${DISCUSSION_API}/session/${sessionId}/stop`, {
      method: 'POST',
    });
  },

  /**
   * 获取转写结果
   */
  async getTranscript(sessionId: string): Promise<TranscriptSegment[]> {
    const response = await fetch(`${DISCUSSION_API}/session/${sessionId}/transcript`);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data.segments || [];
  },
};

/**
 * 浏览器端录音 Hook 的类型定义
 */
export interface RecorderState {
  status: 'idle' | 'recording' | 'paused' | 'stopped';
  elapsedMs: number;
  level: number;  // 音量级别 0-1
}

export interface RecorderActions {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * 创建 MediaRecorder 实例（浏览器端）
 */
export function createBrowserRecorder(
  onAudioChunk: (chunk: Blob) => void,
  onLevelChange?: (level: number) => void
): {
  start: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
} {
  let mediaRecorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let animationId: number | null = null;

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // 创建音频分析器（用于显示音量）
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // 音量监测
    if (onLevelChange) {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkLevel = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        onLevelChange(average / 255);
        animationId = requestAnimationFrame(checkLevel);
      };
      checkLevel();
    }

    // 创建 MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 64000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        onAudioChunk(event.data);
      }
    };

    // 每秒发送一次数据
    mediaRecorder.start(1000);
  };

  const stop = () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    mediaRecorder = null;
    analyser = null;
  };

  const pause = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
    }
  };

  const resume = () => {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
    }
  };

  return { start, stop, pause, resume };
}
