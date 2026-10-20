import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { apiRequest } from '../../api/client';

import {
  BORDER,
  INK,
  LABEL,
  MUTED,
  OUT_OF_RANGE_INK,
  ROW_SEPARATOR,
} from './managerDesign';
import { describeFailure } from './loadState';

/**
 * The pieces boards 3.4, 3.5 and 3.6 share, written once.
 *
 * All three render the same visit from the same `GET /visits/:id` payload —
 * only which parts they show differs — so the fact rows, the chips and the
 * card shell belong in one place rather than being copied three times.
 */

export interface VisitDetail {
  id: string;
  outcome: 'ORDER' | 'NO_ORDER';
  shopName: string;
  executiveName: string;
  beatPlanName: string | null;
  businessDate: string;
  occurredAt: string;
  sampleShown: boolean;
  order: {
    /** The deliver route is addressed by the order, not the visit. */
    orderId: string;
    lines: Array<{ brandLabel: string; quantity: number }>;
    totalQuantity: number;
    deliveryStatus: 'TO_DELIVER' | 'DELIVERED';
    deliveredAt: string | null;
    deliveredByName: string | null;
  } | null;
  noOrder: {
    reasonLabel: string | null;
    lastFiveReasons: Array<{
      businessDate: string;
      reasonLabel: string | null;
      executiveName: string;
    }>;
  } | null;
  measurement: {
    distanceMeters: number;
    isExceedRange: boolean;
    effectiveRadiusMeters: number;
    accuracyMeters: number;
    flags: string[];
    submittedAt: string;
  };
  location: {
    shopLatitude: number | null;
    shopLongitude: number | null;
    capturedLatitude: number;
    capturedLongitude: number;
  };
}

export function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.72,
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: BORDER,
          borderRadius: 16,
          paddingVertical: 6,
          paddingHorizontal: 14,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** One `label / value` line, as boards 3.4 and 3.6 draw their Visit facts. */
export function FactRow({
  label,
  value,
  tint = INK,
  last = false,
}: {
  label: string;
  value: string;
  tint?: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: ROW_SEPARATOR,
      }}
    >
      <Text style={{ fontSize: 13, color: MUTED }}>{label}</Text>
      <Text
        style={{
          fontSize: 14,
          fontWeight: '600',
          color: tint,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * `Within range · 11 m` or `Out of range · 112 m`.
 *
 * A manager sees this; an executive never does (FR-046 / FR-047).
 */
export function locationVerdict(m: VisitDetail['measurement']): {
  text: string;
  tint: string;
} {
  return m.isExceedRange
    ? { text: `Out of range · ${m.distanceMeters} m`, tint: OUT_OF_RANGE_INK }
    : { text: `Within range · ${m.distanceMeters} m`, tint: LABEL };
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(d);
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDay(businessDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T00:00:00.000Z`));
}

/**
 * `GET /visits/:id`, loaded the same way by all three detail boards.
 *
 * Which screen the manager is on is decided by the TAB they came from, not
 * by what the visit turns out to be (FR-029), so the three boards differ
 * only in what they render — the fetch, the stale fallback and the error
 * wording are one piece of behaviour and live here.
 *
 * `setError` is returned because board 3.4 also reports a failed *command*
 * (mark delivered) in the same line as a failed read.
 */
export function useVisitDetail(visitId: string): {
  visit: VisitDetail | null;
  loading: boolean;
  staleNote: string | null;
  error: string | null;
  setError: (message: string | null) => void;
  reload: () => Promise<void>;
} {
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read in the catch to decide stale-vs-empty without making `load`
  // depend on the visit and re-fetch every time one arrives.
  const loaded = useRef<VisitDetail | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiRequest<VisitDetail>(`/visits/${visitId}`);
      loaded.current = next;
      setVisit(next);
      setStaleNote(null);
      setError(null);
    } catch (err) {
      const failure = describeFailure(
        err,
        'this visit',
        loaded.current !== null,
      );
      setStaleNote(failure.staleNote);
      setError(failure.error);
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { visit, loading, staleNote, error, setError, reload };
}
