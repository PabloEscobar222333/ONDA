import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['merchant', 'customer']);
export const settlementTypeEnum = pgEnum('settlement_type', ['momo', 'bank']);
export const momoNetworkEnum = pgEnum('momo_network', ['MTN', 'Telecel', 'AirtelTigo']);

export const paymentStructureEnum = pgEnum('payment_structure', [
  'deposit_daily',
  'deposit_weekly',
  'deposit_monthly',
]);
export const reminderFrequencyEnum = pgEnum('reminder_frequency', ['daily', 'every_3_days', 'weekly', 'none']);
export const creditEventStatusEnum = pgEnum('credit_event_status', ['active', 'overdue', 'disputed', 'closed']);
export const acceptanceStatusEnum = pgEnum('acceptance_status', ['pending_acceptance', 'accepted']);

export const paymentMethodEnum = pgEnum('payment_method', [
  'mtn_momo',
  'telecel_cash',
  'airteltigo',
  'card',
  'bank_transfer',
  'cash',
]);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'confirmed', 'failed']);
export const paymentInitiatorEnum = pgEnum('payment_initiator', ['merchant', 'customer']);

export const disputeTypeEnum = pgEnum('dispute_type', [
  'incorrect_amount',
  'already_paid',
  'wrong_item',
  'other',
]);
export const disputeStatusEnum = pgEnum('dispute_status', ['open', 'resolved', 'rejected']);
export const disputeRaisedByEnum = pgEnum('dispute_raised_by', ['merchant', 'customer']);

export const notificationTypeEnum = pgEnum('notification_type', [
  'new_credit_event',
  'payment_reminder',
  'payment_confirmed_customer',
  'payment_confirmed_merchant',
  'cash_payment_awaiting',
  'dispute_opened',
  'credit_fully_paid',
]);

export const trustRatingEnum = pgEnum('trust_rating', ['Building', 'Fair', 'Good', 'Excellent']);

export const users = pgTable(
  'users',
  {
    // The primary key IS the Firebase UID. All providers (Google, Apple, Email/Password)
    // for one user share a single Firebase account via account linking, so one UID
    // identifies one human across all sign-in methods. Phone is no longer the auth key
    // but is kept as an optional contact field for merchant credit-event lookups.
    id: text('id').primaryKey(),
    email: text('email'),
    fullName: text('full_name'),
    photoUrl: text('photo_url'),
    providers: text('providers').array().notNull().default(sql`'{}'::text[]`),
    phoneNumber: text('phone_number'),
    displayName: text('display_name'),
    activeRole: roleEnum('active_role'),
    fcmToken: text('fcm_token'),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    reminderEnabled: boolean('reminder_enabled').notNull().default(true),
    marketingEnabled: boolean('marketing_enabled').notNull().default(false),
    privacyVisible: boolean('privacy_visible').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
    phoneIdx: uniqueIndex('users_phone_idx').on(t.phoneNumber),
  })
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  })
);

export const merchantProfiles = pgTable('merchant_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  businessName: text('business_name').notNull(),
  businessType: text('business_type'),
  ownerName: text('owner_name').notNull(),
  location: text('location'),
  region: text('region'),
  digitalAddress: text('digital_address'),
  kycVerified: boolean('kyc_verified').notNull().default(false),
  // Storage object KEY for the merchant's profile photo (not a URL — a fresh
  // signed URL is minted on read). Lives in the KYC bucket under profiles/.
  profilePhotoKey: text('profile_photo_key'),
  settlementType: settlementTypeEnum('settlement_type'),
  settlementDetails: jsonb('settlement_details').$type<Record<string, unknown>>(),
  settlementVerified: boolean('settlement_verified').notNull().default(false),
  kycGhanaCardNumber: text('kyc_ghana_card_number'),
  kycSelfieUrl: text('kyc_selfie_url'),
  kycSubmittedAt: timestamp('kyc_submitted_at', { withTimezone: true }),
  activated: boolean('activated').notNull().default(false),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerProfiles = pgTable('customer_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  trustScore: integer('trust_score').notNull().default(20),
  trustRating: trustRatingEnum('trust_rating').notNull().default('Building'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const creditEvents = pgTable(
  'credit_events',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id').notNull().references(() => users.id),
    customerId: text('customer_id').notNull().references(() => users.id),
    merchantName: text('merchant_name').notNull(),
    customerName: text('customer_name').notNull(),
    customerGhanaCard: text('customer_ghana_card'),
    customerGhanaCardPhotoUrl: text('customer_ghana_card_photo_url'),
    itemDescription: text('item_description').notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    outstandingBalance: numeric('outstanding_balance', { precision: 12, scale: 2 }).notNull(),
    paymentStructure: paymentStructureEnum('payment_structure').notNull(),
    schedule: jsonb('schedule').$type<ScheduleItem[]>().notNull(),
    reminderFrequency: reminderFrequencyEnum('reminder_frequency').notNull().default('weekly'),
    status: creditEventStatusEnum('status').notNull().default('active'),
    acceptanceStatus: acceptanceStatusEnum('acceptance_status').notNull().default('pending_acceptance'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: index('credit_events_merchant_idx').on(t.merchantId, t.status),
    customerIdx: index('credit_events_customer_idx').on(t.customerId, t.status),
  })
);

export type ScheduleItem = {
  id: string;
  dueDate: string;
  amount: number;
  status: 'upcoming' | 'due' | 'paid' | 'overdue';
};

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    creditEventId: text('credit_event_id').notNull().references(() => creditEvents.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    method: paymentMethodEnum('method').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    initiator: paymentInitiatorEnum('initiator').notNull(),
    isInitialDeposit: boolean('is_initial_deposit').notNull().default(false),
    confirmedByCustomer: boolean('confirmed_by_customer').notNull().default(false),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    clientNonce: text('client_nonce'),
    note: text('note'),
    paystackReference: text('paystack_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index('payments_event_idx').on(t.creditEventId, t.status),
    nonceIdx: uniqueIndex('payments_nonce_idx').on(t.creditEventId, t.clientNonce),
  })
);

export const disputes = pgTable(
  'disputes',
  {
    id: text('id').primaryKey(),
    creditEventId: text('credit_event_id').notNull().references(() => creditEvents.id, { onDelete: 'cascade' }),
    raisedBy: disputeRaisedByEnum('raised_by').notNull(),
    raisedByUserId: text('raised_by_user_id').notNull().references(() => users.id),
    type: disputeTypeEnum('type').notNull(),
    description: text('description').notNull(),
    status: disputeStatusEnum('status').notNull().default('open'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index('disputes_event_idx').on(t.creditEventId),
  })
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.userId, t.isRead, t.createdAt),
  })
);

export const reminderLog = pgTable(
  'reminder_log',
  {
    id: text('id').primaryKey(),
    creditEventId: text('credit_event_id').notNull().references(() => creditEvents.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    sentByUserId: text('sent_by_user_id').notNull().references(() => users.id),
  },
  (t) => ({
    eventTimeIdx: index('reminder_log_event_time_idx').on(t.creditEventId, t.sentAt),
  })
);

export const trustScoreHistory = pgTable(
  'trust_score_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    score: integer('score').notNull(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userPeriodIdx: uniqueIndex('trust_score_history_user_period_idx').on(t.userId, t.period),
  })
);
