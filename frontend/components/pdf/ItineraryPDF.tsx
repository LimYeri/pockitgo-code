'use client';

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { TravelRoom, Itinerary, ExcludedPlace, PlaceCategory } from '@/types';

// 카테고리별 색상 (category-badge.tsx와 동일)
const categoryColors: Record<PlaceCategory, { bg: string; text: string }> = {
  '맛집':    { bg: '#fee2e2', text: '#b91c1c' },
  '카페':    { bg: '#fef3c7', text: '#b45309' },
  '관광지':  { bg: '#dbeafe', text: '#1d4ed8' },
  '숙소':    { bg: '#f3e8ff', text: '#7e22ce' },
  '액티비티': { bg: '#dcfce7', text: '#15803d' },
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansKR',
    fontWeight: 500,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontSize: 10,
    color: '#111827',
  },
  // 표지
  coverSection: {
    marginBottom: 32,
    paddingBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#e5e7eb',
  },
  coverTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#111827',
  },
  coverDestination: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 4,
  },
  coverPeriod: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 4,
  },
  coverGeneratedAt: {
    fontSize: 9,
    color: '#9ca3af',
    marginTop: 8,
  },
  // 날짜 헤더
  dateHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    backgroundColor: '#f3f4f6',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 4,
    color: '#374151',
  },
  // 장소 행
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    paddingHorizontal: 4,
  },
  orderNum: {
    width: 20,
    fontWeight: 'bold',
    color: '#6b7280',
    fontSize: 10,
  },
  categoryBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 8,
    marginHorizontal: 6,
  },
  placeName: {
    flex: 1,
    fontSize: 10,
    color: '#111827',
  },
  scheduledTime: {
    fontSize: 9,
    color: '#6b7280',
  },
  // 이동 시간
  travelTimeRow: {
    marginLeft: 26,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  travelTimeText: {
    color: '#9ca3af',
    fontSize: 9,
  },
  // 방문 불가 섹션
  excludedSection: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  excludedTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#dc2626',
    marginBottom: 8,
  },
  excludedRow: {
    flexDirection: 'row',
    marginVertical: 3,
    paddingHorizontal: 4,
  },
  excludedName: {
    width: 120,
    fontSize: 10,
    color: '#374151',
  },
  excludedReason: {
    flex: 1,
    fontSize: 9,
    color: '#6b7280',
  },
  // 푸터
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 8,
    color: '#9ca3af',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 6,
  },
});

export interface ItineraryPDFProps {
  room: TravelRoom;
  schedules: Itinerary[];
  excludedPlaces: ExcludedPlace[];
}

export function ItineraryPDF({ room, schedules, excludedPlaces }: ItineraryPDFProps) {
  const d = new Date();
  const today = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* 표지 */}
        <View style={styles.coverSection}>
          <Text style={styles.coverTitle}>{room.title}</Text>
          <Text style={styles.coverDestination}>{room.destination}</Text>
          <Text style={styles.coverPeriod}>
            {room.start_date} ~ {room.end_date}
          </Text>
          <Text style={styles.coverGeneratedAt}>생성일: {today}</Text>
        </View>

        {/* 날짜별 타임라인 */}
        {schedules.map((day, dayIdx) => (
          <View key={day.date}>
            <Text style={styles.dateHeader}>
              Day {dayIdx + 1}  ·  {day.date}
            </Text>
            {day.ordered_places.map((place, placeIdx) => {
              const colors = categoryColors[place.category as PlaceCategory] ?? {
                bg: '#f3f4f6',
                text: '#374151',
              };
              return (
                <View key={place.place_id}>
                  {/* 장소 행 */}
                  <View style={styles.placeRow}>
                    <Text style={styles.orderNum}>{placeIdx + 1}</Text>
                    <Text
                      style={[
                        styles.categoryBadge,
                        { backgroundColor: colors.bg, color: colors.text },
                      ]}
                    >
                      {place.category}
                    </Text>
                    <Text style={styles.placeName}>{place.name}</Text>
                    {place.scheduled_time && (
                      <Text style={styles.scheduledTime}>{place.scheduled_time}</Text>
                    )}
                  </View>
                  {/* 이동 시간 */}
                  {place.travel_time_after != null && (
                    <View style={styles.travelTimeRow}>
                      <Text style={styles.travelTimeText}>
                        → 이동 {place.travel_time_after}분
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        {/* 방문 불가 장소 */}
        {excludedPlaces.length > 0 && (
          <View style={styles.excludedSection}>
            <Text style={styles.excludedTitle}>방문 불가 장소</Text>
            {excludedPlaces.map((place) => (
              <View key={place.id} style={styles.excludedRow}>
                <Text style={styles.excludedName}>{place.name}</Text>
                <Text style={styles.excludedReason}>{place.reason}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 푸터 */}
        <Text style={styles.footer} fixed>
          PockitGo로 생성된 여행 일정입니다
        </Text>
      </Page>
    </Document>
  );
}
