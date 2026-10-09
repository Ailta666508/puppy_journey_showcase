"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Signed URL rotation must not reset a playing clip or a user's playback position. */
export function useRefreshingMediaSource<T extends HTMLMediaElement>(source: string | undefined, onRefresh?: () => Promise<void>, providedRef?: RefObject<T | null>) {
  const internalRef = useRef<T>(null);
  const ref = providedRef ?? internalRef;
  const latest = useRef(source);
  const loadedHandler = useRef<(() => void) | null>(null);
  const lastTime = useRef(0);
  const recovering = useRef(false);
  const attemptedRecovery = useRef(false);

  const replaceSource = useCallback((resume = false) => {
    const media = ref.current;
    const next = latest.current;
    if (!media || !next || media.getAttribute("src") === next) return;
    const time = media.error ? lastTime.current : media.currentTime || 0;
    const shouldResume = resume || !media.paused;
    if (loadedHandler.current) media.removeEventListener("loadedmetadata", loadedHandler.current);
    const restore = () => {
      if (media.getAttribute("src") !== next) return;
      media.currentTime = Number.isFinite(media.duration) ? Math.min(time, Math.max(0, media.duration - 0.01)) : time;
      if (shouldResume) void media.play().catch(() => { /* Native controls allow another explicit play. */ });
    };
    loadedHandler.current = restore;
    media.addEventListener("loadedmetadata", restore, { once: true });
    media.src = next;
    media.load();
  }, [ref]);

  useEffect(() => {
    latest.current = source;
    if (!ref.current || ref.current.paused || ref.current.ended || ref.current.error) replaceSource();
  }, [source, replaceSource, ref]);

  useEffect(() => {
    const media = ref.current;
    return () => {
      if (media && loadedHandler.current) media.removeEventListener("loadedmetadata", loadedHandler.current);
      media?.pause();
    };
  }, [ref]);

  const onError = async () => {
    if (recovering.current || attemptedRecovery.current) return;
    attemptedRecovery.current = true;
    recovering.current = true;
    try {
      await onRefresh?.();
      replaceSource();
    } catch { /* Keep native controls and the surrounding refresh action available. */ }
    finally { recovering.current = false; }
  };

  return {
    ref,
    onPause: () => replaceSource(),
    onEnded: () => { lastTime.current = 0; if (ref.current) ref.current.currentTime = 0; replaceSource(); },
    onTimeUpdate: () => { lastTime.current = ref.current?.currentTime ?? 0; },
    onLoadedData: () => { attemptedRecovery.current = false; },
    onError,
  };
}

export function RefreshingVideo({ src, subtitleUrl, className, onRefresh, videoRef, poster }: {
  src: string; subtitleUrl?: string; className?: string; onRefresh?: () => Promise<void>;
  videoRef?: RefObject<HTMLVideoElement | null>; poster?: string;
}) {
  const media = useRefreshingMediaSource<HTMLVideoElement>(src, onRefresh, videoRef);
  return <video {...media} controls playsInline preload="metadata" crossOrigin="anonymous" className={className} poster={poster}>
    {subtitleUrl ? <track kind="subtitles" src={subtitleUrl} srcLang="es" label="西语与中文" /> : null}
  </video>;
}

export function RefreshingAudio({ src, label, className, onRefresh }: {
  src: string; label: string; className?: string; onRefresh?: () => Promise<void>;
}) {
  const media = useRefreshingMediaSource<HTMLAudioElement>(src, onRefresh);
  return <audio {...media} controls preload="none" aria-label={label} className={className} />;
}
