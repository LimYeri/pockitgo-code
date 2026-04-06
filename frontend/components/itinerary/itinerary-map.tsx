'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItineraryOrderedPlace } from '@/types';

interface ItineraryMapProps {
  places: ItineraryOrderedPlace[];
}

export default function ItineraryMap({ places }: ItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    if (!window.kakao?.maps) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMapError(true);
      return;
    }

    // 각 effect 실행마다 로컬 마커/폴리라인 추적 (cleanup용)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localMarkers: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let localPolyline: any = null;

    try {
      window.kakao.maps.load(() => {
        if (!containerRef.current) return;

        const defaultCenter = new window.kakao.maps.LatLng(37.5665, 126.978);
        const center =
          places.length > 0
            ? new window.kakao.maps.LatLng(places[0].lat, places[0].lng)
            : defaultCenter;

        const map = new window.kakao.maps.Map(containerRef.current, {
          center,
          level: 5,
        });

        if (places.length === 0) return;

        const latLngs = places.map(
          (p) => new window.kakao.maps.LatLng(p.lat, p.lng)
        );

        // 각 장소에 마커 생성
        latLngs.forEach((latlng) => {
          const marker = new window.kakao.maps.Marker({ position: latlng });
          marker.setMap(map);
          localMarkers.push(marker);
        });

        // 2개 이상일 때 방문 순서 동선 폴리라인 생성
        if (latLngs.length > 1) {
          localPolyline = new window.kakao.maps.Polyline({
            path: latLngs,
            strokeWeight: 4,
            strokeColor: '#6366f1',
            strokeOpacity: 0.8,
          });
          localPolyline.setMap(map);
        }
      });
    } catch {
      setMapError(true);
    }

    // 날짜 탭 전환 시 기존 마커/폴리라인 정리
    return () => {
      localMarkers.forEach((marker) => marker.setMap(null));
      if (localPolyline) localPolyline.setMap(null);
    };
  }, [places]);

  if (mapError) {
    return (
      <div className="w-full min-h-64 lg:min-h-full rounded-xl bg-muted flex items-center justify-center text-sm text-muted-foreground">
        지도를 불러올 수 없습니다.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full min-h-64 lg:min-h-full rounded-xl"
    />
  );
}
