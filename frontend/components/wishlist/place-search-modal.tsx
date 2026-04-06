'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { addPlace } from '@/lib/api';
import type { KakaoPlaceResult, Place, PlaceCategory } from '@/types';

const PLACE_CATEGORIES: PlaceCategory[] = ['맛집', '카페', '관광지', '숙소', '액티비티'];

interface PlaceSearchModalProps {
  open: boolean;
  onClose: () => void;
  onAddPlace: (place: Place) => void;
  roomId: string;
}

export function PlaceSearchModal({ open, onClose, onAddPlace, roomId }: PlaceSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KakaoPlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<KakaoPlaceResult | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<PlaceCategory>('맛집');
  const [memo, setMemo] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모달 열릴 때 상태 초기화
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedResult(null);
      setSelectedCategory('맛집');
      setMemo('');
    }
  }, [open]);

  // 검색어 변경 시 디바운스 300ms 후 API 호출
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/kakao-search?query=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.documents ?? []);
        } else {
          setSearchResults([]);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const handleAdd = async () => {
    if (!selectedResult) return;
    const memberId =
      typeof window !== 'undefined' ? (localStorage.getItem('memberId') ?? 'unknown') : 'unknown';

    setIsAdding(true);
    try {
      const place = await addPlace(roomId, {
        name: selectedResult.place_name,
        lat: parseFloat(selectedResult.y),
        lng: parseFloat(selectedResult.x),
        category: selectedCategory,
        kakao_place_id: selectedResult.id,
        added_by: memberId,
        memo: memo.trim() || null,
      });
      onAddPlace(place);
      onClose();
    } catch (err) {
      console.error('장소 추가 실패:', err);
      toast.error(err instanceof Error ? err.message : '장소 추가에 실패했습니다');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>장소 검색</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 검색창 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="장소명을 입력하세요"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedResult(null);
              }}
              className="pl-8"
            />
            {isSearching && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* 검색 결과 목록 */}
          {!selectedResult && searchQuery.trim() && !isSearching && (
            <>
              {searchResults.length > 0 ? (
                <ul className="border border-border rounded-lg divide-y divide-border max-h-52 overflow-y-auto">
                  {searchResults.map((result) => (
                    <li key={result.id}>
                      <button
                        className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex flex-col gap-0.5"
                        onClick={() => setSelectedResult(result)}
                      >
                        <span className="text-sm font-medium text-foreground">
                          {result.place_name}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="size-3 shrink-0" />
                          {result.address_name || result.category_name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  검색 결과가 없습니다.
                </p>
              )}
            </>
          )}

          {/* 장소 선택 후: 카테고리 + 메모 입력 */}
          {selectedResult && (
            <div className="flex flex-col gap-3 border border-border rounded-lg p-3 bg-muted/30">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {selectedResult.place_name}
                </span>
                <span className="text-xs text-muted-foreground">{selectedResult.address_name}</span>
              </div>

              {/* 카테고리 선택 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">카테고리</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as PlaceCategory)}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  {PLACE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* 메모 입력 */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">메모 (선택)</label>
                <Input
                  placeholder="메모를 입력하세요"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* 초기 안내 문구 */}
          {searchQuery.trim().length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              검색어를 입력하면 장소 목록이 표시됩니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isAdding}>
            취소
          </Button>
          <Button onClick={handleAdd} disabled={!selectedResult || isAdding}>
            {isAdding && <Loader2 className="size-4 animate-spin mr-1.5" />}
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
