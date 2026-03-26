-- name: GetUserPremiumFlag :one
SELECT is_premium FROM users WHERE id = ?;

-- name: GetSubscriptionByUser :one
SELECT id, user_id, stripe_customer_id, stripe_subscription_id,
       status, plan_id, current_period_end, created_at, updated_at
FROM subscriptions
WHERE user_id = ?;

-- name: UpsertSubscription :exec
INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, status, plan_id, current_period_end, created_at, updated_at)
VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (user_id) DO UPDATE SET
  stripe_customer_id = excluded.stripe_customer_id,
  stripe_subscription_id = excluded.stripe_subscription_id,
  status = excluded.status,
  plan_id = excluded.plan_id,
  current_period_end = excluded.current_period_end,
  updated_at = CURRENT_TIMESTAMP;

-- name: SetUserPremiumTrue :exec
UPDATE users SET is_premium = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: SetUserPremiumFalse :exec
UPDATE users SET is_premium = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: CancelSubscriptionByUser :exec
UPDATE subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?;
