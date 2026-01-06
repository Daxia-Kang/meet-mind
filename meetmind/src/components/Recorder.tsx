'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { TingwuClient, tingwuService, type TranscriptSegment } from '@/lib/services/tingwu-service';

interface RecorderProps {
  onRecordingStart?: (sessionId: string) => void;
  onRecordingStop?: () => void;
  onTranscriptUpdate?: (segments: TranscriptSegment[]) => void;
  onAnchorMark?: (timestamp: number) => void;
  disabled?: boolean;
}

type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';
type ServiceStatus = 'checking' | 'available' | 'unavailable';

export function Recorder({
  onRecordingStart,
  onRecordingStop,
  onTranscriptUpdate,
  onAnchorMark,
  disabled = false,
}: RecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const tingwuClientRef = useRef<TingwuClient | null>(null);
  const sessionIdRef = useRef<string>('');
  const lastAnchorTimeRef = useRef<number>(0);

  // 检查通义听悟服务是否可用
  useEffect(() => {
    const checkService = async () => {
      const available = await tingwuService.isAvailable();
      setServiceStatus(available ? 'available' : 'unavailable');
    };
    checkService();
  }, []);

  // 格式化时间
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
    }
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  };

  // 处理转写结果（最终结果）
  const handleTranscript = useCallback((segment: TranscriptSegment) => {
    console.log('[Recorder] Final transcript:', segment.text);
    setTranscript(prev => {
      const updated = [...prev, segment];
      onTranscriptUpdate?.(updated);
      return updated;
    });
    setInterimText(''); // 清除中间结果
  }, [onTranscriptUpdate]);

  // 处理中间结果（实时显示）
  const handleInterim = useCallback((text: string, index: number) => {
    console.log('[Recorder] Interim result:', text, 'index:', index);
    setInterimText(text);
  }, []);

  // 处理错误
  const handleError = useCallback((errorMsg: string) => {
    console.error('Tingwu error:', errorMsg);
    // 不中断录音，只记录错误
    if (errorMsg.includes('Concurrency exceed')) {
      setError('通义听悟并发超限，转写功能暂时不可用');
    }
  }, []);

  // 开始录音
  const startRecording = async () => {
    try {
      setError(null);

      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 创建音频分析器
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // 音量监测
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const checkLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setLevel(average / 255);
        animationIdRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();

      // 生成会话 ID
      sessionIdRef.current = `session-${Date.now()}`;

      // 创建通义听悟客户端（如果服务可用）
      if (serviceStatus === 'available') {
        tingwuClientRef.current = tingwuService.createClient(sessionIdRef.current, {
          onTranscript: handleTranscript,
          onInterim: handleInterim,
          onError: handleError,
          onStatusChange: (status) => {
            console.log('Tingwu status:', status);
          },
        });

        // 创建任务（会自动建立 WebSocket 连接）
        const taskCreated = await tingwuClientRef.current.createTask();
        if (taskCreated) {
          // WebSocket 模式下不需要轮询，startPolling 会自动判断
          // 如果后端不支持 WebSocket，会自动降级到轮询模式
          tingwuClientRef.current.startPolling(1000);
        }
      }

      // 创建 MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });

      // 处理音频数据
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && tingwuClientRef.current) {
          // 发送到通义听悟
          tingwuClientRef.current.sendAudio(event.data);
        }
      };

      // 每秒发送一次数据
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;

      // 开始计时
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      setStatus('recording');
      onRecordingStart?.(sessionIdRef.current);

    } catch (err) {
      setError(err instanceof Error ? err.message : '录音启动失败');
    }
  };

  // 暂停录音
  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setStatus('paused');
    }
  };

  // 继续录音
  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      const pausedTime = elapsedMs;
      startTimeRef.current = Date.now() - pausedTime;
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);
      setStatus('recording');
    }
  };

  // 停止录音
  const stopRecording = async () => {
    // 停止动画
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }

    // 停止计时
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 停止录音
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }

    // 关闭音频上下文
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 停止通义听悟
    if (tingwuClientRef.current) {
      await tingwuClientRef.current.stop();
      tingwuClientRef.current = null;
    }

    mediaRecorderRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setInterimText('');
    setStatus('stopped');
    onRecordingStop?.();
  };

  // 标记断点
  const markAnchor = useCallback(() => {
    if (status !== 'recording') return;
    
    const timestamp = elapsedMs;
    lastAnchorTimeRef.current = timestamp;
    onAnchorMark?.(timestamp);
    setCanUndo(true);

    // 5秒后取消撤销能力
    setTimeout(() => {
      setCanUndo(false);
    }, 5000);
  }, [status, elapsedMs, onAnchorMark]);

  // 清理
  useEffect(() => {
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (tingwuClientRef.current) {
        tingwuClientRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {/* 服务状态指示器 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            serviceStatus === 'checking' ? 'bg-yellow-500 animate-pulse' :
            serviceStatus === 'available' ? 'bg-green-500' :
            'bg-gray-400'
          }`} />
          <span className="text-xs text-gray-500">
            {serviceStatus === 'checking' ? '检查服务...' :
             serviceStatus === 'available' ? '通义听悟已连接' :
             '本地录音模式'}
          </span>
        </div>
        {serviceStatus === 'unavailable' && (
          <span className="text-xs text-orange-500">
            启动 Discussion 后端可启用实时转写
          </span>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 录音状态 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {/* 录音指示器 */}
          <div className={`w-4 h-4 rounded-full ${
            status === 'recording' ? 'bg-red-500 animate-pulse' :
            status === 'paused' ? 'bg-yellow-500' :
            status === 'stopped' ? 'bg-gray-400' :
            'bg-gray-300'
          }`} />
          
          {/* 时间显示 */}
          <span className="text-2xl font-mono font-bold text-gray-900">
            {formatTime(elapsedMs)}
          </span>
        </div>

        {/* 音量指示器 */}
        {status === 'recording' && (
          <div className="flex items-center gap-1">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className={`w-1 rounded-full transition-all ${
                  level * 10 > i ? 'bg-green-500' : 'bg-gray-200'
                }`}
                style={{ height: `${8 + i * 2}px` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 控制按钮 */}
      <div className="flex items-center justify-center gap-4 mb-6">
        {status === 'idle' && (
          <button
            onClick={startRecording}
            disabled={disabled}
            className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="6" />
            </svg>
            开始录音
          </button>
        )}

        {status === 'recording' && (
          <>
            <button
              onClick={pauseRecording}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-full hover:bg-yellow-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="5" y="4" width="3" height="12" rx="1" />
                <rect x="12" y="4" width="3" height="12" rx="1" />
              </svg>
              暂停
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              结束
            </button>
          </>
        )}

        {status === 'paused' && (
          <>
            <button
              onClick={resumeRecording}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 4l10 6-10 6V4z" />
              </svg>
              继续
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              结束
            </button>
          </>
        )}

        {status === 'stopped' && (
          <button
            onClick={() => {
              setStatus('idle');
              setElapsedMs(0);
              setTranscript([]);
              setInterimText('');
            }}
            className="flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            新录音
          </button>
        )}
      </div>

      {/* 断点标记按钮 */}
      {(status === 'recording' || status === 'paused') && (
        <div className="border-t border-gray-200 pt-4">
          <button
            onClick={markAnchor}
            disabled={status !== 'recording'}
            className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold text-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95"
          >
            🎯 我没听懂这里
          </button>
          <p className="text-center text-xs text-gray-400 mt-2">
            {canUndo ? '5秒内可撤销' : '按下标记困惑点'}
          </p>
        </div>
      )}

      {/* 实时转录预览 */}
      {(transcript.length > 0 || interimText) && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            实时转录
            {serviceStatus === 'available' && (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                通义听悟
              </span>
            )}
          </h4>
          <div className="max-h-32 overflow-y-auto text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            {transcript.slice(-5).map((seg) => (
              <p key={seg.id} className="mb-1">
                <span className="text-xs text-gray-400 mr-2">
                  {formatTime(seg.startMs)}
                </span>
                {seg.text}
              </p>
            ))}
            {interimText && (
              <p className="mb-1 text-gray-400 italic">
                <span className="text-xs mr-2">...</span>
                {interimText}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
