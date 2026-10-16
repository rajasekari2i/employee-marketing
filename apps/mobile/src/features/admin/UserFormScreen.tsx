import { useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
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
  updateUserSchema,
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
 * the old read-only text box / pill selector.
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
  disabled,
  onPress,
}: {
  name: string;
  desc: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
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
        opacity: disabled && !selected ? 0.5 : 1,
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

  const {
    control,
    handleSubmit,
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
  const showLoginFields = !isEditing && role !== 'EMPLOYEE';

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

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const cleaned = stripBlanks(values);
    if (photoFileId) {
      cleaned.photoFileId = photoFileId;
    }

    try {
      if (isEditing && editingUser) {
        const parsed = updateUserSchema.safeParse(cleaned);
        if (!parsed.success) {
          setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid input.');
          return;
        }
        await apiRequest(`/users/${editingUser.id}`, {
          method: 'PATCH',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      } else {
        const parsed = createUserSchema.safeParse(cleaned);
        if (!parsed.success) {
          setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid input.');
          return;
        }
        await apiRequest('/users', {
          method: 'POST',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      }
      navigation.goBack();
    } catch (error) {
      setSubmitError(errorMessageFor(error));
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
                  style={INPUT_STYLE}
                  testID="user-form-name"
                  value={value}
                />
              )}
              rules={{ required: 'Name is required.' }}
            />
            {errors.name ? (
              <Text style={{ marginTop: 4, fontSize: 12, color: DANGER }}>
                {errors.name.message}
              </Text>
            ) : null}
          </View>

          <View>
            <FieldLabel>Email</FieldLabel>
            <Controller
              control={control}
              name="email"
              render={({ field: { onBlur, onChange, value } }) => (
                <TextInput
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  style={INPUT_STYLE}
                  testID="user-form-email"
                  value={value}
                />
              )}
            />
          </View>

          {showLoginFields ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <FieldLabel>Username</FieldLabel>
                  <Controller
                    control={control}
                    name="username"
                    render={({ field: { onBlur, onChange, value } }) => (
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        onBlur={onBlur}
                        onChangeText={onChange}
                        style={INPUT_STYLE}
                        testID="user-form-username"
                        value={value}
                      />
                    )}
                  />
                </View>
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
                </View>
              </View>

              <View>
                <FieldLabel>Mobile</FieldLabel>
                <Controller
                  control={control}
                  name="mobile"
                  render={({ field: { onBlur, onChange, value } }) => (
                    <TextInput
                      keyboardType="phone-pad"
                      onBlur={onBlur}
                      onChangeText={onChange}
                      style={INPUT_STYLE}
                      testID="user-form-mobile"
                      value={value}
                    />
                  )}
                />
              </View>
            </>
          ) : null}

          {isEditing && editingUser?.username ? (
            <Text style={{ fontSize: 12, color: MUTED }}>
              Username: {editingUser.username} (not editable here)
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
                    disabled={isEditing}
                    key={option.key}
                    name={option.name}
                    onPress={() => onChange(option.key)}
                    selected={value === option.key}
                  />
                ))}
              </View>
            )}
          />
          {isEditing ? (
            <Text style={{ fontSize: 12, color: MUTED }}>
              Role isn&apos;t editable here once a user is created.
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
                    style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
                    testID="user-form-monthly-salary"
                    value={value}
                  />
                )}
              />
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
                    style={[INPUT_STYLE, { fontFamily: 'monospace' }]}
                    testID="user-form-half-day-rate"
                    value={value}
                  />
                )}
              />
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
                  style={[INPUT_STYLE, { justifyContent: 'center' }]}
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
            />
          </View>

          <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
            Rate changes are effective-dated so past salary runs reproduce
            exactly. Role and rate changes are recorded in the audit log.
          </Text>
        </Group>

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
