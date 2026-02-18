-- name: GetUserPremiumFlag :one
SELECT is_premium FROM users WHERE id::text = $1;

-- name: GetSubscriptionByUser :one
SELECT id::text, user_id::text, stripe_customer_id, stripe_subscription_id,
       status, plan_id, current_period_end, created_at, updated_at
FROM subscriptions
WHERE user_id::text = $1;

-- name: UpsertSubscription :exec
INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, status, plan_id, current_period_end, created_at, updated_at)
VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())
ON CONFLICT (user_id) DO UPDATE SET
  stripe_customer_id = EXCLUDED.stripe_customer_id,
  stripe_subscription_id = EXCLUDED.stripe_subscription_id,
  status = EXCLUDED.status,
  plan_id = EXCLUDED.plan_id,
  current_period_end = EXCLUDED.current_period_end,
  updated_at = CURRENT_TIMESTAMP;

-- name: SetUserPremiumTrue :exec
UPDATE users SET is_premium = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1;

-- name: SetUserPremiumFalse :exec
UPDATE users SET is_premium = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1;

-- name: CancelSubscriptionByUser :exec
UPDATE subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE user_id::text = $1;
