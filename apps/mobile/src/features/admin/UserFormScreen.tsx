import { useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createUserSchema,
  setUserPasswordSchema,
  updateUserSchema,
  AADHAAR_DIGIT_COUNT,
  FIELD_FORMAT_MESSAGES,
  FIELD_FORMAT_TESTS,
  formatAadhaar,
  USERNAME_MAX_LENGTH,
  type TenantAssignableRoleKey,
  type UserStatus,
} from '@field-sales/shared';

import {
  ApiError,
  apiRequest,
  generateIdempotencyKey,
  resolveFileUrl,
} from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { PasswordInput } from '../../components/PasswordInput';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { BG, BLUE, BORDER, DANGER, INK, LABEL, MUTED } from './adminDesign';

/**
 * User Story 3 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * items 10 + 7 (the photo pipeline) / PRD §4 screen 4.11 ("New user").
 * Layout/colors/icons below are taken verbatim from
 * `docs/ui-design/Field_Sales_Beat_App.html` §4.11 for the create path —
 * there is no separate "edit user" board, so the edit path reuses the same
 * visual language (role cards, the Active checkbox for status) rather than
 * the old read-only text box / pill selector. That reuse is what lets the
 * edit path simply enable the role cards and the username input, which
 * were previously rendered disabled with a "not editable here" caption.
 *
 * One field this screen has that §4.11's mock doesn't show at all: Mobile.
 * `contracts/users.md` requires it whenever `role != EMPLOYEE` (for that
 * user's own future OTP password resets) — dropping it to match the mock
 * pixel-for-pixel would break creating any non-Employee user, so it's kept,
 * styled with the same tokens as everything around it, directly below the
 * username/password grid in "Identity & login".
 *
 * Reuses `createUserSchema`/`updateUserSchema` (`@field-sales/shared`) for
 * the actual submit-time validation (Constitution rule 5 — "one
 * contract"), but NOT via `react-hook-form`'s `zodResolver` the way
 * `SignInScreen.tsx` does for `loginSchema`: those two schemas' optional
 * fields are "absent/undefined", not "empty string", and a plain RN
 * `TextInput` always reports an unset field as `''`. `stripBlanks` below
 * normalizes the raw form values to that shape immediately before handing
 * them to the real shared schema — the schema itself is never loosened or
 * reimplemented, only the empty-string-vs-undefined bridge a bare
 * `TextInput` needs is added in front of it.
 */

type UserFormNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'UserForm'
>;
type UserFormRouteProp = RouteProp<AdminStackParamList, 'UserForm'>;

const ROLE_OPTIONS: Array<{
  key: TenantAssignableRoleKey;
  name: string;
  desc: string;
}> = [
  {
    key: 'COMPANY_ADMIN',
    name: 'Company Administrator',
    desc: 'Masters, users, beats, salary and all reports',
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    desc: 'Attendance, daily review and team reports',
  },
  {
    key: 'MARKETING_EXECUTIVE',
    name: 'Marketing Executive',
    desc: "Today's beat, shop pins and visit outcomes",
  },
  {
    key: 'EMPLOYEE',
    name: 'Employee',
    desc: 'Attendance and salary only — no app login',
  },
];

/** 12 digits plus the two spaces `formatAadhaar` inserts — what the field can hold at most. */
const AADHAAR_DISPLAY_LENGTH = AADHAAR_DIGIT_COUNT + 2;

const ICON_CLOSE: IconShape[] = [{ d: 'M6 6l12 12M18 6L6 18' }];
const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_CAMERA: IconShape[] = [
  { d: 'M4 8h3l2-3h6l2 3h3v11H4z' },
  { circle: [12, 13, 3.5] },
];
const ICON_CHECK: IconShape[] = [{ d: 'M20 6L9 17l-5-5' }];

interface UserFormValues {
  name: string;
  email: string;
  role: TenantAssignableRoleKey;
  status: UserStatus;
  username: string;
  temporaryPassword: string;
  mobile: string;
  /**
   * Aadhaar, held in the GROUPED form the field displays
   * ("1234 5678 9012"). `aadhaarSchema` strips the spaces on the way out,
   * so the wire value is always 12 bare digits.
   */
  personalIdentity: string;
  monthlySalary: string;
  halfDayRate: string;
  rateEffectiveFrom: string;
}

/**
 * Converts every blank/whitespace-only string field to "absent" (the shape
 * `createUserSchema`/`updateUserSchema`'s `.optional()` fields expect) — a
 * bare `TextInput` can only ever report `''`, never `undefined`.
 *
 * Iterates via `Object.keys()` + indexed access (not `Object.entries()`):
 * `UserFormValues` is a plain interface with no index signature, so
 * `Object.entries()`'s generic overload can't narrow its value type past
 * `any` for it — `Object.keys()` cast to `(keyof UserFormValues)[]` keeps
 * every access properly typed as `string`.
 */
function stripBlanks(values: UserFormValues): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(values) as Array<keyof UserFormValues>) {
    const trimmed = values[key].trim();
    if (trimmed.length > 0) {
      result[key] = trimmed;
    }
  }
  return result;
}

/** `Date` -> `"YYYY-MM-DD"` (local calendar date — `rateEffectiveFrom`'s wire format, per contracts/users.md). */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `"YYYY-MM-DD"` -> `Date`, falling back to today for an empty/unparseable value — only used to seed the native date picker's initial selection. */
function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * The form fields that render a message line under their input, so a schema
 * issue or API error naming one is actually SEEN when it is handed to
 * `setError`.
 *
 * `role` and `status` are deliberately absent: they are pickers with no
 * error slot, so routing a message to either would silently swallow it —
 * those fall through to the single message under Save instead.
 */
const ERROR_RENDERING_FIELDS = {
  name: true,
  email: true,
  username: true,
  temporaryPassword: true,
  mobile: true,
  personalIdentity: true,
  monthlySalary: true,
  halfDayRate: true,
  rateEffectiveFrom: true,
} as const satisfies Partial<Record<keyof UserFormValues, true>>;

/**
 * `react-hook-form` `rules.validate` functions built on the same
 * `FIELD_FORMAT_TESTS` the shared Zod schemas are built from
 * (`packages/shared/src/field-formats.ts`), so what this form accepts and
 * what `POST /users` accepts cannot drift apart (Constitution rule 5).
 *
 * Each returns `true` when valid, or the message to show. A blank value is
 * always `true` here: whether a field is REQUIRED is a separate concern,
 * owned by `rules.required` where it is unconditional and by
 * `createUserSchema`'s role-dependent `.superRefine()` where it is not.
 */
const VALIDATE = {
  name: (value: string): true | string =>
    !value.trim() || FIELD_FORMAT_TESTS.personName(value.trim())
      ? true
      : FIELD_FORMAT_MESSAGES.personName,
  email: (value: string): true | string =>
    !value.trim() || FIELD_FORMAT_TESTS.email(value.trim())
      ? true
      : FIELD_FORMAT_MESSAGES.email,
  username: (value: string): true | string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return true;
    }
    // Length first: "ab" fails both rules, and "too short" is the more
    // useful of the two things to be told about it.
    if (!FIELD_FORMAT_TESTS.usernameLength(trimmed)) {
      return FIELD_FORMAT_MESSAGES.usernameLength;
    }
    return FIELD_FORMAT_TESTS.usernameFormat(trimmed)
      ? true
      : FIELD_FORMAT_MESSAGES.usernameFormat;
  },
  mobile: (value: string): true | string =>
    !value.trim() || FIELD_FORMAT_TESTS.phone(value.trim())
      ? true
      : FIELD_FORMAT_MESSAGES.phone,
  aadhaar: (value: string): true | string =>
    !value.trim() || FIELD_FORMAT_TESTS.aadhaar(value.trim())
      ? true
      : FIELD_FORMAT_MESSAGES.aadhaar,
  amount: (value: string): true | string =>
    !value.trim() || FIELD_FORMAT_TESTS.amount(value.trim())
      ? true
      : FIELD_FORMAT_MESSAGES.amount,
  isoDate: (value: string): true | string =>
    !value.trim() || FIELD_FORMAT_TESTS.isoDate(value.trim())
      ? true
      : FIELD_FORMAT_MESSAGES.isoDate,
} as const;

/** The red-bordered variant of `INPUT_STYLE` an invalid field wears. */
function inputStyleFor(hasError: boolean) {
  return hasError
    ? [INPUT_STYLE, { borderColor: DANGER }]
    : (INPUT_STYLE as object);
}

/** The message line under an input — matches the one `errors.name` already renders. */
function FieldError({ children }: { children?: string }) {
  if (!children) {
    return null;
  }
  return (
    <Text style={{ marginTop: 4, fontSize: 12, color: DANGER }}>
      {children}
    </Text>
  );
}

/** Maps a failed submit to a short, readable message — same posture as `SignInScreen.tsx`'s `errorMessageFor`. */
function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'USERNAME_TAKEN':
        return 'That username is already in use in this company.';
      case 'VALIDATION_FAILED':
        return error.message || 'Please check the fields and try again.';
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      case 'NOT_FOUND':
        return 'This user could not be found.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontSize: 13,
        fontWeight: '600',
        color: LABEL,
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

const INPUT_STYLE = {
  height: 48,
  borderWidth: 1.5,
  borderColor: '#CBD2DD',
  borderRadius: 12,
  paddingHorizontal: 12,
  fontSize: 15,
  fontWeight: '500' as const,
  color: INK,
  backgroundColor: '#FFFFFF',
};

function Group({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 18,
        padding: 14,
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: MUTED,
      }}
    >
      {children}
    </Text>
  );
}

function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 32,
      }}
      testID="user-form-active-checkbox"
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: checked ? BLUE : '#AEB7C5',
          backgroundColor: checked ? BLUE : '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <OutlineIcon
            color="#FFFFFF"
            shapes={ICON_CHECK}
            size={13}
            strokeWidth={2.5}
          />
        ) : null}
      </View>
      <Text style={{ fontSize: 14, color: INK }}>{label}</Text>
    </Pressable>
  );
}

function RoleCard({
  name,
  desc,
  selected,
  onPress,
}: {
  name: string;
  desc: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        minHeight: 44,
        backgroundColor: selected ? '#E3EBFC' : '#FFFFFF',
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? BLUE : BORDER,
      }}
      testID={`user-form-role-${name}`}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? BLUE : '#AEB7C5',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
          flexShrink: 0,
        }}
      >
        {selected ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: BLUE,
            }}
          />
        ) : null}
      </View>
      <View style={{ gap: 2, flexShrink: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: INK }}>
          {name}
        </Text>
        <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
          {desc}
        </Text>
      </View>
    </Pressable>
  );
}

export function UserFormScreen() {
  const navigation = useNavigation<UserFormNavigationProp>();
  const route = useRoute<UserFormRouteProp>();
  const insets = useSafeAreaInsets();
  const editingUser = route.params?.user;
  const isEditing = Boolean(editingUser);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(
    editingUser?.photoUrl ? resolveFileUrl(editingUser.photoUrl) : null,
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [revoking, setRevoking] = useState(false);
  /**
   * The new-password field is plain `useState`, not part of `useForm`:
   * it posts to its own endpoint (`POST /users/:id/password`) rather than
   * riding along with "Save changes", so keeping it out of the form's
   * values also keeps it out of `stripBlanks`' payload for `PATCH`.
   */
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);
  /** `null` until the admin actually revokes, so the confirmation line only appears after the fact. */
  const [revokedCount, setRevokedCount] = useState<number | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    defaultValues: {
      name: editingUser?.name ?? '',
      email: editingUser?.email ?? '',
      role:
        (editingUser?.role as TenantAssignableRoleKey) ?? 'MARKETING_EXECUTIVE',
      status: editingUser?.status ?? 'ACTIVE',
      username: editingUser?.username ?? '',
      temporaryPassword: '',
      mobile: '',
      // Regrouped for display — the API stores and returns 12 bare digits.
      personalIdentity: formatAadhaar(editingUser?.personalIdentity ?? ''),
      // `monthlySalary` is a plain mutable field (unlike `halfDayRate`,
      // below) — pre-filled with the current value so editing it is a
      // normal overwrite, not a blank "enter a new value" field.
      monthlySalary: editingUser?.monthlySalary ?? '',
      // Deliberately blank even when editing: per FR-020/data-model.md,
      // typing a value here creates a NEW effective-dated `UserSalaryRate`
      // row (see `applyRateChange` server-side) — it is never an edit of
      // the existing open-ended one, so pre-filling it with the current
      // rate would wrongly suggest that's what submitting does. The
      // current rate/date are shown as read-only captions instead, below.
      halfDayRate: '',
      rateEffectiveFrom: '',
    },
  });

  const role = watch('role');
  const isEmployeeRole = role === 'EMPLOYEE';

  /**
   * Username and role are both editable (they were read-only captions
   * before). The other two login fields are not, and the split is about
   * what `updateUserSchema` actually accepts rather than about the layout:
   * `PATCH /users/:id` takes `username` but has no `temporaryPassword`/
   * `mobile`, so rendering those on the edit path would silently discard
   * whatever was typed into them.
   */
  const showCredentialFields = !isEditing && !isEmployeeRole;

  /**
   * On create this follows the role, per FR-017. On edit it also stays
   * visible for an EMPLOYEE who already has a stored username — demoting
   * someone keeps their credentials dormant rather than clearing them, so
   * hiding the field there would make an existing username look deleted.
   */
  const showUsernameField = isEditing
    ? !isEmployeeRole || Boolean(editingUser?.username)
    : !isEmployeeRole;

  const roleChanged = Boolean(editingUser) && role !== editingUser?.role;
  const demotingToEmployee = roleChanged && isEmployeeRole;
  /**
   * Promoting a user who has never had credentials at all. The role change
   * on its own still doesn't let them sign in — they need a username (this
   * screen's own field, saved with the role) and a password (the separate
   * "Password" group below, which posts to its own endpoint). Called out
   * explicitly rather than left to be discovered as a broken login.
   */
  const promotedWithoutLogin =
    roleChanged &&
    !isEmployeeRole &&
    editingUser?.role === 'EMPLOYEE' &&
    !editingUser?.username;

  async function pickAndUploadPhoto(): Promise<void> {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }

    const formData = new FormData();
    // SAFETY: React Native's FormData accepts this { uri, name, type }
    // file-descriptor shape for a multipart field (RN's own documented
    // FormData extension, not the DOM's Blob-only signature TypeScript's
    // lib.dom.d.ts declares) — there is no RN-specific FormData type
    // package in this project to type this more precisely against.
    formData.append('photo', {
      uri: asset.uri,
      name: asset.fileName ?? 'photo.jpg',
      type: asset.type ?? 'image/jpeg',
    });

    setUploadingPhoto(true);
    setSubmitError(null);
    try {
      const uploaded = await apiRequest<{ id: string; url: string }>(
        '/files/avatars',
        {
          method: 'POST',
          body: formData,
          idempotencyKey: generateIdempotencyKey(),
        },
      );
      setPhotoFileId(uploaded.id);
      setPhotoPreviewUrl(resolveFileUrl(uploaded.url));
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    } finally {
      setUploadingPhoto(false);
    }
  }

  /**
   * `POST /users/:id/revoke-sessions` — signs this user out everywhere
   * (server-side: `tokenVersion` bump + every refresh token revoked).
   *
   * Confirmed first because it is not undoable and is felt immediately by
   * someone else. The confirmation deliberately mentions the
   * aim-at-yourself case rather than trying to detect it: `StoredSession`
   * holds only the tokens and the role, not the signed-in user's id, so
   * detecting it would mean decoding the access token's `sub` claim on the
   * device just to vary one sentence.
   */
  function confirmRevokeSessions(): void {
    if (!editingUser) {
      return;
    }
    Alert.alert(
      'Sign out of all devices?',
      `${editingUser.name} will be signed out everywhere and will have to sign in again. If this is your own account, you'll be signed out too.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void revokeSessions();
          },
        },
      ],
    );
  }

  async function revokeSessions(): Promise<void> {
    if (!editingUser) {
      return;
    }
    setSubmitError(null);
    setRevoking(true);
    try {
      const result = await apiRequest<{ revokedSessions: number }>(
        `/users/${editingUser.id}/revoke-sessions`,
        { method: 'POST', idempotencyKey: generateIdempotencyKey() },
      );
      setRevokedCount(result.revokedSessions);
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    } finally {
      setRevoking(false);
    }
  }

  /**
   * `POST /users/:id/password`. Validated against the shared
   * `setUserPasswordSchema` so the admin sees the FR-013 policy message
   * here rather than as a round-tripped 400, exactly as the create path
   * leans on `createUserSchema`.
   */
  async function setPasswordForUser(): Promise<void> {
    if (!editingUser) {
      return;
    }
    setSubmitError(null);
    setPasswordDone(false);

    const parsed = setUserPasswordSchema.safeParse({ newPassword });
    if (!parsed.success) {
      setNewPasswordError(
        parsed.error.issues[0]?.message ?? 'That password is not allowed.',
      );
      return;
    }
    setNewPasswordError(null);

    setSettingPassword(true);
    try {
      await apiRequest(`/users/${editingUser.id}/password`, {
        method: 'POST',
        body: parsed.data,
        idempotencyKey: generateIdempotencyKey(),
      });
      setNewPassword('');
      setPasswordDone(true);
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    } finally {
      setSettingPassword(false);
    }
  }

  /**
   * Routes `{ path, message }` pairs — from the shared schema or from the
   * API's `VALIDATION_FAILED` body — onto the field they name, so they
   * render under that input like every other message on this form. Returns
   * how many it placed; anything it could not place (a cross-field issue,
   * an unknown path) stays the caller's problem to show under Save.
   */
  function applyFieldIssues(
    issues: Array<{ path: string; message: string }>,
  ): number {
    let placed = 0;
    for (const issue of issues) {
      const field = issue.path.split('.')[0];
      if (field && field in ERROR_RENDERING_FIELDS && issue.message) {
        setError(field as keyof UserFormValues, {
          type: 'server',
          message: issue.message,
        });
        placed += 1;
      }
    }
    return placed;
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const cleaned = stripBlanks(values);
    if (photoFileId) {
      cleaned.photoFileId = photoFileId;
    }

    const schema = isEditing ? updateUserSchema : createUserSchema;
    const parsed = schema.safeParse(cleaned);
    if (!parsed.success) {
      // `rules` above have already caught the per-field format mistakes;
      // what reaches here is mostly the role-dependent requirements
      // `createUserSchema.superRefine` owns ("username is required when
      // role is not EMPLOYEE"). Those carry a path too, so they belong
      // under their field rather than in one line at the bottom.
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      if (applyFieldIssues(issues) === 0) {
        setSubmitError(issues[0]?.message ?? 'Invalid input.');
      }
      return;
    }

    try {
      if (isEditing && editingUser) {
        await apiRequest(`/users/${editingUser.id}`, {
          method: 'PATCH',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      } else {
        await apiRequest('/users', {
          method: 'POST',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      }
      navigation.goBack();
    } catch (error) {
      // A 400 carries the same `{ path, message }` pairs
      // (`zod-validation.pipe.ts`), so a rule this build's copy of the
      // schema does not have yet still lands under its own field.
      const details =
        error instanceof ApiError && error.code === 'VALIDATION_FAILED'
          ? (error.details ?? [])
          : [];
      if (applyFieldIssues(details) === 0) {
        setSubmitError(errorMessageFor(error));
      }
    }
  });

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
          gap: 14,
        }}
        style={{ flex: 1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            accessibilityLabel={isEditing ? 'Back' : 'Close'}
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
              shapes={isEditing ? ICON_BACK : ICON_CLOSE}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
          <Text
            style={{ fontSize: 24, fontWeight: '700', color: INK, flexGrow: 1 }}
          >
            {isEditing ? 'Edit user' : 'New user'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable
            accessibilityLabel="Add photo"
            disabled={uploadingPhoto}
            onPress={() => {
              void pickAndUploadPhoto();
            }}
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: '#AEB7C5',
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
            testID="user-form-photo-picker"
          >
            {uploadingPhoto ? (
              <ActivityIndicator />
            ) : photoPreviewUrl ? (
              <Image
                source={{ uri: photoPreviewUrl }}
                style={{ width: 72, height: 72 }}
              />
            ) : (
              <OutlineIcon
                color={MUTED}
                shapes={ICON_CAMERA}
                size={26}
                strokeWidth={1.8}
              />
            )}
          </Pressable>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: INK }}>
              Profile photo
            </Text>
            <Controller
              control={control}
              name="status"
              render={({ field: { onChange, value } }) => (
                <Checkbox
                  checked={value === 'ACTIVE'}
                  label="Active"
                  onToggle={() =>
                    onChange(value === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
                  }
                />
              )}
            />
          </View>
        </View>

        <Group>
          <SectionLabel>Identity &amp; login</SectionLabel>

          <View>
            <FieldLabel>Full name</FieldLabel>
            <Controller
              control={control}
              name="name"
              render={({ field: { onBlur, onChange, value } }) => (
                <TextInput
                  onBlur={onBlur}
                  onChangeText={onChange}
                  style={inputStyleFor(Boolean(errors.name))}
                  testID="user-form-name"
                  value={value}
                />
              )}
              rules={{
                required: 'Name is required.',
                validate: VALIDATE.name,
              }}
            />
            <FieldError>{errors.name?.message}</FieldError>
          </View>

          <View>
            <FieldLabel>Email</FieldLabel>
            <Controller
              control={control}
              name="email"
              render={({ field: { onBlur, onChange, value } }) => (
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  style={inputStyleFor(Boolean(errors.email))}
                  testID="user-form-email"
                  value={value}
                />
              )}
              rules={{ validate: VALIDATE.email }}
            />
            <FieldError>{errors.email?.message}</FieldError>
          </View>

          {showUsernameField || showCredentialFields ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {showUsernameField ? (
                <View style={{ flex: 1 }}>
                  <FieldLabel>Username</FieldLabel>
                  <Controller
                    control={control}
                    name="username"
                    render={({ field: { onBlur, onChange, value } }) => (
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={USERNAME_MAX_LENGTH}
                        onBlur={onBlur}
                        onChangeText={onChange}
                        style={inputStyleFor(Boolean(errors.username))}
                        testID="user-form-username"
                        value={value}
                      />
                    )}
                    rules={{ validate: VALIDATE.username }}
                  />
                  <FieldError>{errors.username?.message}</FieldError>
                </View>
              ) : null}
              {showCredentialFields ? (
                <View style={{ flex: 1 }}>
                  <FieldLabel>Temp password</FieldLabel>
                  <Controller
                    control={control}
                    name="temporaryPassword"
                    render={({ field: { onBlur, onChange, value } }) => (
                      <PasswordInput
                        onBlur={onBlur}
                        onChangeText={onChange}
                        testID="user-form-temporary-password"
                        value={value}
                      />
                    )}
                  />
                  <FieldError>{errors.temporaryPassword?.message}</FieldError>
                </View>
              ) : null}
            </View>
          ) : null}

          {showCredentialFields ? (
            <View>
              <FieldLabel>Mobile</FieldLabel>
              <Controller
                control={control}
                name="mobile"
                render={({ field: { onBlur, onChange, value } }) => (
                  <TextInput
                    keyboardType="phone-pad"
                    maxLength={10}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    style={inputStyleFor(Boolean(errors.mobile))}
                    testID="user-form-mobile"
                    value={value}
                  />
                )}
                rules={{ validate: VALIDATE.mobile }}
              />
              <FieldError>{errors.mobile?.message}</FieldError>
            </View>
          ) : null}

          <View>
            <FieldLabel>Aadhaar number</FieldLabel>
            <Controller
              control={control}
              name="personalIdentity"
              render={({ field: { onBlur, onChange, value } }) => (
                <TextInput
                  keyboardType="number-pad"
                  // 12 digits + the 2 spaces this field inserts. The cap is
                  // belt-and-braces: `formatAadhaar` already discards
                  // anything past the 12th digit, so a paste of a longer
                  // string is truncated rather than refused.
                  maxLength={AADHAAR_DISPLAY_LENGTH}
                  onBlur={onBlur}
                  // Regroup on every keystroke, so the field reads
                  // "1234 5678 9012" as it is typed. Non-digits are
                  // dropped here rather than flagged — a letter or symbol
                  // simply never lands in the field, which is a quieter
                  // way to enforce "digits only" than an error message
                  // about a character the admin can already see is wrong.
                  onChangeText={(text) => onChange(formatAadhaar(text))}
                  placeholder="1234 5678 9012"
                  placeholderTextColor={MUTED}
                  style={[
                    inputStyleFor(Boolean(errors.personalIdentity)),
                    { fontFamily: 'monospace' },
                  ]}
                  testID="user-form-personal-identity"
                  value={value}
                />
              )}
              rules={{ validate: VALIDATE.aadhaar }}
            />
            <FieldError>{errors.personalIdentity?.message}</FieldError>
          </View>

          {isEditing && showUsernameField ? (
            <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
              Changing the username changes what this person signs in with —
              their password is unaffected.
            </Text>
          ) : null}

          {!isEditing ? (
            <Text style={{ fontSize: 12, color: MUTED }}>
              Plain employees don&apos;t sign in — login fields are hidden for
              the Employee role.
            </Text>
          ) : null}
        </Group>

        <Group>
          <SectionLabel>Role</SectionLabel>
          <Controller
            control={control}
            name="role"
            render={({ field: { onChange, value } }) => (
              <View style={{ gap: 10 }}>
                {ROLE_OPTIONS.map((option) => (
                  <RoleCard
                    desc={option.desc}
                    key={option.key}
                    name={option.name}
                    onPress={() => onChange(option.key)}
                    selected={value === option.key}
                  />
                ))}
              </View>
            )}
          />

          {demotingToEmployee ? (
            <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
              Employees don&apos;t sign in, so saving this stops their login.
              Their username and password are kept, so putting them back on
              their old role later restores the same login.
            </Text>
          ) : null}

          {promotedWithoutLogin ? (
            <Text
              style={{ fontSize: 12, color: DANGER, lineHeight: 17 }}
              testID="user-form-role-no-login-warning"
            >
              This person has never had a login, so this role change alone
              won&apos;t let them sign in — give them a username above, save,
              then set a password under &ldquo;Password&rdquo;.
            </Text>
          ) : null}

          {roleChanged ? (
            <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
              If they&apos;re signed in right now, the new role applies the next
              time their session refreshes — within about 15 minutes.
            </Text>
          ) : null}
        </Group>

        <Group>
          <SectionLabel>Pay</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>Monthly salary (₹)</FieldLabel>
              <Controller
                control={control}
                name="monthlySalary"
                render={({ field: { onBlur, onChange, value } }) => (
                  <TextInput
                    keyboardType="decimal-pad"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    style={[
                      inputStyleFor(Boolean(errors.monthlySalary)),
                      { fontFamily: 'monospace' },
                    ]}
                    testID="user-form-monthly-salary"
                    value={value}
                  />
                )}
                rules={{ validate: VALIDATE.amount }}
              />
              <FieldError>{errors.monthlySalary?.message}</FieldError>
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>Half-day rate (₹)</FieldLabel>
              <Controller
                control={control}
                name="halfDayRate"
                render={({ field: { onBlur, onChange, value } }) => (
                  <TextInput
                    keyboardType="decimal-pad"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder={editingUser?.halfDayRate ?? undefined}
                    placeholderTextColor={MUTED}
                    style={[
                      inputStyleFor(Boolean(errors.halfDayRate)),
                      { fontFamily: 'monospace' },
                    ]}
                    testID="user-form-half-day-rate"
                    value={value}
                  />
                )}
                rules={{ validate: VALIDATE.amount }}
              />
              <FieldError>{errors.halfDayRate?.message}</FieldError>
            </View>
          </View>
          {isEditing && editingUser?.halfDayRate ? (
            <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
              Showing today&apos;s rate as a placeholder above — entering a new
              rate and date here adds a new rate effective from that date; it
              never overwrites the current one.
            </Text>
          ) : null}

          <View>
            <FieldLabel>Rate effective from</FieldLabel>
            <Controller
              control={control}
              name="rateEffectiveFrom"
              render={({ field: { onChange, value } }) => (
                <Pressable
                  onPress={() =>
                    DateTimePickerAndroid.open({
                      value: parseDate(
                        value || editingUser?.rateEffectiveFrom || '',
                      ),
                      mode: 'date',
                      onChange: (_event, selectedDate) => {
                        if (selectedDate) {
                          onChange(formatDate(selectedDate));
                        }
                      },
                    })
                  }
                  style={[
                    inputStyleFor(Boolean(errors.rateEffectiveFrom)),
                    { justifyContent: 'center' },
                  ]}
                  testID="user-form-rate-effective-from"
                >
                  <Text
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 15,
                      fontWeight: '500',
                      color: value ? INK : MUTED,
                    }}
                  >
                    {value || editingUser?.rateEffectiveFrom || 'YYYY-MM-DD'}
                  </Text>
                </Pressable>
              )}
              rules={{
                // The picker can only ever emit a real `YYYY-MM-DD`
                // (`formatDate`), so this never fires from normal use — it
                // is here so the rule is stated alongside the others, and
                // so a future free-text entry point inherits it.
                validate: VALIDATE.isoDate,
              }}
            />
            <FieldError>{errors.rateEffectiveFrom?.message}</FieldError>
          </View>

          <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
            Rate changes are effective-dated so past salary runs reproduce
            exactly. Role and rate changes are recorded in the audit log.
          </Text>
        </Group>

        {isEditing ? (
          <Group>
            <SectionLabel>Password</SectionLabel>
            <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
              Sets a new password for this person — use it when they&apos;re
              locked out and can&apos;t complete the SMS reset themselves.
              Saving it signs them out of all their devices.
            </Text>

            <View>
              <FieldLabel>New password</FieldLabel>
              <PasswordInput
                onChangeText={(text) => {
                  setNewPassword(text);
                  setNewPasswordError(null);
                  setPasswordDone(false);
                }}
                testID="user-form-new-password"
                value={newPassword}
              />
              {newPasswordError ? (
                <Text style={{ marginTop: 4, fontSize: 12, color: DANGER }}>
                  {newPasswordError}
                </Text>
              ) : null}
            </View>

            <Pressable
              disabled={settingPassword || newPassword.length === 0}
              onPress={() => {
                void setPasswordForUser();
              }}
              style={{
                height: 48,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: BLUE,
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: settingPassword || newPassword.length === 0 ? 0.6 : 1,
              }}
              testID="user-form-set-password"
            >
              {settingPassword ? (
                <ActivityIndicator color={BLUE} />
              ) : (
                <Text style={{ fontSize: 15, fontWeight: '700', color: BLUE }}>
                  Set password
                </Text>
              )}
            </Pressable>

            {passwordDone ? (
              <Text
                style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}
                testID="user-form-set-password-result"
              >
                Password updated. Tell them the new password directly — it
                isn&apos;t shown again, and they were signed out everywhere.
              </Text>
            ) : null}

            {!editingUser?.username ? (
              <Text style={{ fontSize: 12, color: DANGER, lineHeight: 17 }}>
                This person has no username yet, so a password alone won&apos;t
                let them sign in — give them one above and save first.
              </Text>
            ) : null}
          </Group>
        ) : null}

        {isEditing ? (
          <Group>
            <SectionLabel>Sessions</SectionLabel>
            <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
              Signs this person out of every device they&apos;re currently
              signed in on. Use it if a phone is lost or shared. It takes effect
              at once and doesn&apos;t change their password.
            </Text>
            <Pressable
              disabled={revoking}
              onPress={confirmRevokeSessions}
              style={{
                height: 48,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: DANGER,
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: revoking ? 0.6 : 1,
              }}
              testID="user-form-revoke-sessions"
            >
              {revoking ? (
                <ActivityIndicator color={DANGER} />
              ) : (
                <Text
                  style={{ fontSize: 15, fontWeight: '700', color: DANGER }}
                >
                  Sign out of all devices
                </Text>
              )}
            </Pressable>
            {revokedCount !== null ? (
              <Text
                style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}
                testID="user-form-revoke-sessions-result"
              >
                {revokedCount === 0
                  ? 'Done — they had no active sessions to sign out.'
                  : `Done — signed out of ${revokedCount} ${
                      revokedCount === 1 ? 'session' : 'sessions'
                    }.`}
              </Text>
            ) : null}
          </Group>
        ) : null}

        {submitError ? (
          <Text
            style={{ fontSize: 14, color: DANGER }}
            testID="user-form-error"
          >
            {submitError}
          </Text>
        ) : null}

        <Pressable
          disabled={isSubmitting || uploadingPhoto}
          onPress={() => {
            void onSubmit();
          }}
          style={{
            height: 54,
            borderRadius: 14,
            backgroundColor: BLUE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID="user-form-submit"
        >
          {isSubmitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>
              {isEditing ? 'Save changes' : 'Create user'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
