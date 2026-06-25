-- Create device_tokens table for FCM push notifications.
-- Mirrors shared/schema.ts deviceTokens; was added via db:push in dev but never
-- migrated to prod, so register-token inserts and sendPushToUser selects failed silently.
CREATE TABLE IF NOT EXISTS "device_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "platform" varchar(20) NOT NULL DEFAULT 'android',
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "device_tokens_user_id_idx" ON "device_tokens" ("user_id");
