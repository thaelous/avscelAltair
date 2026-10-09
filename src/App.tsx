/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { WebGLVideoRenderer, ShaderUniforms } from './lib/webglRenderer.ts';

export type TransitionType = 'none' | 'fade-black' | 'crossfade' | 'flash' | 'wipe';

export interface TransitionInfo {
  type: TransitionType;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const TRANSITION_TYPES: TransitionInfo[] = [
  {
    type: 'none',
    label: 'Corte directo',
    icon: 'fa-scissors',
    color: 'text-gray-400',
    description: 'Sin transición (cambio inmediato)',
  },
  {
    type: 'fade-black',
    label: 'Fundido a Negro',
    icon: 'fa-circle-half-stroke',
    color: 'text-amber-400',
    description: 'Desvanecimiento suave a negro y reaparición en GPU',
  },
  {
    type: 'crossfade',
    label: 'Desvanecimiento',
    icon: 'fa-shuffle',
    color: 'text-cyan-400',
    description: 'Disolución y fusión suave entre clips',
  },
  {
    type: 'flash',
    label: 'Destello Blanco',
    icon: 'fa-bolt',
    color: 'text-yellow-300',
    description: 'Destello de brillo en el cambio de plano',
  },
  {
    type: 'wipe',
    label: 'Cortinilla',
    icon: 'fa-table-columns',
    color: 'text-emerald-400',
    description: 'Barrido lateral hacia el nuevo segmento',
  },
];

export interface Clip {
  id: string;
  startInSource: number;
  endInSource: number;
  duration: number;
  grad: string;
  transition?: TransitionType;
  transitionDuration?: number;
}

interface EffectsState {
  wave: boolean;
  waveAmp: number;
  fisheye: boolean;
  fisheyeStrength: number;
  sepia: boolean;
  sepiaVal: number;
  glitch: boolean;
  glitchShift: number;
  pixelate: boolean;
  pixelSize: number;
  bw: boolean;
  invert: boolean;
  vignette: boolean;
}

interface TitleState {
  enabled: boolean;
  text: string;
  color: string;
  position: 'top' | 'center' | 'bottom';
  bg: boolean;
}

type TabType = 'panel-timeline' | 'panel-effects' | 'panel-edit' | 'panel-text' | 'panel-adjust';

export default function App() {
  // Estado de reproducción y tiempo
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [sourceDuration, setSourceDuration] = useState<number>(8);
  const [sourceLoaded, setSourceLoaded] = useState<boolean>(false);

  // Clips y edición
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [copiedClip, setCopiedClip] = useState<Clip | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);

  // Interfaz y Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>('panel-timeline');
  const [currentRatio, setCurrentRatio] = useState<'16:9' | '9:16'>('16:9');

  // Ajustes de imagen
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);

  // Efectos FX
  const [effects, setEffects] = useState<EffectsState>({
    wave: false,
    waveAmp: 16,
    fisheye: false,
    fisheyeStrength: 1.8,
    sepia: false,
    sepiaVal: 0.8,
    glitch: false,
    glitchShift: 12,
    pixelate: false,
    pixelSize: 14,
    bw: false,
    invert: false,
    vignette: false,
  });

  // Título
  const [title, setTitle] = useState<TitleState>({
    enabled: true,
    text: 'AVS Mobile Studio',
    color: '#00f0ff',
    position: 'bottom',
    bg: true,
  });

  // Exportación
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);

  // Transiciones entre clips
  const [transitionModalOpen, setTransitionModalOpen] = useState<boolean>(false);
  const [transitionTargetIndex, setTransitionTargetIndex] = useState<number | null>(null);
  const [transitionDurationInput, setTransitionDurationInput] = useState<number>(0.6);

  // Toast
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // PWA install prompt & Offline State
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Referencias DOM y Hardware
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // GPU & Memory Management Refs
  const webglRendererRef = useRef<WebGLVideoRenderer | null>(null);
  const videoBlobUrlRef = useRef<string | null>(null);
  const activeClipIdRef = useRef<string | null>(null);
  const videoFrameCallbackHandleRef = useRef<number | null>(null);

  // Refs de estado para bucle de animación
  const stateRef = useRef({
    currentTime: 0,
    isPlaying: false,
    isLooping: false,
    playbackRate: 1.0,
    clips: [] as Clip[],
    effects,
    title,
    brightness: 100,
    contrast: 100,
    sourceDuration: 8,
    sourceLoaded: false,
    isExporting: false,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const exportIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimeLoopRef = useRef<number>(performance.now());
  const isTouchScrubbingRef = useRef<boolean>(false);

  // Actualizar stateRef con los últimos valores
  useEffect(() => {
    stateRef.current.currentTime = currentTime;
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.isLooping = isLooping;
    stateRef.current.playbackRate = playbackRate;
    stateRef.current.clips = clips;
    stateRef.current.effects = effects;
    stateRef.current.title = title;
    stateRef.current.brightness = brightness;
    stateRef.current.contrast = contrast;
    stateRef.current.sourceDuration = sourceDuration;
    stateRef.current.sourceLoaded = sourceLoaded;
    stateRef.current.isExporting = isExporting;
  }, [
    currentTime,
    isPlaying,
    isLooping,
    playbackRate,
    clips,
    effects,
    title,
    brightness,
    contrast,
    sourceDuration,
    sourceLoaded,
    isExporting,
  ]);

  // Listener de conectividad para PWA Offline
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 1800);
  }, []);

  const getProjectDuration = useCallback(() => {
    return clips.reduce((acc, c) => acc + c.duration, 0);
  }, [clips]);

  const formatTime = (sec: number) => {
    if (isNaN(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
  };

  const getClipAt = (time: number, clipList: Clip[]) => {
    let accum = 0;
    for (const clip of clipList) {
      if (time >= accum && time <= accum + clip.duration) {
        return { clip, localTime: time - accum, offset: accum };
      }
      accum += clip.duration;
    }
    return null;
  };

  // Renderizador GPU acelerado con WebGL (60 FPS sin sobrecarga de CPU)
  const renderCurrentFrame = useCallback(() => {
    const previewCanvas = previewCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const video = hiddenVideoRef.current;
    if (!previewCanvas) return;

    // Inicializar WebGL Renderer bajo demanda
    if (!webglRendererRef.current || !webglRendererRef.current.isReady) {
      webglRendererRef.current = new WebGLVideoRenderer(previewCanvas);
    }

    const renderer = webglRendererRef.current;
    const curState = stateRef.current;

    // Calcular parámetros de transición entre clips adyacentes
    let transType = 0;
    let transProgress = 0;
    let accumTime = 0;
    for (let i = 0; i < curState.clips.length - 1; i++) {
      const clipA = curState.clips[i];
      accumTime += clipA.duration;
      if (clipA.transition && clipA.transition !== 'none') {
        const tDur = clipA.transitionDuration || 0.6;
        const diff = curState.currentTime - accumTime;
        if (diff >= -tDur / 2 && diff <= tDur / 2) {
          transProgress = Math.max(0, Math.min(1, (diff + tDur / 2) / tDur));
          if (clipA.transition === 'fade-black') transType = 1;
          else if (clipA.transition === 'flash') transType = 2;
          else if (clipA.transition === 'wipe') transType = 3;
          else if (clipA.transition === 'crossfade') transType = 4;
          break;
        }
      }
    }

    const uniforms: ShaderUniforms = {
      time: performance.now() * 0.001,
      brightness: curState.brightness / 100,
      contrast: curState.contrast / 100,
      fxWave: curState.effects.wave,
      waveAmp: curState.effects.waveAmp,
      fxFisheye: curState.effects.fisheye,
      fisheyeStrength: curState.effects.fisheyeStrength,
      fxSepia: curState.effects.sepia,
      sepiaVal: curState.effects.sepiaVal,
      fxGlitch: curState.effects.glitch,
      glitchShift: curState.effects.glitchShift,
      fxPixelate: curState.effects.pixelate,
      pixelSize: curState.effects.pixelSize,
      fxBw: curState.effects.bw,
      fxInvert: curState.effects.invert,
      fxVignette: curState.effects.vignette,
      transType,
      transProgress,
    };

    if (curState.sourceLoaded && video && video.readyState >= 2) {
      renderer.render(video, previewCanvas.width, previewCanvas.height, uniforms);
    }

    // Renderizar capa de título vectorial transparente en Overlay Canvas (sin CPU bottleneck)
    if (overlayCanvas) {
      const oCtx = overlayCanvas.getContext('2d');
      if (oCtx) {
        oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        if (curState.title.enabled && curState.title.text.trim()) {
          const t = curState.title;
          oCtx.save();
          oCtx.font = "bold 24px 'Plus Jakarta Sans', sans-serif";
          oCtx.textAlign = 'center';

          let py = overlayCanvas.height - 45;
          if (t.position === 'top') py = 50;
          if (t.position === 'center') py = overlayCanvas.height / 2;

          const metrics = oCtx.measureText(t.text);
          const pad = 12;

          if (t.bg) {
            oCtx.fillStyle = 'rgba(7, 8, 12, 0.85)';
            oCtx.fillRect(
              (overlayCanvas.width - metrics.width) / 2 - pad,
              py - 22,
              metrics.width + pad * 2,
              32
            );
          }

          oCtx.shadowColor = 'rgba(0,0,0,0.85)';
          oCtx.shadowBlur = 6;
          oCtx.fillStyle = t.color;
          oCtx.fillText(t.text, overlayCanvas.width / 2, py);
          oCtx.restore();
        }
      }
    }
  }, []);

  // Sincronización precisa y salto automático entre cortes de video
  const syncPlayback = useCallback(
    (targetTime: number) => {
      const video = hiddenVideoRef.current;
      if (!stateRef.current.sourceLoaded || !video) return;

      const match = getClipAt(targetTime, stateRef.current.clips);
      if (match) {
        const sourcePos = match.clip.startInSource + match.localTime;
        // Salto automático entre cortes o cuando diverge el tiempo del clip activo
        if (
          activeClipIdRef.current !== match.clip.id ||
          Math.abs(video.currentTime - sourcePos) > 0.08
        ) {
          activeClipIdRef.current = match.clip.id;
          video.currentTime = Math.min(sourcePos, stateRef.current.sourceDuration);
        }
      }
      renderCurrentFrame();
    },
    [renderCurrentFrame]
  );

  // Callback de decodificación de hardware de video (requestVideoFrameCallback)
  const onVideoFrameDecoded = useCallback(() => {
    if (stateRef.current.isPlaying) {
      renderCurrentFrame();
      const video = hiddenVideoRef.current;
      if (video && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        videoFrameCallbackHandleRef.current = (video as any).requestVideoFrameCallback(
          onVideoFrameDecoded
        );
      }
    }
  }, [renderCurrentFrame]);

  // Bucle de reproducción principal
  useEffect(() => {
    let animId: number;

    const loop = (timestamp: number) => {
      if (stateRef.current.isPlaying) {
        const delta = (timestamp - lastTimeLoopRef.current) / 1000;
        lastTimeLoopRef.current = timestamp;

        const totalDur = stateRef.current.clips.reduce((acc, c) => acc + c.duration, 0);
        let nextTime = stateRef.current.currentTime + delta * stateRef.current.playbackRate;

        if (nextTime >= totalDur) {
          if (stateRef.current.isLooping) {
            nextTime = 0;
          } else {
            nextTime = totalDur;
            setIsPlaying(false);
            const video = hiddenVideoRef.current;
            if (video) video.pause();
          }
        }

        setCurrentTime(nextTime);
        syncPlayback(nextTime);

        // Fallback si requestVideoFrameCallback no está disponible
        if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
          renderCurrentFrame();
        }
      } else {
        lastTimeLoopRef.current = timestamp;
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [syncPlayback, renderCurrentFrame]);

  // Cargar video desde blob / url con gestión estricta de memoria
  const loadVideoMedia = useCallback((url: string, name = 'Video') => {
    const video = hiddenVideoRef.current;
    if (!video) return;

    // Liberar URL previa para evitar fugas de memoria
    if (videoBlobUrlRef.current && videoBlobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(videoBlobUrlRef.current);
    }
    videoBlobUrlRef.current = url;

    video.src = url;
    video.onloadedmetadata = () => {
      const dur = video.duration || 8;
      setSourceDuration(dur);
      setSourceLoaded(true);

      const half = Number((dur / 2).toFixed(2));
      const initialClips: Clip[] = [
        {
          id: 'clip-1',
          startInSource: 0,
          endInSource: half,
          duration: half,
          grad: 'from-cyan-600 to-blue-700',
          transition: 'fade-black',
          transitionDuration: 0.6,
        },
        {
          id: 'clip-2',
          startInSource: half,
          endInSource: dur,
          duration: Number((dur - half).toFixed(2)),
          grad: 'from-purple-600 to-pink-700',
          transition: 'none',
          transitionDuration: 0.6,
        },
      ];

      setClips(initialClips);
      setSelectedClipId(initialClips[0].id);
      activeClipIdRef.current = initialClips[0].id;
      setCurrentTime(0);
      syncPlayback(0);
      showToast(`"${name}" cargado`);
    };
  }, [showToast, syncPlayback]);

  // Generador dinámico de video demo
  const generateMobileDemoVideo = useCallback(() => {
    const demoC = document.createElement('canvas');
    demoC.width = 640;
    demoC.height = 360;
    const dCtx = demoC.getContext('2d');
    if (!dCtx) return;

    const stream = demoC.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    const chunks: Blob[] = [];
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      const t = frame / 30;

      const grad = dCtx.createLinearGradient(0, 0, 640, 360);
      grad.addColorStop(0, `hsl(${(t * 40) % 360}, 85%, 22%)`);
      grad.addColorStop(1, `hsl(${((t * 40) + 130) % 360}, 90%, 12%)`);
      dCtx.fillStyle = grad;
      dCtx.fillRect(0, 0, 640, 360);

      for (let i = 0; i < 4; i++) {
        const x = 320 + Math.sin(t * 2 + i * 1.5) * (180 - i * 30);
        const y = 180 + Math.cos(t * 2.2 + i * 1.5) * (90 - i * 15);
        dCtx.beginPath();
        dCtx.arc(x, y, 26 + i * 6, 0, Math.PI * 2);
        dCtx.fillStyle = `hsla(${((i * 80) + t * 50) % 360}, 95%, 65%, 0.85)`;
        dCtx.fill();
      }

      dCtx.fillStyle = '#ffffff';
      dCtx.font = 'bold 24px sans-serif';
      dCtx.textAlign = 'center';
      dCtx.fillText('AVS MOBILE STUDIO', 320, 160);

      dCtx.fillStyle = '#00f0ff';
      dCtx.font = 'bold 15px monospace';
      dCtx.fillText(`T = ${t.toFixed(1)}s | WEBGL GPU ACCEL`, 320, 195);
    }, 1000 / 30);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      clearInterval(timer);
      const blob = new Blob(chunks, { type: 'video/webm' });
      loadVideoMedia(URL.createObjectURL(blob), 'Demo Android GPU');
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, 8000);
  }, [loadVideoMedia]);

  // Carga inicial y captura de instalación PWA
  useEffect(() => {
    generateMobileDemoVideo();

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [generateMobileDemoVideo]);

  // Redibujar en cambios de efectos o aspecto
  useEffect(() => {
    renderCurrentFrame();
  }, [effects, brightness, contrast, title, currentRatio, renderCurrentFrame]);

  // Controles de reproducción con requestVideoFrameCallback
  const handlePlay = () => {
    if (!sourceLoaded) {
      showToast('Carga un video primero');
      return;
    }
    const totalDur = getProjectDuration();
    if (currentTime >= totalDur) {
      setCurrentTime(0);
      syncPlayback(0);
    }
    const video = hiddenVideoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
      video.play().catch(() => {});
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        videoFrameCallbackHandleRef.current = (video as any).requestVideoFrameCallback(
          onVideoFrameDecoded
        );
      }
    }
    lastTimeLoopRef.current = performance.now();
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
    const video = hiddenVideoRef.current;
    if (video) {
      video.pause();
      if (
        videoFrameCallbackHandleRef.current !== null &&
        'cancelVideoFrameCallback' in HTMLVideoElement.prototype
      ) {
        (video as any).cancelVideoFrameCallback(videoFrameCallbackHandleRef.current);
        videoFrameCallbackHandleRef.current = null;
      }
    }
  };

  const togglePlayPause = () => {
    if (isPlaying) handlePause();
    else handlePlay();
  };

  const handleJumpStart = () => {
    setCurrentTime(0);
    syncPlayback(0);
  };

  const handlePrevFrame = () => {
    handlePause();
    const newT = Math.max(0, currentTime - 1 / 30);
    setCurrentTime(newT);
    syncPlayback(newT);
  };

  const handleNextFrame = () => {
    handlePause();
    const newT = Math.min(getProjectDuration(), currentTime + 1 / 30);
    setCurrentTime(newT);
    syncPlayback(newT);
  };

  const toggleRatio = () => {
    const next = currentRatio === '16:9' ? '9:16' : '16:9';
    setCurrentRatio(next);
    showToast(next === '9:16' ? 'Formato Vertical 9:16' : 'Formato Panorámico 16:9');
  };

  // CREAR NUEVO PROYECTO (Limpia memoria y revoca ObjectURLs para evitar lag)
  const handleNewProject = () => {
    handlePause();
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.pause();
      hiddenVideoRef.current.src = '';
    }

    if (videoBlobUrlRef.current && videoBlobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(videoBlobUrlRef.current);
      videoBlobUrlRef.current = null;
    }

    setClips([]);
    setSelectedClipId(null);
    setCopiedClip(null);
    setCurrentTime(0);
    setSourceLoaded(false);
    setSourceDuration(8);
    activeClipIdRef.current = null;

    setEffects({
      wave: false,
      waveAmp: 16,
      fisheye: false,
      fisheyeStrength: 1.8,
      sepia: false,
      sepiaVal: 0.8,
      glitch: false,
      glitchShift: 12,
      pixelate: false,
      pixelSize: 14,
      bw: false,
      invert: false,
      vignette: false,
    });
    setBrightness(100);
    setContrast(100);

    if (overlayCanvasRef.current) {
      const oCtx = overlayCanvasRef.current.getContext('2d');
      if (oCtx) oCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }

    showToast('Nuevo proyecto creado. Memoria liberada.');
  };

  // Edición de clips
  const handleSplit = () => {
    const match = getClipAt(currentTime, clips);
    if (!match) {
      showToast('Ubica el cabezal sobre un clip');
      return;
    }
    const { clip, localTime } = match;
    if (localTime < 0.2 || clip.duration - localTime < 0.2) {
      showToast('Corte muy cercano al extremo');
      return;
    }

    const splitPoint = clip.startInSource + localTime;
    const idx = clips.findIndex((c) => c.id === clip.id);

    const partA: Clip = {
      id: `clip-${Date.now()}-a`,
      startInSource: clip.startInSource,
      endInSource: splitPoint,
      duration: Number((splitPoint - clip.startInSource).toFixed(2)),
      grad: clip.grad,
      transition: 'none',
      transitionDuration: 0.6,
    };

    const partB: Clip = {
      id: `clip-${Date.now()}-b`,
      startInSource: splitPoint,
      endInSource: clip.endInSource,
      duration: Number((clip.endInSource - splitPoint).toFixed(2)),
      grad: 'from-amber-600 to-rose-700',
      transition: clip.transition || 'none',
      transitionDuration: clip.transitionDuration || 0.6,
    };

    const nextClips = [...clips];
    nextClips.splice(idx, 1, partA, partB);
    setClips(nextClips);
    setSelectedClipId(partB.id);
    showToast('¡Segmento dividido (Split)!');
  };

  const handleCopy = () => {
    const target = clips.find((c) => c.id === selectedClipId);
    if (!target) {
      showToast('Selecciona un clip primero');
      return;
    }
    setCopiedClip({ ...target });
    showToast('Segmento copiado');
  };

  const handlePaste = () => {
    if (!copiedClip) {
      showToast('Portapapeles vacío');
      return;
    }
    const clone: Clip = {
      ...copiedClip,
      id: `clip-${Date.now()}`,
      grad: 'from-emerald-600 to-cyan-700',
    };
    const idx = clips.findIndex((c) => c.id === selectedClipId);
    const nextClips = [...clips];
    if (idx !== -1) {
      nextClips.splice(idx + 1, 0, clone);
    } else {
      nextClips.push(clone);
    }
    setClips(nextClips);
    setSelectedClipId(clone.id);
    showToast('Segmento pegado');
  };

  const handleDeleteClip = (clipId: string) => {
    if (clips.length <= 1) {
      showToast('Conserva al menos un segmento');
      return;
    }
    const idx = clips.findIndex((c) => c.id === clipId);
    if (idx !== -1) {
      const nextClips = [...clips];
      nextClips.splice(idx, 1);
      setClips(nextClips);
      setSelectedClipId(nextClips[Math.max(0, idx - 1)].id);

      const totalDur = nextClips.reduce((acc, c) => acc + c.duration, 0);
      if (currentTime > totalDur) {
        setCurrentTime(totalDur);
        syncPlayback(totalDur);
      }
      showToast('Segmento borrado');
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedClipId) {
      showToast('Selecciona un segmento');
      return;
    }
    handleDeleteClip(selectedClipId);
  };

  const handleDuplicate = () => {
    const target = clips.find((c) => c.id === selectedClipId);
    if (!target) {
      showToast('Selecciona un segmento');
      return;
    }
    const clone: Clip = {
      ...target,
      id: `clip-${Date.now()}`,
      grad: 'from-indigo-600 to-cyan-700',
    };
    const idx = clips.findIndex((c) => c.id === selectedClipId);
    const nextClips = [...clips];
    nextClips.splice(idx + 1, 0, clone);
    setClips(nextClips);
    setSelectedClipId(clone.id);
    showToast('Segmento duplicado');
  };

  const handleResetClips = () => {
    if (!sourceLoaded) return;
    const initialClip: Clip = {
      id: `clip-${Date.now()}`,
      startInSource: 0,
      endInSource: sourceDuration,
      duration: sourceDuration,
      grad: 'from-cyan-600 to-blue-700',
      transition: 'none',
      transitionDuration: 0.6,
    };
    setClips([initialClip]);
    setSelectedClipId(initialClip.id);
    activeClipIdRef.current = initialClip.id;
    showToast('Pistas restablecidas');
  };

  const openTransitionPicker = (clipIndex: number) => {
    if (clipIndex < 0 || clipIndex >= clips.length) return;
    setTransitionTargetIndex(clipIndex);
    const curTransDur = clips[clipIndex].transitionDuration || 0.6;
    setTransitionDurationInput(curTransDur);
    setTransitionModalOpen(true);
  };

  const applyTransition = (
    clipIndex: number,
    type: TransitionType,
    duration = transitionDurationInput
  ) => {
    if (clipIndex < 0 || clipIndex >= clips.length) return;
    const updated = [...clips];
    updated[clipIndex] = {
      ...updated[clipIndex],
      transition: type,
      transitionDuration: duration,
    };
    setClips(updated);
    renderCurrentFrame();
    const transName = TRANSITION_TYPES.find((t) => t.type === type)?.label || type;
    showToast(`Transición: ${transName}`);
  };

  const handleNudge = (delta: number) => {
    const target = clips.find((c) => c.id === selectedClipId);
    if (!target) return;
    const newDur = Number((target.duration + delta).toFixed(2));
    if (newDur < 0.3) {
      showToast('Duración mínima alcanzada');
      return;
    }
    const updatedClips = clips.map((c) => {
      if (c.id === selectedClipId) {
        return {
          ...c,
          duration: newDur,
          endInSource: c.startInSource + newDur,
        };
      }
      return c;
    });
    setClips(updatedClips);
  };

  // Timeline scrub por toque o clic
  const handleTimelineScrub = (clientX: number) => {
    const content = timelineContentRef.current;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    const pps = 45 * zoom;
    const offsetX = clientX - rect.left;
    const totalDur = getProjectDuration();
    const targetTime = Math.max(0, Math.min(offsetX / pps, totalDur));

    setCurrentTime(targetTime);
    syncPlayback(targetTime);
  };

  // Motor de Exportación con composición GPU + Título
  const startExport = () => {
    if (!sourceLoaded) {
      showToast('Carga un video primero');
      return;
    }
    handlePause();
    setIsExporting(true);
    setExportProgress(0);

    setCurrentTime(0);
    syncPlayback(0);

    const totalDur = getProjectDuration();
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = previewCanvas.width;
    exportCanvas.height = previewCanvas.height;
    const expCtx = exportCanvas.getContext('2d');
    if (!expCtx) return;

    const stream = exportCanvas.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    mediaRecorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      if (exportIntervalRef.current) clearInterval(exportIntervalRef.current);
      setIsExporting(false);

      const blob = new Blob(chunks, { type: 'video/webm' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `AVS_Pro_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      showToast('¡Video descargado con éxito!');
    };

    recorder.start(100);

    let progressTime = 0;
    exportIntervalRef.current = setInterval(() => {
      progressTime += 0.033;
      const prog = Math.min((progressTime / totalDur) * 100, 100);
      setExportProgress(Math.floor(prog));

      setCurrentTime(progressTime);
      syncPlayback(progressTime);

      if (previewCanvasRef.current) {
        expCtx.drawImage(previewCanvasRef.current, 0, 0, exportCanvas.width, exportCanvas.height);
      }
      if (overlayCanvasRef.current) {
        expCtx.drawImage(overlayCanvasRef.current, 0, 0, exportCanvas.width, exportCanvas.height);
      }

      if (progressTime >= totalDur) {
        if (exportIntervalRef.current) clearInterval(exportIntervalRef.current);
        if (recorder.state !== 'inactive') recorder.stop();
      }
    }, 33);
  };

  const cancelExport = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (exportIntervalRef.current) clearInterval(exportIntervalRef.current);
    setIsExporting(false);
    showToast('Exportación cancelada');
  };

  // PWA install trigger
  const handlePwaInstall = async () => {
    if (!installPromptEvent) {
      showToast('Usa "Añadir a pantalla de inicio" en tu navegador');
      return;
    }
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === 'accepted') {
      setInstallPromptEvent(null);
      showToast('¡Instalando AVS Studio!');
    }
  };

  // Valores de Timeline
  const pps = 45 * zoom;
  const totalDur = Math.max(getProjectDuration(), 8);
  const timelineWidth = Math.max(totalDur * pps + 120, 700);

  const selectedClip = clips.find((c) => c.id === selectedClipId);

  return (
    <div className="flex flex-col h-full overflow-hidden select-none bg-[#07080b] text-[#f1f5f9]">
      {/* BARRA SUPERIOR */}
      <header className="h-13 bg-[#10121a] border-b border-[#1f2231] px-2.5 flex items-center shrink-0 z-30 pt-safe">
        <div className="flex items-center gap-2 scroll-touch-x w-full py-1">
          {/* Logo AVS */}
          <div className="flex items-center gap-1.5 shrink-0 pr-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-black font-extrabold text-xs shadow-md shadow-cyan-500/25">
              <i className="fa-solid fa-scissors"></i>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xs font-bold tracking-tight text-white">AVS</span>
              <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/80 border border-cyan-800/80 px-1 py-0.2 rounded font-bold">
                PRO
              </span>
            </div>
          </div>

          {/* BOTÓN INSTALACIÓN ANDROID */}
          {installPromptEvent && (
            <button
              onClick={handlePwaInstall}
              className="touch-btn shrink-0 h-8 px-3 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/50 text-emerald-300 rounded-lg flex items-center gap-1.5 text-xs font-bold shadow-sm"
            >
              <i className="fa-brands fa-android text-emerald-400 text-sm"></i>
              <span className="text-[11px]">Instalar App</span>
            </button>
          )}

          {/* Botón Nuevo Proyecto */}
          <button
            onClick={handleNewProject}
            className="touch-btn shrink-0 h-8 px-2.5 bg-[#191c28] border border-[#2b2f44] text-rose-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm"
            title="Crear Nuevo Proyecto y liberar memoria"
          >
            <i className="fa-solid fa-file-circle-plus text-rose-400 text-xs"></i>
            <span className="text-[11px]">Nuevo</span>
          </button>

          {/* Selector Proporción 16:9 / 9:16 */}
          <button
            onClick={toggleRatio}
            className="touch-btn shrink-0 h-8 px-2.5 bg-[#191c28] border border-[#2b2f44] text-[11px] text-gray-200 font-mono rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            <i className="fa-solid fa-mobile-screen text-[10px] text-cyan-400"></i>
            <span>{currentRatio}</span>
          </button>

          {/* Botón Abrir Video */}
          <label className="touch-btn shrink-0 h-8 px-3 bg-[#191c28] border border-[#2b2f44] text-gray-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer shadow-sm">
            <i className="fa-solid fa-folder-open text-cyan-400 text-xs"></i>
            <span className="text-[11px]">Abrir</span>
            <input
              type="file"
              ref={fileInputRef}
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadVideoMedia(URL.createObjectURL(file), file.name);
              }}
            />
          </label>

          {/* Botón Demo Sintético */}
          <button
            onClick={() => {
              showToast('Sintetizando video demo...');
              generateMobileDemoVideo();
            }}
            className="touch-btn shrink-0 h-8 px-3 bg-indigo-950/90 border border-indigo-700/80 text-indigo-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm"
          >
            <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
            <span className="text-[11px]">Demo</span>
          </button>

          {/* Botón Guardar / Exportar */}
          <button
            onClick={startExport}
            className="touch-btn shrink-0 h-8 px-3.5 bg-gradient-to-r from-cyan-400 to-blue-500 text-black text-xs font-extrabold rounded-lg flex items-center gap-1.5 shadow-md shadow-cyan-400/25"
          >
            <i className="fa-solid fa-arrow-down-to-bracket text-xs"></i>
            <span className="text-[11px]">Guardar</span>
          </button>
        </div>
      </header>

      {/* AVISO MODO OFFLINE PWA */}
      {!isOnline && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 bg-amber-950/95 border border-amber-500/80 text-amber-200 text-[10px] font-bold px-3 py-1 rounded-full shadow-2xl z-40 flex items-center gap-1.5 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
          Modo Sin Conexión (PWA Offline Activo)
        </div>
      )}

      {/* VISOR DE VIDEO CON GPU WEBGL SHADERS */}
      <main className="relative flex-1 bg-[#06070a] flex flex-col items-center justify-between p-2 min-h-0 overflow-hidden">
        <div className="relative w-full flex-1 flex items-center justify-center min-h-0">
          <div
            className={`relative max-w-full max-h-full ${
              currentRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'
            } bg-black rounded-xl overflow-hidden shadow-2xl border border-[#1b1e2c] flex items-center justify-center transition-all duration-200`}
          >
            {/* Lienzo WebGL Acelerado por Hardware */}
            <canvas
              ref={previewCanvasRef}
              width={currentRatio === '16:9' ? 854 : 480}
              height={currentRatio === '16:9' ? 480 : 854}
              className="w-full h-full object-contain pointer-events-none"
            />
            {/* Lienzo Overlay para Capa de Titulación Vectorial */}
            <canvas
              ref={overlayCanvasRef}
              width={currentRatio === '16:9' ? 854 : 480}
              height={currentRatio === '16:9' ? 480 : 854}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
            />
            <video
              ref={hiddenVideoRef}
              className="hidden"
              playsInline
              webkit-playsinline="true"
              crossOrigin="anonymous"
            />

            {/* Botón Play/Pause central discreto */}
            <button
              onClick={togglePlayPause}
              className="touch-btn absolute inset-0 m-auto w-12 h-12 bg-black/60 border border-white/20 text-white rounded-full flex items-center justify-center transition-all shadow-xl z-20"
            >
              <i
                className={`fa-solid ${
                  isPlaying ? 'fa-pause' : 'fa-play ml-0.5'
                } text-base text-cyan-400`}
              ></i>
            </button>

            {/* Indicador REC animado durante exportación */}
            {isExporting && (
              <div className="absolute top-2.5 left-2.5 bg-rose-600 text-white text-[9px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1.5 shadow-lg animate-pulse z-30">
                <span className="w-1.5 h-1.5 rounded-full bg-white"></span> REC
              </div>
            )}

            {/* Timecode actual / total */}
            <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded-md border border-white/10 font-mono text-[10px] text-gray-200 z-30 flex items-center gap-1 pointer-events-none">
              <span className="text-cyan-400 font-bold">{formatTime(currentTime)}</span>
              <span className="text-gray-500">/</span>
              <span className="text-gray-400">{formatTime(getProjectDuration())}</span>
            </div>
          </div>
        </div>

        {/* Barra de Transporte de Reproducción */}
        <div className="w-full max-w-xs px-2 py-1 flex items-center justify-between text-xs shrink-0 mt-1">
          <button
            onClick={handleJumpStart}
            className="touch-btn w-9 h-8 rounded-lg bg-[#141622] border border-[#232637] flex items-center justify-center text-gray-300"
            title="Al Inicio"
          >
            <i className="fa-solid fa-backward-step text-xs"></i>
          </button>
          <button
            onClick={handlePrevFrame}
            className="touch-btn w-9 h-8 rounded-lg bg-[#141622] border border-[#232637] flex items-center justify-center text-gray-300"
            title="Frame Anterior"
          >
            <i className="fa-solid fa-chevron-left text-xs"></i>
          </button>
          <button
            onClick={togglePlayPause}
            className="touch-btn w-13 h-8 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-extrabold flex items-center justify-center shadow-lg shadow-cyan-400/20"
            title="Reproducir/Pausar"
          >
            <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play ml-0.5'} text-xs`}></i>
          </button>
          <button
            onClick={handleNextFrame}
            className="touch-btn w-9 h-8 rounded-lg bg-[#141622] border border-[#232637] flex items-center justify-center text-gray-300"
            title="Frame Siguiente"
          >
            <i className="fa-solid fa-chevron-right text-xs"></i>
          </button>
          <button
            onClick={() => {
              const next = !isLooping;
              setIsLooping(next);
              showToast(next ? 'Bucle activado' : 'Bucle desactivado');
            }}
            className={`touch-btn w-9 h-8 rounded-lg bg-[#141622] border border-[#232637] flex items-center justify-center ${
              isLooping ? 'text-cyan-400' : 'text-gray-400'
            }`}
            title="Bucle"
          >
            <i className="fa-solid fa-repeat text-xs"></i>
          </button>
        </div>
      </main>

      {/* CAJÓN INFERIOR COLAPSABLE */}
      <section
        id="bottomDrawer"
        style={{ maxHeight: isDrawerOpen ? '42vh' : '32px' }}
        className="bg-[#11131c] border-t border-[#1f2231] flex flex-col shrink-0 z-20 h-auto overflow-hidden transition-all duration-300"
      >
        {/* Encabezado del cajón */}
        <div className="h-8 px-3 bg-[#151722] border-b border-[#212435] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-200 uppercase tracking-wider">
            {activeTab === 'panel-timeline' && (
              <>
                <i className="fa-solid fa-timeline text-cyan-400 text-xs"></i> Línea de Tiempo
              </>
            )}
            {activeTab === 'panel-effects' && (
              <>
                <i className="fa-solid fa-wand-magic-sparkles text-cyan-400 text-xs"></i> Efectos FX (GPU Shaders)
              </>
            )}
            {activeTab === 'panel-edit' && (
              <>
                <i className="fa-solid fa-scissors text-cyan-400 text-xs"></i> Edición de Clips
              </>
            )}
            {activeTab === 'panel-text' && (
              <>
                <i className="fa-solid fa-heading text-cyan-400 text-xs"></i> Títulos y Texto
              </>
            )}
            {activeTab === 'panel-adjust' && (
              <>
                <i className="fa-solid fa-sliders text-cyan-400 text-xs"></i> Calibración & Velocidad
              </>
            )}
          </div>
          <button
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            className="touch-btn text-xs text-gray-300 px-2 py-0.5 rounded flex items-center gap-1 bg-[#1e212f] border border-[#2c3044]"
          >
            <span className="text-[10px]">{isDrawerOpen ? 'Ocultar' : 'Mostrar'}</span>
            <i
              className={`fa-solid fa-chevron-down text-[10px] transition-transform ${
                isDrawerOpen ? '' : 'rotate-180'
              }`}
            ></i>
          </button>
        </div>

        {/* Cuerpo del cajón */}
        <div className="flex-1 scroll-touch-y relative flex flex-col min-h-0">
          {/* PESTAÑA 1: TIMELINE */}
          {activeTab === 'panel-timeline' && (
            <div className="flex flex-col">
              {/* Barra de herramientas rápida */}
              <div className="h-9 px-2 bg-[#131520] border-b border-[#1f2231] flex items-center justify-between shrink-0 gap-1.5 overflow-x-auto scroll-touch-x">
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={handleSplit}
                    className="touch-btn h-7 px-2.5 bg-[#1b1e2b] border border-[#2a2f44] text-amber-400 rounded-md text-[10px] font-bold flex items-center gap-1 shadow-sm"
                  >
                    <i className="fa-solid fa-scissors"></i> Cortar
                  </button>
                  <button
                    onClick={handleCopy}
                    className="touch-btn h-7 px-2 bg-[#1b1e2b] border border-[#2a2f44] text-gray-200 rounded-md text-[10px] font-bold flex items-center gap-1 shadow-sm"
                  >
                    <i className="fa-regular fa-copy"></i> Copiar
                  </button>
                  <button
                    onClick={handlePaste}
                    className="touch-btn h-7 px-2 bg-[#1b1e2b] border border-[#2a2f44] text-emerald-400 rounded-md text-[10px] font-bold flex items-center gap-1 shadow-sm"
                  >
                    <i className="fa-regular fa-paste"></i> Pegar
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    className="touch-btn h-7 px-2.5 bg-rose-950/80 border border-rose-700/80 text-rose-300 rounded-md text-[10px] font-bold flex items-center gap-1 shadow-sm"
                  >
                    <i className="fa-solid fa-trash-can text-rose-400"></i> Borrar
                  </button>
                </div>

                <div className="flex items-center gap-1 shrink-0 bg-[#171a26] px-1.5 py-0.5 rounded-md border border-[#232738] ml-auto">
                  <span className="text-[9px] text-gray-400 font-mono">
                    <i className="fa-solid fa-magnifying-glass-plus text-[9px] text-cyan-400"></i>
                  </span>
                  <input
                    type="range"
                    min="0.6"
                    max="2.5"
                    step="0.1"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-16"
                  />
                </div>
              </div>

              {/* Área de clips interactiva */}
              <div
                ref={timelineContainerRef}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('.clip-delete-btn')) return;
                  handleTimelineScrub(e.clientX);
                }}
                className="relative overflow-x-auto overflow-y-hidden bg-[#0a0b11] touch-pan-x scroll-touch-x select-none min-h-[110px] py-1"
              >
                <div
                  ref={timelineContentRef}
                  style={{ width: `${timelineWidth}px` }}
                  className="relative h-full"
                >
                  {/* Regla graduada */}
                  <div className="h-5 border-b border-[#1c1e2b] relative text-[8px] font-mono text-gray-500 pointer-events-none">
                    {Array.from({ length: Math.ceil(totalDur) + 4 }).map((_, s) => (
                      <div
                        key={s}
                        className="absolute top-0 bottom-0 border-l border-[#1f2231] pl-1 text-[8px]"
                        style={{ left: `${s * pps}px` }}
                      >
                        {formatTime(s)}
                      </div>
                    ))}
                  </div>

                  {/* Pista de Video con clips y botón ✕ directo */}
                  <div className="h-16 relative py-1 px-1 flex items-center">
                    {clips.map((clip, idx) => {
                      const prevDur = clips
                        .slice(0, idx)
                        .reduce((acc, c) => acc + c.duration, 0);
                      const clipLeft = prevDur * pps;
                      const clipWidth = Math.max(clip.duration * pps, 24);
                      const isSelected = selectedClipId === clip.id;

                      return (
                        <React.Fragment key={clip.id}>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClipId(clip.id);
                            }}
                            style={{
                              left: `${clipLeft}px`,
                              width: `${clipWidth}px`,
                            }}
                            className={`clip-card touch-btn absolute top-1 bottom-1 rounded-lg bg-gradient-to-r ${
                              clip.grad
                            } border border-white/20 px-2 py-1 flex flex-col justify-between overflow-hidden cursor-pointer shadow ${
                              isSelected ? 'is-active' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] font-bold text-white truncate w-full gap-1">
                              <span className="truncate">#{idx + 1}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="font-mono text-[8px] bg-black/40 px-1 py-0.2 rounded text-cyan-300">
                                  {clip.duration.toFixed(1)}s
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClip(clip.id);
                                  }}
                                  className="clip-delete-btn touch-btn w-4 h-4 rounded bg-rose-600/90 text-white flex items-center justify-center text-[9px] hover:bg-rose-500 shadow"
                                  title="Eliminar este segmento"
                                >
                                  <i className="fa-solid fa-xmark"></i>
                                </button>
                              </div>
                            </div>

                            <div className="h-1.5 flex items-end gap-0.5 opacity-40 overflow-hidden pointer-events-none">
                              {Array.from({
                                length: Math.min(Math.floor(clipWidth / 5), 32),
                              }).map((_, i) => (
                                <div
                                  key={i}
                                  className="w-0.5 bg-white rounded-full"
                                  style={{ height: `${(i % 5) + 2}px` }}
                                />
                              ))}
                            </div>
                          </div>

                          {/* Icono interactivo de Transición entre clips */}
                          {idx < clips.length - 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openTransitionPicker(idx);
                              }}
                              style={{
                                left: `${clipLeft + clipWidth}px`,
                              }}
                              className={`touch-btn absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-6 h-6 rounded-md flex items-center justify-center border shadow-md transition-all ${
                                clip.transition && clip.transition !== 'none'
                                  ? 'bg-[#0e111b] border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(0,240,255,0.45)]'
                                  : 'bg-[#151824]/90 border-gray-600/60 text-gray-400 hover:border-gray-400'
                              }`}
                              title={`Transición hacia Clip #${idx + 2}`}
                            >
                              {clip.transition === 'fade-black' && (
                                <i className="fa-solid fa-circle-half-stroke text-[11px] text-amber-400"></i>
                              )}
                              {clip.transition === 'crossfade' && (
                                <i className="fa-solid fa-shuffle text-[11px] text-cyan-400"></i>
                              )}
                              {clip.transition === 'flash' && (
                                <i className="fa-solid fa-bolt text-[11px] text-yellow-300"></i>
                              )}
                              {clip.transition === 'wipe' && (
                                <i className="fa-solid fa-table-columns text-[11px] text-emerald-400"></i>
                              )}
                              {(!clip.transition || clip.transition === 'none') && (
                                <i className="fa-solid fa-hourglass-start text-[9px]"></i>
                              )}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {/* Pista de Título */}
                  <div className="h-5 relative px-1 bg-[#0f1118] border-t border-[#1a1d29] flex items-center">
                    <div
                      style={{
                        width: `${Math.min(
                          getProjectDuration() * pps,
                          timelineWidth
                        )}px`,
                      }}
                      className="h-3.5 bg-cyan-950/70 border border-cyan-500/50 rounded px-1.5 flex items-center text-[8px] text-cyan-300 truncate"
                    >
                      <i className="fa-solid fa-heading mr-1 text-[7px]"></i>
                      <span className="truncate">{title.text || 'Sin texto'}</span>
                    </div>
                  </div>

                  {/* Cabezal de Reproducción (Playhead) */}
                  <div
                    style={{ left: `${currentTime * pps}px` }}
                    className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-auto transition-none shadow-[0_0_8px_rgba(244,63,94,0.9)]"
                  >
                    <div
                      onTouchStart={() => {
                        isTouchScrubbingRef.current = true;
                        handlePause();
                      }}
                      onTouchMove={(e) => {
                        if (isTouchScrubbingRef.current && e.touches.length > 0) {
                          handleTimelineScrub(e.touches[0].clientX);
                        }
                      }}
                      onTouchEnd={() => {
                        isTouchScrubbingRef.current = false;
                      }}
                      className="touch-btn w-5 h-5 -ml-[10px] -mt-1 bg-rose-500 rounded-full border-2 border-white flex items-center justify-center shadow-lg cursor-grab"
                    >
                      <div className="w-1 h-2 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑA 2: EFECTOS FX (GLSL SHADERS EN GPU) */}
          {activeTab === 'panel-effects' && (
            <div className="p-3 space-y-2.5">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] text-gray-400 font-medium">
                  Shaders GLSL acelerados por hardware GPU (60 FPS)
                </span>
                <button
                  onClick={() => {
                    setEffects({
                      wave: false,
                      waveAmp: 16,
                      fisheye: false,
                      fisheyeStrength: 1.8,
                      sepia: false,
                      sepiaVal: 0.8,
                      glitch: false,
                      glitchShift: 12,
                      pixelate: false,
                      pixelSize: 14,
                      bw: false,
                      invert: false,
                      vignette: false,
                    });
                    showToast('Efectos GPU desactivados');
                  }}
                  className="text-[10px] text-cyan-400 font-bold touch-btn px-2.5 py-0.5 bg-[#1a1d2b] rounded-lg border border-[#2b2f44]"
                >
                  Restablecer FX
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pb-2">
                {/* Onda (Wave) */}
                <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                      <i className="fa-solid fa-water"></i> Onda GPU
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.wave}
                      onChange={(e) =>
                        setEffects({ ...effects, wave: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                    />
                  </div>
                  <div className="text-[9px] text-gray-400 flex justify-between font-mono">
                    <span>Amplitud</span>
                    <span>{effects.waveAmp}px</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="40"
                    value={effects.waveAmp}
                    onChange={(e) =>
                      setEffects({
                        ...effects,
                        waveAmp: parseInt(e.target.value),
                      })
                    }
                    className="w-full"
                  />
                </div>

                {/* Ojo de Pez (Fisheye) */}
                <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <i className="fa-solid fa-circle-dot"></i> Ojo de Pez GPU
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.fisheye}
                      onChange={(e) =>
                        setEffects({ ...effects, fisheye: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                    />
                  </div>
                  <div className="text-[9px] text-gray-400 flex justify-between font-mono">
                    <span>Curvatura</span>
                    <span>{effects.fisheyeStrength}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.2"
                    step="0.1"
                    value={effects.fisheyeStrength}
                    onChange={(e) =>
                      setEffects({
                        ...effects,
                        fisheyeStrength: parseFloat(e.target.value),
                      })
                    }
                    className="w-full"
                  />
                </div>

                {/* Sepia Vintage */}
                <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <i className="fa-solid fa-camera-retro"></i> Sepia GPU
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.sepia}
                      onChange={(e) =>
                        setEffects({ ...effects, sepia: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                    />
                  </div>
                  <div className="text-[9px] text-gray-400 flex justify-between font-mono">
                    <span>Intensidad</span>
                    <span>{Math.round(effects.sepiaVal * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={Math.round(effects.sepiaVal * 100)}
                    onChange={(e) =>
                      setEffects({
                        ...effects,
                        sepiaVal: parseInt(e.target.value) / 100,
                      })
                    }
                    className="w-full"
                  />
                </div>

                {/* Glitch VHS */}
                <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-pink-300 flex items-center gap-1.5">
                      <i className="fa-solid fa-bolt"></i> Glitch VHS GPU
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.glitch}
                      onChange={(e) =>
                        setEffects({ ...effects, glitch: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                    />
                  </div>
                  <div className="text-[9px] text-gray-400 flex justify-between font-mono">
                    <span>Desfase</span>
                    <span>{effects.glitchShift}px</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="30"
                    value={effects.glitchShift}
                    onChange={(e) =>
                      setEffects({
                        ...effects,
                        glitchShift: parseInt(e.target.value),
                      })
                    }
                    className="w-full"
                  />
                </div>

                {/* Pixelado */}
                <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-yellow-300 flex items-center gap-1.5">
                      <i className="fa-solid fa-border-all"></i> Pixelado GPU
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.pixelate}
                      onChange={(e) =>
                        setEffects({ ...effects, pixelate: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                    />
                  </div>
                  <div className="text-[9px] text-gray-400 flex justify-between font-mono">
                    <span>Mosaico</span>
                    <span>{effects.pixelSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="36"
                    value={effects.pixelSize}
                    onChange={(e) =>
                      setEffects({
                        ...effects,
                        pixelSize: parseInt(e.target.value),
                      })
                    }
                    className="w-full"
                  />
                </div>

                {/* Filtros B&N, Inversión, Viñeta */}
                <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] flex flex-col justify-around text-xs space-y-1">
                  <label className="flex items-center justify-between py-0.5 cursor-pointer">
                    <span className="text-[11px] text-gray-300 font-medium">
                      B & N Cine
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.bw}
                      onChange={(e) =>
                        setEffects({ ...effects, bw: e.target.checked })
                      }
                      className="w-3.5 h-3.5 accent-cyan-400"
                    />
                  </label>
                  <label className="flex items-center justify-between py-0.5 cursor-pointer">
                    <span className="text-[11px] text-gray-300 font-medium">
                      Inversión Color
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.invert}
                      onChange={(e) =>
                        setEffects({ ...effects, invert: e.target.checked })
                      }
                      className="w-3.5 h-3.5 accent-cyan-400"
                    />
                  </label>
                  <label className="flex items-center justify-between py-0.5 cursor-pointer">
                    <span className="text-[11px] text-gray-300 font-medium">
                      Viñeta Opcional
                    </span>
                    <input
                      type="checkbox"
                      checked={effects.vignette}
                      onChange={(e) =>
                        setEffects({ ...effects, vignette: e.target.checked })
                      }
                      className="w-3.5 h-3.5 accent-cyan-400"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑA 3: EDITAR CLIPS */}
          {activeTab === 'panel-edit' && (
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleSplit}
                  className="touch-btn h-12 bg-[#171a26] border border-[#282d40] rounded-xl flex flex-col items-center justify-center gap-1 text-white"
                >
                  <i className="fa-solid fa-scissors text-amber-400 text-xs"></i>
                  <span className="text-[10px] font-semibold">Dividir (Split)</span>
                </button>
                <button
                  onClick={handleCopy}
                  className="touch-btn h-12 bg-[#171a26] border border-[#282d40] rounded-xl flex flex-col items-center justify-center gap-1 text-white"
                >
                  <i className="fa-regular fa-copy text-cyan-400 text-xs"></i>
                  <span className="text-[10px] font-semibold">Copiar</span>
                </button>
                <button
                  onClick={handlePaste}
                  className="touch-btn h-12 bg-[#171a26] border border-[#282d40] rounded-xl flex flex-col items-center justify-center gap-1 text-white"
                >
                  <i className="fa-regular fa-paste text-emerald-400 text-xs"></i>
                  <span className="text-[10px] font-semibold">Pegar</span>
                </button>
                <button
                  onClick={handleDuplicate}
                  className="touch-btn h-12 bg-[#171a26] border border-[#282d40] rounded-xl flex flex-col items-center justify-center gap-1 text-white"
                >
                  <i className="fa-solid fa-clone text-indigo-400 text-xs"></i>
                  <span className="text-[10px] font-semibold">Duplicar</span>
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="touch-btn h-12 bg-rose-950/80 border border-rose-800 rounded-xl flex flex-col items-center justify-center gap-1 text-rose-300"
                >
                  <i className="fa-solid fa-trash-can text-rose-400 text-xs"></i>
                  <span className="text-[10px] font-semibold">Eliminar</span>
                </button>
                <button
                  onClick={handleResetClips}
                  className="touch-btn h-12 bg-[#171a26] border border-[#282d40] rounded-xl flex flex-col items-center justify-center gap-1 text-gray-300"
                >
                  <i className="fa-solid fa-arrows-rotate text-purple-400 text-xs"></i>
                  <span className="text-[10px] font-semibold">Restaurar</span>
                </button>
              </div>

              <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] font-semibold text-gray-300">
                    Recorte fino del segmento actual
                  </span>
                  <span className="font-mono text-cyan-400 text-[10px] font-bold">
                    {selectedClip ? `${selectedClip.duration.toFixed(2)}s` : '0.0s'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleNudge(-0.5)}
                    className="touch-btn flex-1 h-8 bg-[#202436] rounded-lg text-xs font-bold text-gray-200 border border-[#2f354c]"
                  >
                    -0.5s
                  </button>
                  <span className="text-[10px] text-gray-400 font-medium">
                    Margen
                  </span>
                  <button
                    onClick={() => handleNudge(0.5)}
                    className="touch-btn flex-1 h-8 bg-[#202436] rounded-lg text-xs font-bold text-gray-200 border border-[#2f354c]"
                  >
                    +0.5s
                  </button>
                </div>
              </div>

              {/* Transición con el siguiente clip */}
              {selectedClip && (() => {
                const sIdx = clips.findIndex((c) => c.id === selectedClip.id);
                const hasNext = sIdx !== -1 && sIdx < clips.length - 1;
                return (
                  <div className="bg-[#161824] p-2.5 rounded-xl border border-[#262a3c] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] font-semibold text-gray-300 flex items-center gap-1.5">
                        <i className="fa-solid fa-wand-magic-sparkles text-cyan-400 text-xs"></i>
                        Transición hacia siguiente clip
                      </span>
                      {hasNext ? (
                        <span className="text-[10px] text-cyan-400 font-bold font-mono">
                          #{sIdx + 1} ➔ #{sIdx + 2}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500 font-mono">Último clip</span>
                      )}
                    </div>

                    {hasNext ? (
                      <>
                        <div className="grid grid-cols-5 gap-1">
                          {TRANSITION_TYPES.map((t) => {
                            const isCur = (selectedClip.transition || 'none') === t.type;
                            return (
                              <button
                                key={t.type}
                                onClick={() => applyTransition(sIdx, t.type)}
                                className={`touch-btn h-12 rounded-lg flex flex-col items-center justify-center p-1 text-[9px] border transition-all ${
                                  isCur
                                    ? 'bg-cyan-950/80 border-cyan-400 text-cyan-300 font-bold shadow-sm shadow-cyan-500/30'
                                    : 'bg-[#1a1d2a] border-[#292e42] text-gray-400 hover:text-gray-200'
                                }`}
                              >
                                <i className={`fa-solid ${t.icon} text-xs mb-1 ${t.color}`}></i>
                                <span className="truncate w-full text-center leading-tight scale-90">
                                  {t.type === 'none' ? 'Corte' : t.label.split(' ')[0]}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {selectedClip.transition && selectedClip.transition !== 'none' && (
                          <div className="space-y-1 pt-1">
                            <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                              <span>Duración transición</span>
                              <span className="text-cyan-400 font-bold">
                                {(selectedClip.transitionDuration || 0.6).toFixed(1)}s
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.2"
                              max="1.5"
                              step="0.1"
                              value={selectedClip.transitionDuration || 0.6}
                              onChange={(e) =>
                                applyTransition(
                                  sIdx,
                                  selectedClip.transition || 'none',
                                  parseFloat(e.target.value)
                                )
                              }
                              className="w-full"
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[10px] text-gray-500 italic">
                        Divide o añade otro segmento después de este para habilitar una transición.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* PESTAÑA 4: TEXTO Y TÍTULOS */}
          {activeTab === 'panel-text' && (
            <div className="p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                  Capa de Titulación Vectorial
                </span>
                <label className="flex items-center gap-1.5 text-xs text-cyan-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={title.enabled}
                    onChange={(e) => setTitle({ ...title, enabled: e.target.checked })}
                    className="w-3.5 h-3.5 accent-cyan-400"
                  />
                  <span className="text-[11px] font-semibold">Visible</span>
                </label>
              </div>

              <input
                type="text"
                value={title.text}
                onChange={(e) => setTitle({ ...title, text: e.target.value })}
                className="w-full h-9 bg-[#171a26] border border-[#292f44] rounded-lg px-2.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-semibold"
                placeholder="Escribe el título aquí..."
              />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-gray-400 block mb-1 font-medium">
                    Color de Texto
                  </label>
                  <input
                    type="color"
                    value={title.color}
                    onChange={(e) => setTitle({ ...title, color: e.target.value })}
                    className="w-full h-8 bg-[#171a26] border border-[#292f44] rounded-lg p-0.5 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-400 block mb-1 font-medium">
                    Posición
                  </label>
                  <select
                    value={title.position}
                    onChange={(e) =>
                      setTitle({
                        ...title,
                        position: e.target.value as 'top' | 'center' | 'bottom',
                      })
                    }
                    className="w-full h-8 bg-[#171a26] border border-[#292f44] rounded-lg px-2 text-xs text-white focus:outline-none"
                  >
                    <option value="bottom">Inferior (Subtítulo)</option>
                    <option value="center">Centro</option>
                    <option value="top">Superior</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑA 5: AJUSTES Y VELOCIDAD */}
          {activeTab === 'panel-adjust' && (
            <div className="p-3 space-y-2.5">
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-300">
                  <span className="text-[11px] font-medium">Brillo</span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {brightness}%
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="170"
                  value={brightness}
                  onChange={(e) => setBrightness(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-300">
                  <span className="text-[11px] font-medium">Contraste</span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {contrast}%
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="170"
                  value={contrast}
                  onChange={(e) => setContrast(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-300">
                  <span className="text-[11px] font-medium">Velocidad de Reproducción</span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {playbackRate.toFixed(1)}x
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {[0.5, 1.0, 1.5, 2.0].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => {
                        setPlaybackRate(spd);
                        const video = hiddenVideoRef.current;
                        if (video) video.playbackRate = spd;
                        showToast(`Velocidad: ${spd}x`);
                      }}
                      className={`touch-btn h-8 rounded-lg text-xs font-semibold ${
                        playbackRate === spd
                          ? 'bg-cyan-500 font-bold text-black border border-cyan-400'
                          : 'bg-[#171a26] text-gray-300 border border-[#292f44]'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* NAVEGACIÓN INFERIOR ERGONÓMICA */}
      <nav className="h-14 bg-[#0d0e15] border-t border-[#1a1c28] flex items-center justify-around px-1 shrink-0 z-30 pb-safe">
        {[
          {
            id: 'panel-timeline' as TabType,
            label: 'Timeline',
            icon: 'fa-timeline',
          },
          {
            id: 'panel-effects' as TabType,
            label: 'Efectos FX',
            icon: 'fa-wand-magic-sparkles',
          },
          {
            id: 'panel-edit' as TabType,
            label: 'Editar',
            icon: 'fa-scissors',
          },
          {
            id: 'panel-text' as TabType,
            label: 'Texto',
            icon: 'fa-heading',
          },
          {
            id: 'panel-adjust' as TabType,
            label: 'Ajustes',
            icon: 'fa-sliders',
          },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (activeTab === tab.id && isDrawerOpen) {
                  setIsDrawerOpen(false);
                } else {
                  setActiveTab(tab.id);
                  setIsDrawerOpen(true);
                }
              }}
              className={`touch-btn flex-1 h-full flex flex-col items-center justify-center gap-1 ${
                isActive ? 'text-cyan-400' : 'text-gray-400'
              }`}
            >
              <i className={`fa-solid ${tab.icon} text-sm`}></i>
              <span
                className={`text-[9px] ${
                  isActive ? 'font-bold' : 'font-semibold'
                } tracking-tight`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* MODAL DE EXPORTACIÓN */}
      {isExporting && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-[#141622] border border-[#272c40] rounded-2xl w-full max-w-sm p-4 space-y-3.5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-400/20 text-cyan-400 flex items-center justify-center text-lg">
                <i className="fa-solid fa-arrow-down-to-bracket animate-bounce"></i>
              </div>
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Exportando Video
                </h4>
                <p className="text-[11px] text-gray-400">
                  Renderizando WebGL GPU y cortes...
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="h-2 bg-[#090a10] rounded-full overflow-hidden border border-[#1f2231]">
                <div
                  style={{ width: `${exportProgress}%` }}
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-100"
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-gray-400">
                <span>{exportProgress}%</span>
                <span>Procesando GPU</span>
              </div>
            </div>

            <button
              onClick={cancelExport}
              className="touch-btn w-full h-10 bg-[#1f2334] text-gray-200 text-xs font-bold rounded-xl border border-[#2a3046]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE SELECCIÓN DE TRANSICIÓN */}
      {transitionModalOpen && transitionTargetIndex !== null && clips[transitionTargetIndex] && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-[#141622] border border-[#272c40] rounded-2xl w-full max-w-sm p-4 space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between pb-1 border-b border-[#212536]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-sm">
                  <i className="fa-solid fa-wand-magic-sparkles"></i>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Transición de Unión (GPU)
                  </h4>
                  <p className="text-[10px] text-gray-400 font-mono">
                    Clip #{transitionTargetIndex + 1} ➔ Clip #{transitionTargetIndex + 2}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTransitionModalOpen(false)}
                className="touch-btn w-7 h-7 rounded-lg bg-[#1d202e] text-gray-400 hover:text-white flex items-center justify-center"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>

            {/* Opciones de transiciones */}
            <div className="space-y-1.5 max-h-[48vh] overflow-y-auto scroll-touch-y pr-0.5">
              {TRANSITION_TYPES.map((t) => {
                const isSelected =
                  (clips[transitionTargetIndex].transition || 'none') === t.type;
                return (
                  <button
                    key={t.type}
                    onClick={() => {
                      applyTransition(
                        transitionTargetIndex,
                        t.type,
                        transitionDurationInput
                      );
                    }}
                    className={`touch-btn w-full p-2.5 rounded-xl border text-left flex items-center gap-3 transition-all ${
                      isSelected
                        ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-md shadow-cyan-500/20'
                        : 'bg-[#181b28] border-[#262b3d] text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 ${
                        isSelected
                          ? 'bg-cyan-400 text-black font-extrabold'
                          : 'bg-[#212538] ' + t.color
                      }`}
                    >
                      <i className={`fa-solid ${t.icon}`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white truncate">
                          {t.label}
                        </span>
                        {isSelected && (
                          <span className="text-[9px] font-mono text-cyan-400 font-bold bg-cyan-950 px-1.5 py-0.2 rounded border border-cyan-800">
                            ACTIVA
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {t.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Slider de duración si hay transición seleccionada */}
            {clips[transitionTargetIndex].transition &&
              clips[transitionTargetIndex].transition !== 'none' && (
                <div className="bg-[#181b28] p-2.5 rounded-xl border border-[#272c40] space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span className="text-[11px] font-medium">Duración de transición</span>
                    <span className="text-[11px] text-cyan-400 font-mono font-bold">
                      {transitionDurationInput.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.5"
                    step="0.1"
                    value={transitionDurationInput}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setTransitionDurationInput(val);
                      applyTransition(
                        transitionTargetIndex,
                        clips[transitionTargetIndex].transition || 'none',
                        val
                      );
                    }}
                    className="w-full"
                  />
                </div>
              )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  applyTransition(transitionTargetIndex, 'none', 0.6);
                  setTransitionModalOpen(false);
                }}
                className="touch-btn flex-1 h-9 bg-[#1d202e] text-rose-300 text-xs font-bold rounded-xl border border-rose-900/60"
              >
                Quitar Transición
              </button>
              <button
                onClick={() => setTransitionModalOpen(false)}
                className="touch-btn flex-1 h-9 bg-gradient-to-r from-cyan-400 to-blue-500 text-black text-xs font-extrabold rounded-xl shadow-md shadow-cyan-400/25"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST DE NOTIFICACIÓN FLOTANTE */}
      <div
        className={`fixed top-15 left-1/2 -translate-x-1/2 bg-[#171a26]/95 border border-cyan-400/60 text-white text-xs px-3.5 py-2 rounded-full shadow-2xl transition-all duration-200 z-50 flex items-center gap-1.5 max-w-[90vw] truncate font-medium backdrop-blur-md ${
          toastVisible
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        <i className="fa-solid fa-circle-check text-cyan-400 text-xs"></i>
        <span>{toastMessage}</span>
      </div>
    </div>
  );
}
