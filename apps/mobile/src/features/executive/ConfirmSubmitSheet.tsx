import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { apiRequest } from '../../api/client';
import { getCurrentPosition, locationFailureMessage } from '../../lib/location';
import { discard, enqueue, isPermanentRejection, sync } from '../../lib/outbox';
import { BLUE, BORDER, DANGER, INK, MUTED } from './executiveDesign';

/**
 * PRD §4 screen 2.3 ("Confirm & submit"), rendered as a bottom sheet as the
 * board draws it (uuid `d512ac43-eb80-4af2-8d49-65f5293dadc2`).
 *
 * **One deliberate divergence from the board** (FR-018): the board shows a
 * "Your location / ±6 m · fresh / Captured 11:42:08 IST · just now" block.
 * It is NOT rendered. The user asked that the executive not be told a
 * position is being captured when saving an order or a no-order.
 *
 * The position still **is** captured here and sent with the submission —
 * nothing about the server's measurement changes. What changed is that the
 * app no longer narrates it at this moment. Disclosure happens at the
 * location-permission prompt instead, whose wording covers recording visits
 * (FR-021) — which is why that wording is load-bearing rather than cosmetic.
 *
 * Submission goes through the outbox: the item is held first, then sent.
 * A send that fails is NOT an error to the executive — the visit is accepted
 * and shown as waiting to sync (FR-035).
 */
export function ConfirmSubmitSheet({
  visible,
  shopName,
  stopLabel,
  outcomeSummary,
  sampleShown,
  buildBody,
  onCancel,
  onSubmitted,
}: {
  visible: boolean;
  shopName: string;
  stopLabel: string;
  outcomeSummary: string;
  sampleShown: boolean;
  /** Everything except the position, which this sheet captures itself. */
  buildBody: () => Record<string, unknown>;
  onCancel: () => void;
  onSubmitted: (queued: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    // Captured silently — see this component's doc comment.
    const fix = await getCurrentPosition();
    if (!fix.ok) {
      setError(locationFailureMessage(fix.failure));
      setBusy(false);
      return;
    }

    const body = {
      ...buildBody(),
      latitude: fix.position.latitude,
      longitude: fix.position.longitude,
      accuracyMeters: fix.position.accuracyMeters,
      capturedAt: fix.position.capturedAt,
      submittedAt: new Date().toISOString(),
    };

    // Held FIRST, so the visit is safe even if the send fails. The
    // idempotency key is minted here, with the item, and reused on every
    // later attempt — that is what makes a retry record exactly once.
    const held = await enqueue('VISIT', '/visits', body);

    try {
      await apiRequest('/visits', {
        method: 'POST',
        body,
        idempotencyKey: held.idempotencyKey,
      });
      // Landed immediately — drop it from the queue by syncing, which
      // removes anything the server has already accepted.
      await sync();
      onSubmitted(false);
    } catch (err) {
      // A blanket catch here previously treated EVERY failure as "safely
      // queued" and navigated away, so a server rejection looked exactly
      // like a successful save — found live, where every submission was
      // being refused and the executive was told nothing.
      //
      // The two cases are completely different and must not be conflated:
      if (isPermanentRejection(err)) {
        // The server understood and refused: the beat has ended, the stop is
        // already done, a brand was retired, the shop has no approved pin.
        // Retrying can never fix it, so the held copy is removed and the
        // executive is told WHY, staying on this sheet with their work
        // intact rather than being sent away believing it saved.
        await discard(held.id);
        setError(
          err instanceof Error ? err.message : 'This visit was refused.',
        );
      } else {
        // No connection, or a transient server fault. The submission is
        // genuinely held and will sync — this one IS a success from the
        // executive's point of view.
        onSubmitted(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(20,26,38,0.45)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: 20,
            paddingBottom: 32,
            gap: 14,
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: INK }}>
              Submit this visit?
            </Text>
            <Text style={{ fontSize: 13, color: MUTED }}>
              {shopName} · {stopLabel}
            </Text>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <SummaryRow label="Outcome" value={outcomeSummary} />
            <SummaryRow
              label="Sample shown"
              last
              value={sampleShown ? 'Yes' : 'No'}
            />
          </View>

          {/* The board renders "Your location" and "Captured" rows here.
              Deliberately omitted — FR-018. */}

          <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
            A submitted visit cannot be edited.
          </Text>

          {error ? (
            <Text style={{ fontSize: 13, color: DANGER }}>{error}</Text>
          ) : null}

          <Pressable
            accessibilityLabel="Submit visit"
            disabled={busy}
            onPress={() => void submit()}
            style={{
              height: 54,
              borderRadius: 14,
              backgroundColor: BLUE,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
              {busy ? 'Submitting…' : 'Submit visit'}
            </Text>
          </Pressable>

          <Pressable
            disabled={busy}
            onPress={onCancel}
            style={{
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
              Go back and edit
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SummaryRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: '#ECEFF4',
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 14, color: MUTED }}>{label}</Text>
      <Text
        style={{
          fontSize: 14,
          fontWeight: '700',
          color: INK,
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
