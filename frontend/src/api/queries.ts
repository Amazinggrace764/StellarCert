/// <reference types="vite/client" />
import {
  type QueryClient,
  type QueryFunctionContext,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ApproveTransferDto,
  CertificateTemplate,
  CreateCertificateData,
  InitiateTransferDto,
  Notification,
  NotificationPreferences,
  ProfileUpdateData,
  RejectTransferDto,
  User,
  UserProfile,
  VerifyEmailRequest,
} from "./types";
import {
  adminAnalyticsApi,
  apiClient,
  auditApi,
  authApi,
  certificateApi,
  createCertificate,
  fetchDefaultTemplate,
  getUserCertificates,
  issuerProfileApi,
  revokeCertificate,
  templateApi,
  userApi,
} from "./endpoints";
import { dummyData } from "./dummyData";

/**
 * Central registry of cache keys.
 *
 * Keys are nested so a mutation can invalidate a whole family of queries with
 * a prefix match, e.g. `queryKeys.certificates.root` matches the admin list,
 * a user's wallet and any per-certificate lookup.
 */
export const queryKeys = {
  session: () => ["auth", "session"] as const,
  notifications: {
    root: ["notifications"] as const,
    list: () => ["notifications", "list"] as const,
    preferences: () => ["notifications", "preferences"] as const,
  },
  users: {
    root: ["users"] as const,
    list: (params: unknown) => ["users", "list", params] as const,
    profile: () => ["users", "profile"] as const,
  },
  certificates: {
    root: ["certificates"] as const,
    list: (params: unknown) => ["certificates", "list", params] as const,
    user: (userId: string) => ["certificates", "user", userId] as const,
    verification: (serialNumber: string) =>
      ["certificates", "verify", serialNumber] as const,
    history: (certificateId: string) =>
      ["certificates", "history", certificateId] as const,
  },
  templates: () => ["templates"] as const,
  analytics: {
    root: ["analytics"] as const,
    admin: (params: unknown) => ["analytics", "admin", params] as const,
  },
  audit: {
    root: ["audit"] as const,
    statistics: (params: unknown) => ["audit", "statistics", params] as const,
    search: (params: unknown) => ["audit", "search", params] as const,
  },
  issuer: {
    root: ["issuer"] as const,
    stats: () => ["issuer", "stats"] as const,
    activity: (params: unknown) => ["issuer", "activity", params] as const,
  },
} as const;

export type CertificateListParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  startDate?: string;
  endDate?: string;
};

export type DateRangeParams = { startDate?: string; endDate?: string };

// ── Dummy data gating ──────────────────────────────────────────────────────

/**
 * `VITE_USE_DUMMY_DATA` must be referenced statically as
 * `import.meta.env.VITE_USE_DUMMY_DATA` so Vite can fold the flag at build
 * time. When it is `false`, the `if (USE_DUMMY_DATA)` branches below are
 * dead-code-eliminated and the `dummyData` import is dropped from the
 * production bundle. Do not hoist this into a `const` read at runtime.
 */
const USE_DUMMY_DATA = import.meta.env.VITE_USE_DUMMY_DATA === "true";

/**
 * Returns `dummy` only when the compile-time flag is enabled. The ternary is
 * intentionally written inline at each call site so the bundler can prove the
 * dummy branch is unreachable in production builds.
 */
const withDummyData = <T,>(dummy: T, real: () => T): T =>
  USE_DUMMY_DATA ? dummy : real();

// ── User normalization ─────────────────────────────────────────────────────

/**
 * The API returns users in several shapes: a bare `User`, a `UserProfile`
 * (which always carries `firstName`/`lastName`), or a paginated envelope
 * (`{ users: [...] }` / `{ data: [...] }`). Normalize once at this boundary so
 * every consumer receives a `User` whose name fields are guaranteed present.
 */
export const normalizeUser = (raw: User | UserProfile): User => {
  const candidate = raw as User & Partial<UserProfile> & { name?: string };
  const name = typeof candidate.name === "string" ? candidate.name : undefined;
  const firstName =
    candidate.firstName ?? (name ? name.split(" ")[0] : "") ?? "";
  const lastName =
    candidate.lastName ??
    (name ? name.split(" ").slice(1).join(" ") : "");
  return { ...candidate, firstName, lastName };
};

const normalizeUserList = (
  data: User[] | { users: User[] } | { data: User[] },
): User[] => {
  const list = Array.isArray(data)
    ? data
    : "users" in data && Array.isArray(data.users)
      ? data.users
      : data.data;
  return list.map(normalizeUser);
};

export const seedSessionUser = (queryClient: QueryClient, user: User | UserProfile) =>
  queryClient.setQueryData(queryKeys.session(), normalizeUser(user));

// ── Session ────────────────────────────────────────────────────────────────

/**
 * Session bootstrap: rehydrates from the HttpOnly refresh cookie.
 *
 * `authApi.refresh` already coalesces concurrent callers and rate-limits, so the
 * query layer must not add retries, and the result never goes stale.
 */
export const useSessionQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.session(),
    queryFn: async () => normalizeUser(await authApi.refresh()),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

// ── Certificates ───────────────────────────────────────────────────────────

/**
 * Certificates held by one user. Shared by the recipient dashboard and the
 * wallet page, so moving between those routes costs at most one request.
 */
export const useUserCertificatesQuery = (userId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.certificates.user(userId ?? ""),
    queryFn: () =>
      withDummyData(dummyData.userCertificates, () =>
        getUserCertificates(userId as string),
      ),
    enabled: !!userId,
  });

export const useCertificatesQuery = (params: CertificateListParams) =>
  useQuery({
    queryKey: queryKeys.certificates.list(params),
    queryFn: () =>
      withDummyData(dummyData.certificates, () => certificateApi.list(params)),
    // Keep the previous page on screen while the next one loads, so paging
    // through results doesn't flash an empty table.
    placeholderData: keepPreviousData,
  });

export const useCertificateHistoryQuery = (certificateId: string | null) =>
  useQuery({
    queryKey: queryKeys.certificates.history(certificateId ?? ""),
    queryFn: () =>
      withDummyData(dummyData.certificateHistory, () =>
        auditApi.getCertificateHistory(certificateId as string),
      ),
    enabled: !!certificateId,
  });

/**
 * Verifies a serial number. Keyed by serial, so re-checking the same
 * certificate is answered from cache and in-flight lookups are de-duplicated.
 */
export const useVerifyCertificateQuery = (serialNumber: string) =>
  useQuery({
    queryKey: queryKeys.certificates.verification(serialNumber),
    queryFn: () =>
      withDummyData(dummyData.verification, () =>
        certificateApi.verify(serialNumber),
      ),
    enabled: serialNumber.trim().length > 2,
  });

// ── Templates ──────────────────────────────────────────────────────────────

export const useTemplatesQuery = () =>
  useQuery({
    queryKey: queryKeys.templates(),
    queryFn: async (): Promise<{
      templates: CertificateTemplate[];
      defaultTemplate: CertificateTemplate;
    }> => {
      const [templates, defaultTemplate] = await withDummyData(
        Promise.resolve([dummyData.templates, dummyData.defaultTemplate] as const),
        () =>
          Promise.all([templateApi.list(), fetchDefaultTemplate()]) as Promise<
            [CertificateTemplate[], CertificateTemplate]
          >,
      );
      return { templates, defaultTemplate };
    },
  });

// ── Analytics & audit ──────────────────────────────────────────────────────

export const useAdminAnalyticsQuery = (params: DateRangeParams) =>
  useQuery({
    queryKey: queryKeys.analytics.admin(params),
    queryFn: () =>
      withDummyData(dummyData.adminAnalytics, () =>
        adminAnalyticsApi.getAnalytics(params),
      ),
  });

// Single source of truth for dashboard statistics. `useDashboardSummaryQuery`
// was a duplicate that hit a different endpoint; it now delegates here so the
// cache key, endpoint and invalidation family stay consistent.
export const useDashboardSummaryQuery = (params: DateRangeParams) =>
  useAdminAnalyticsQuery(params);

export const useAuditStatisticsQuery = (params: DateRangeParams) =>
  useQuery({
    queryKey: queryKeys.audit.statistics(params),
    queryFn: () =>
      withDummyData(dummyData.auditStatistics, () =>
        auditApi.getStatistics(params),
      ),
  });

export const useAuditSearchQuery = (
  params: DateRangeParams & { limit?: number },
) =>
  useQuery({
    queryKey: queryKeys.audit.search(params),
    queryFn: () =>
      withDummyData(dummyData.auditLogs, () => auditApi.searchLogs(params)),
  });

// ── Users ──────────────────────────────────────────────────────────────────

// The authenticated user lives under the session key, which AuthProvider seeds
// from the login/refresh response. Sharing the key means a mounted
// `useUserProfileQuery` renders the already-cached user instead of re-fetching.
export const useUserProfileQuery = () =>
  useQuery({
    queryKey: queryKeys.session(),
    queryFn: async () =>
      withDummyData(dummyData.currentUser, async () =>
        normalizeUser(await userApi.getProfile()),
      ),
  });

export const useUserListQuery = (params: Record<string, string | number | boolean>) =>
  useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: async (): Promise<User[]> => {
      const data = await withDummyData(dummyData.users, () =>
        userApi.getAll(params),
      );
      return normalizeUserList(data as User[] | { users: User[] } | { data: User[] });
    },
  });

/**
 * Shared retry policy for issuer profile reads.
 *
 * The owning boundary for "blank panel with no feedback" is the query layer:
 * without a retry policy a transient failure surfaces immediately as an empty
 * panel, and without surfacing the error state the UI has nothing to render.
 * Retry only idempotent reads, and never retry client errors (4xx) since those
 * are deterministic and would just delay the error the user needs to see.
 */
const issuerReadRetry = (failureCount: number, error: unknown): boolean => {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 2;
};

// Issuer reads share a retry policy and expose `error`/`isError`/`refetch` to
// consumers so `IssuerProfile.tsx` can render a retryable error state instead
// of a silent blank panel.
export const useIssuerStatsQuery = () =>
  useQuery({
    queryKey: queryKeys.issuer.stats(),
    queryFn: () =>
      withDummyData(dummyData.issuerStats, () => issuerProfileApi.getStats()),
  });

export const useIssuerActivityQuery = (page = 1, limit = 10) =>
  useQuery({
    queryKey: queryKeys.issuer.activity({ page, limit }),
    queryFn: () =>
      withDummyData(dummyData.issuerActivity, () =>
        issuerProfileApi.getActivity(page, limit),
      ),
  });

// ── Notifications ──────────────────────────────────────────────────────────

export const useNotificationsQuery = (enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: () =>
      withDummyData(dummyData.notifications, () =>
        apiClient<Notification[]>("/notifications"),
      ),
    enabled,
  });

export const useNotificationPreferencesQuery = () =>
  useQuery({
    queryKey: queryKeys.notifications.preferences(),
    queryFn: () =>
      withDummyData(dummyData.notificationPreferences, () =>
        apiClient<NotificationPreferences>("/notifications/preferences"),
      ),
  });

// ── Invalidation helpers ───────────────────────────────────────────────────

/**
 * Anything derived from a certificate - lists, wallets, dashboards, audit
 * trails - is stale once a certificate is created, revoked or re-statused.
 */
export const useInvalidateCertificates = () => {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.certificates.root }),
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.root }),
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.root }),
    ]);
  };
};

export const useInvalidateUsers = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.users.root });
};

// ── Mutations ──────────────────────────────────────────────────────────────

// Mutation functions are wrapped rather than referenced directly: `useMutation`
// calls `mutationFn(variables, context)`, and a bare reference would hand the
// QueryClient context to a fetcher that has no business knowing about it.
export const useCreateCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: CreateCertificateData) => createCertificate(data),
    onSuccess: invalidateCertificates,
  });
};

export const useRevokeCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }) => revokeCertificate(id, reason),
    onSuccess: invalidateCertificates,
  });
};

export const useBulkRevokeCertificatesMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({
      certificateIds,
      reason,
    }: {
      certificateIds: string[];
      reason?: string;
    }) => certificateApi.bulkRevoke(certificateIds, reason),
    onSuccess: invalidateCertificates,
  });
};

export const useFreezeCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({
      certificateId,
      reason,
      durationDays,
    }: {
      certificateId: string;
      reason: string;
      durationDays: number;
    }) => certificateApi.freeze(certificateId, reason, durationDays),
    onSuccess: invalidateCertificates,
  });
};

export const useUnfreezeCertificateMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (certificateId: string) => certificateApi.unfreeze(certificateId),
    onSuccess: invalidateCertificates,
  });
};

export const useInitiateTransferMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: InitiateTransferDto) =>
      certificateApi.transfer.initiate(data),
    onSuccess: invalidateCertificates,
  });
};

export const useApproveTransferMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: ApproveTransferDto) => certificateApi.transfer.approve(data),
    onSuccess: invalidateCertificates,
  });
};

export const useRejectTransferMutation = () => {
  const invalidateCertificates = useInvalidateCertificates();
  return useMutation({
    mutationFn: (data: RejectTransferDto) => certificateApi.transfer.reject(data),
    onSuccess: invalidateCertificates,
  });
};

export const useUpdateIssuerProfileMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: ProfileUpdateData) =>
      issuerProfileApi.updateProfile(profile),
    // Profile updates are not idempotent from the user's perspective; a silent
    // retry could double-submit. Surface the error so the form can show it.
    retry: false,
    onSuccess: async (profile) => {
      // The profile form and the header both render the authenticated user.
      seedSessionUser(queryClient, profile);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issuer.root }),
      ]);
    },
  });
};

export const useSaveNotificationPreferencesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      apiClient<NotificationPreferences>("/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(preferences),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.notifications.preferences(), saved);
    },
  });
};

export const useMarkNotificationReadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/notifications/${id}/read`, { method: "PATCH" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list() });
      const previous = queryClient.getQueryData<Notification[]>(
        queryKeys.notifications.list(),
      );
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(),
        (current) =>
          current?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(queryKeys.notifications.list(), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    },
  });
};

export const useMarkAllNotificationsReadMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient("/notifications/read-all", { method: "PATCH" }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list() });
      const previous = queryClient.getQueryData<Notification[]>(
        queryKeys.notifications.list(),
      );
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(),
        (current) => current?.map((n) => ({ ...n, isRead: true })) ?? current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKeys.notifications.list(), context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    },
  });
};

/**
 * Explicit, user-triggered verification (the verifier dashboard's button).
 * The debounced auto-verify on the verify page uses the query above instead.
 */
export const useVerifyCertificateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serialNumber: string) => certificateApi.verify(serialNumber),
    onSuccess: (result, serialNumber) => {
      // Seed the cache so a later lookup of the same serial renders from cache
      // instead of re-verifying against the API.
      queryClient.setQueryData(
        queryKeys.certificates.verification(serialNumber),
        result,
      );
    },
  });
};

export const useVerifyEmailMutation = () =>
  useMutation({
    mutationFn: (data: VerifyEmailRequest) => authApi.verifyEmail(data),
    // Retrying a one-shot email confirmation would re-submit the token.
    retry: false,
  });
