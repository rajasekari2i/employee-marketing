import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, INK, MUTED } from './adminDesign';

/**
 * PRD §4 screen 4.12 ("Brands & reasons"). Every hex value, dimension,
 * radius and SVG path below is taken verbatim from
 * `docs/ui-design/Field_Sales_Beat_App.html`'s 4.12 board (decode it with
 * the recipe in CLAUDE.md; its uuid is
 * 18525f8e-f9af-47bd-91bc-f9bbcc437cd2, titled "Reasons and brands") — not
 * approximated from the NativeWind/Tailwind scale.
 *
 * Two chrome details differ from the sibling admin boards 4.6/4.8, and are
 * deliberate rather than oversights:
 *   * there is NO bottom navigation bar on this screen — it is reached from
 *     the Admin home tile, and the Admin bottom bar has no masters slot
 *     (Home · Visits · Beats · Shops);
 *   * the item counts live in the TAB LABELS, not in a line above the
 *     title the way `UsersListScreen`/`BeatPlansListScreen` render theirs.
 *
 * Per research.md §8 there is deliberately no offline/"showing saved data"
 * banner: the app has no offline infrastructure at all, and Constitution
 * rule 7 scopes that requirement to the executive's field screens. A
 * transient read failure leaves the already-loaded list visible; a failed
 * WRITE always says so rather than appearing to have succeeded.
 */

// Board-4.12-specific hexes that no other admin board uses, so they live
// here rather than in the shared `adminDesign` tokens.
const TAB_TRACK = '#E6EAF1';
const INPUT_BORDER = '#CBD2DD';
const ROW_SEPARATOR = '#ECEFF4';
const SWITCH_OFF = '#AEB7C5';
const SYSTEM_ROW_BG = '#F8FAFC';

/** Board 4.12's row `min-height`. Fixed height is what makes the drag maths exact. */
const ROW_HEIGHT = 54;

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_DRAG: IconShape[] = [{ d: 'M5 9h14M5 15h14' }];
const ICON_LOCK: IconShape[] = [
  { rect: [5, 11, 14, 10, 2] },
  { d: 'M8 11V8a4 4 0 0 1 8 0v3' },
];
/** Confirms an inline rename. Not on board 4.12 — it only ever replaces the switch while a row is being edited, so a row at rest still matches the board exactly. */
const ICON_CHECK: IconShape[] = [{ d: 'M5 13l4 4L19 7' }];

type Tab = 'reasons' | 'brands';

interface MasterRow {
  id: string;
  label: string;
  displayOrder: number;
  isActive: boolean;
  requiresText?: boolean;
  isSystem?: boolean;
}

interface MasterListResponse {
  items: MasterRow[];
}

export function BrandsReasonsListScreen() {
  const navigation =
    useNavigation<
      NativeStackNavigationProp<AdminStackParamList, 'BrandsReasonsList'>
    >();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('reasons');
  const [reasons, setReasons] = useState<MasterRow[]>([]);
  const [brands, setBrands] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One draft per tab, so switching tabs never carries typed text into the
  // other list's add field (spec edge case).
  const [reasonDraft, setReasonDraft] = useState('');
  const [brandDraft, setBrandDraft] = useState('');

  const rows = tab === 'reasons' ? reasons : brands;
  const setRows = tab === 'reasons' ? setReasons : setBrands;
  const draft = tab === 'reasons' ? reasonDraft : brandDraft;
  const setDraft = tab === 'reasons' ? setReasonDraft : setBrandDraft;
  const path = tab === 'reasons' ? '/reasons' : '/brands';

  // The system "Other" row is pinned and never participates in dragging or
  // reordering; the server already sorts it last.
  const reorderable = rows.filter((row) => !row.isSystem);
  const systemRow = rows.find((row) => row.isSystem);

  const load = useCallback(async () => {
    try {
      const [reasonsResult, brandsResult] = await Promise.all([
        apiRequest<MasterListResponse>('/reasons'),
        apiRequest<MasterListResponse>('/brands'),
      ]);
      setReasons(reasonsResult.items);
      setBrands(brandsResult.items);
      setError(null);
    } catch {
      // Leave the previous lists visible on a transient read failure — the
      // established posture on every admin list screen (research.md §8).
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function addRow(): Promise<void> {
    const label = draft.trim();
    if (label.length === 0) {
      setError('Enter a label first.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest(path, {
        method: 'POST',
        body: { label },
        idempotencyKey: generateIdempotencyKey(),
      });
      setDraft('');
      setError(null);
      await load();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleRow(row: MasterRow): Promise<void> {
    const previous = rows;
    // Optimistic — reverted below if the server rejects it.
    setRows(
      rows.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)),
    );
    try {
      await apiRequest(`${path}/${row.id}`, {
        method: 'PATCH',
        body: { isActive: !row.isActive },
        idempotencyKey: generateIdempotencyKey(),
      });
      setError(null);
    } catch (err) {
      setRows(previous);
      setError(messageFor(err));
    }
  }

  /**
   * Inline rename. Board 4.12 draws no rename control, so the row is edited
   * in place — the label becomes a field of the same size in the same row —
   * rather than growing a pencil button or opening a dialog the design does
   * not have. A row at rest stays pixel-identical to the board.
   *
   * Returns whether the save succeeded, so the row can stay in edit mode
   * (with the typed text intact) when the server rejects it.
   */
  async function renameRow(
    row: MasterRow,
    nextLabel: string,
  ): Promise<boolean> {
    const label = nextLabel.trim();
    if (label.length === 0) {
      setError('Enter a label first.');
      return false;
    }
    if (label === row.label) {
      setError(null);
      return true;
    }

    const previous = rows;
    setRows(rows.map((r) => (r.id === row.id ? { ...r, label } : r)));
    try {
      await apiRequest(`${path}/${row.id}`, {
        method: 'PATCH',
        body: { label },
        idempotencyKey: generateIdempotencyKey(),
      });
      setError(null);
      return true;
    } catch (err) {
      setRows(previous);
      setError(messageFor(err));
      return false;
    }
  }

  async function commitOrder(next: MasterRow[]): Promise<void> {
    const previous = rows;
    setRows(systemRow ? [...next, systemRow] : next);
    try {
      const result = await apiRequest<MasterListResponse>(`${path}/order`, {
        method: 'PATCH',
        body: { ids: next.map((row) => row.id) },
        idempotencyKey: generateIdempotencyKey(),
      });
      setRows(result.items);
      setError(null);
    } catch (err) {
      setRows(previous);
      setError(messageFor(err));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            accessibilityLabel="Back to home"
            onPress={() => navigation.goBack()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <OutlineIcon
              color={INK}
              shapes={ICON_BACK}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
          <Text
            style={{
              fontSize: 24,
              fontWeight: '700',
              color: INK,
              flexGrow: 1,
            }}
          >
            Brands &amp; reasons
          </Text>
        </View>

        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: 12,
            backgroundColor: TAB_TRACK,
          }}
        >
          <TabButton
            active={tab === 'reasons'}
            label={`No-order reasons · ${reasons.length}`}
            onPress={() => setTab('reasons')}
          />
          <TabButton
            active={tab === 'brands'}
            label={`Brands · ${brands.length}`}
            onPress={() => setTab('brands')}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            autoCapitalize="sentences"
            editable={!submitting}
            onChangeText={setDraft}
            placeholder={
              tab === 'reasons' ? 'New reason label' : 'New brand label'
            }
            placeholderTextColor={MUTED}
            style={{
              flexGrow: 1,
              flexShrink: 1,
              height: 48,
              borderWidth: 1.5,
              borderColor: INPUT_BORDER,
              borderRadius: 12,
              paddingHorizontal: 12,
              fontSize: 15,
              fontWeight: '500',
              color: INK,
              backgroundColor: '#FFFFFF',
            }}
            value={draft}
          />
          <Pressable
            accessibilityLabel={tab === 'reasons' ? 'Add reason' : 'Add brand'}
            disabled={submitting}
            onPress={() => void addRow()}
            style={{
              height: 48,
              paddingHorizontal: 18,
              borderRadius: 12,
              backgroundColor: BLUE,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
              Add
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{
          flexGrow: 1,
          flexShrink: 1,
          paddingHorizontal: 20,
          gap: 10,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ fontSize: 12, color: MUTED, fontWeight: '600' }}>
            Display order · label
          </Text>
          <Text style={{ fontSize: 12, color: MUTED, fontWeight: '600' }}>
            Active
          </Text>
        </View>

        {error ? (
          <Text
            style={{ fontSize: 13, color: '#A3261B', paddingHorizontal: 4 }}
          >
            {error}
          </Text>
        ) : null}

        {loading && rows.length === 0 ? (
          <View
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <ActivityIndicator testID="masters-list-loading" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            showsVerticalScrollIndicator={false}
          >
            {reorderable.length === 0 && !systemRow ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ fontSize: 14, color: MUTED }}>
                  {tab === 'reasons' ? 'No reasons yet.' : 'No brands yet.'}
                </Text>
              </View>
            ) : (
              <View
                style={{
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderRadius: 16,
                  overflow: 'hidden',
                }}
              >
                <DraggableRows
                  key={tab}
                  onRename={renameRow}
                  onReorder={(next) => void commitOrder(next)}
                  onToggle={(row) => void toggleRow(row)}
                  rows={reorderable}
                />
                {systemRow ? <SystemRow label={systemRow.label} /> : null}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        height: 38,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? '#FFFFFF' : 'transparent',
      }}
    >
      <Text
        style={{ fontSize: 14, fontWeight: '600', color: active ? INK : MUTED }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Board 4.12's reorderable list.
 *
 * Drag uses React Native's built-in `PanResponder` + `Animated` rather than
 * a gesture library (research.md §5): `react-native-gesture-handler` isn't
 * installed and `react-native-reanimated` is only a transitive peer of
 * nativewind that pnpm's strict layout doesn't surface to app code, so a
 * draggable-list package would mean two or three new native dependencies
 * and a full Android rebuild. The board's drag handle is this list's only
 * reorder affordance, so substituting up/down buttons (the compromise
 * `003-beat-plans-crud` made behind a form's Save) would be a visible
 * deviation on the one screen singled out for exact fidelity.
 *
 * Rows are a fixed {@link ROW_HEIGHT}, so the drop index is just
 * `round(dy / ROW_HEIGHT)` clamped to the list — no measurement needed.
 */
function DraggableRows({
  rows,
  onReorder,
  onToggle,
  onRename,
}: {
  rows: MasterRow[];
  onReorder: (next: MasterRow[]) => void;
  onToggle: (row: MasterRow) => void;
  onRename: (row: MasterRow, label: string) => Promise<boolean>;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;

  // Which row (if any) is being renamed in place, and its working text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Mirrors of the two above, so the commit path can never read a stale
  // value from an older render's closure.
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;
  const editingTextRef = useRef('');
  editingTextRef.current = editingText;

  // Tapping the confirm control, pressing "done", and the resulting blur can
  // all fire for a single save — this makes the commit run exactly once.
  const committingRef = useRef(false);

  // PanResponder closes over its callbacks once, so the live values it needs
  // go through refs rather than stale captured state.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const dragIndexRef = useRef<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  function makeResponder(index: number) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // An in-progress rename is left to the field's own blur, which
        // commits it (see commitRename) — so a drag saves the edit rather
        // than discarding it, same as tapping anywhere else.
        dragIndexRef.current = index;
        dropIndexRef.current = index;
        setDragIndex(index);
        setDropIndex(index);
        dragY.setValue(0);
      },
      onPanResponderMove: (_event, gesture) => {
        dragY.setValue(gesture.dy);
        const from = dragIndexRef.current;
        if (from === null) {
          return;
        }
        const last = rowsRef.current.length - 1;
        const raw = from + Math.round(gesture.dy / ROW_HEIGHT);
        const next = Math.max(0, Math.min(last, raw));
        if (next !== dropIndexRef.current) {
          dropIndexRef.current = next;
          setDropIndex(next);
        }
      },
      onPanResponderRelease: () => {
        const from = dragIndexRef.current;
        const to = dropIndexRef.current;
        dragIndexRef.current = null;
        dropIndexRef.current = null;
        setDragIndex(null);
        setDropIndex(null);
        dragY.setValue(0);

        if (from === null || to === null || from === to) {
          return;
        }
        const next = [...rowsRef.current];
        const [moved] = next.splice(from, 1);
        if (!moved) {
          return;
        }
        next.splice(to, 0, moved);
        onReorder(next);
      },
      onPanResponderTerminate: () => {
        dragIndexRef.current = null;
        dropIndexRef.current = null;
        setDragIndex(null);
        setDropIndex(null);
        dragY.setValue(0);
      },
    });
  }

  /**
   * Commits an in-place rename.
   *
   * Every way of leaving the field commits: the confirm control, the
   * keyboard's "done", and blurring by tapping anywhere else. Blur must
   * SAVE rather than cancel — a blur-cancels design silently discarded
   * edits whenever the admin tapped away instead of hitting the small
   * confirm control, which is the natural way to finish typing.
   *
   * Those three can fire together for one save, so `committingRef` makes
   * the work happen once. The editor closes immediately (the row already
   * shows the new label optimistically) and only reopens if the server
   * rejects it — with the typed text intact, so a duplicate label can be
   * corrected rather than retyped.
   */
  async function commitRename(row: MasterRow): Promise<void> {
    if (committingRef.current) {
      return;
    }
    committingRef.current = true;

    const text = editingTextRef.current;
    setEditingId(null);

    const ok = await onRename(row, text);
    committingRef.current = false;

    // Only reopen if the admin hasn't already started editing another row.
    if (!ok && editingIdRef.current === null) {
      setEditingId(row.id);
      setEditingText(text);
    }
  }

  /**
   * While a row is held, every row it has passed shifts one slot the other
   * way, so the gap always sits under the finger.
   */
  function shiftFor(index: number): number {
    if (dragIndex === null || dropIndex === null || index === dragIndex) {
      return 0;
    }
    if (dragIndex < dropIndex && index > dragIndex && index <= dropIndex) {
      return -ROW_HEIGHT;
    }
    if (dragIndex > dropIndex && index >= dropIndex && index < dragIndex) {
      return ROW_HEIGHT;
    }
    return 0;
  }

  return (
    <>
      {rows.map((row, index) => {
        const isDragging = index === dragIndex;
        const isEditing = row.id === editingId;
        return (
          <Animated.View
            key={row.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minHeight: ROW_HEIGHT,
              paddingLeft: 4,
              paddingRight: 14,
              borderBottomWidth: 1,
              borderBottomColor: ROW_SEPARATOR,
              backgroundColor: '#FFFFFF',
              transform: [{ translateY: isDragging ? dragY : shiftFor(index) }],
              zIndex: isDragging ? 2 : 1,
              elevation: isDragging ? 4 : 0,
              opacity: isDragging ? 0.95 : 1,
            }}
          >
            <View
              accessibilityLabel={`Drag to reorder ${row.label}`}
              style={{
                width: 40,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              {...makeResponder(index).panHandlers}
            >
              <OutlineIcon
                color={MUTED}
                shapes={ICON_DRAG}
                size={16}
                strokeWidth={2}
              />
            </View>

            <Text
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: MUTED,
                width: 18,
              }}
            >
              {index + 1}
            </Text>

            {isEditing ? (
              <TextInput
                accessibilityLabel={`Edit ${row.label}`}
                autoFocus
                // Tapping away commits, it does not discard. See
                // commitRename's doc comment.
                onBlur={() => void commitRename(row)}
                onChangeText={setEditingText}
                onSubmitEditing={() => void commitRename(row)}
                returnKeyType="done"
                selectTextOnFocus
                style={{
                  flexGrow: 1,
                  flexShrink: 1,
                  // Same type as the resting label, so committing an edit
                  // causes no visible reflow.
                  fontSize: 15,
                  fontWeight: '600',
                  color: INK,
                  paddingVertical: 0,
                  paddingHorizontal: 8,
                  height: 38,
                  borderWidth: 1.5,
                  borderColor: BLUE,
                  borderRadius: 10,
                  backgroundColor: '#FFFFFF',
                }}
                value={editingText}
              />
            ) : (
              <Text
                accessibilityHint="Tap to rename"
                onPress={() => {
                  setEditingId(row.id);
                  setEditingText(row.label);
                }}
                style={{
                  flexGrow: 1,
                  flexShrink: 1,
                  fontSize: 15,
                  fontWeight: '600',
                  color: row.isActive ? INK : MUTED,
                }}
                suppressHighlighting
              >
                {row.label}
              </Text>
            )}

            {isEditing ? (
              <Pressable
                accessibilityLabel={`Save ${row.label}`}
                onPress={() => void commitRename(row)}
                style={{
                  // Exactly the switch's footprint, so the row neither
                  // grows nor shifts when it enters edit mode.
                  width: 44,
                  height: 26,
                  borderRadius: 999,
                  backgroundColor: BLUE,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <OutlineIcon
                  color="#FFFFFF"
                  shapes={ICON_CHECK}
                  size={16}
                  strokeWidth={2.4}
                />
              </Pressable>
            ) : (
              <ActiveSwitch
                label={row.label}
                onPress={() => onToggle(row)}
                value={row.isActive}
              />
            )}
          </Animated.View>
        );
      })}
    </>
  );
}

/** Board 4.12's 44x26 switch — hand-drawn so both states match the board exactly. */
function ActiveSwitch({
  value,
  label,
  onPress,
}: {
  value: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label} active`}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onPress}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        backgroundColor: value ? BLUE : SWITCH_OFF,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#FFFFFF',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.25,
          shadowRadius: 2,
          elevation: 2,
        }}
      />
    </Pressable>
  );
}

/**
 * The pinned system "Other" row. No drag handle, no switch, no delete — it
 * is always last and always active (FR-010/FR-011). The server enforces all
 * three; this just renders the board's locked style.
 */
function SystemRow({ label }: { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 58,
        paddingHorizontal: 14,
        backgroundColor: SYSTEM_ROW_BG,
      }}
    >
      <OutlineIcon
        color={MUTED}
        shapes={ICON_LOCK}
        size={18}
        strokeWidth={1.8}
      />
      <View style={{ flexDirection: 'column', flexGrow: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: MUTED }}>
          Always last · requires free text
        </Text>
      </View>
    </View>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'Something went wrong at our end. Try again in a moment.';
}
