package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/database/dbtime"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/pgsqlc"
	"github.com/fly-on-the-wall/server/internal/database/sqlc/sqliteqlc"
	"github.com/google/uuid"
)

var (
	ErrStripeNotEnabled = errors.New("stripe billing is not enabled")
	ErrNoSubscription   = errors.New("no active subscription found")
)

type Config struct {
	StripeEnabled       bool
	StripeSecretKey     string
	StripeWebhookSecret string
	StripePriceID       string

	// PremiumMode: "stripe", "admin_override", "all_premium"
	PremiumMode string
}

type Service struct {
	db            *sql.DB
	cfg           Config
	driver        string
	pgQueries     *pgsqlc.Queries
	sqliteQueries *sqliteqlc.Queries
}

// NewService creates a new billing service with a database connection, configuration, and driver type.
func NewService(db *sql.DB, cfg Config, driver string) *Service {
	driver = strings.ToLower(strings.TrimSpace(driver))
	s := &Service{db: db, cfg: cfg, driver: driver}
	if driver == "postgres" || driver == "postgresql" {
		s.pgQueries = pgsqlc.New(db)
		return s
	}
	s.sqliteQueries = sqliteqlc.New(db)
	return s
}

// IsPremium checks if the user has premium access based on the configured premium mode.
func (s *Service) IsPremium(ctx context.Context, userID string) (bool, error) {
	switch s.cfg.PremiumMode {
	case "all_premium":
		// Self-hosted mode: everyone is premium
		return true, nil

	case "admin_override":
		if s.pgQueries != nil {
			uid, err := uuid.Parse(userID)
			if err != nil {
				return false, fmt.Errorf("parse user id: %w", err)
			}
			premium, err := s.pgQueries.GetUserPremiumFlag(ctx, uid)
			if err != nil {
				return false, fmt.Errorf("check premium: %w", err)
			}
			return premium, nil
		}
		premium, err := s.sqliteQueries.GetUserPremiumFlag(ctx, userID)
		if err != nil {
			return false, fmt.Errorf("check premium: %w", err)
		}
		return premium != 0, nil

	case "stripe":
		sub, err := s.GetSubscription(ctx, userID)
		if err != nil {
			if errors.Is(err, ErrNoSubscription) {
				return false, nil
			}
			return false, err
		}
		return sub.Status == "active" || sub.Status == "admin_granted", nil

	default:
		return false, nil
	}
}

// GetSubscription retrieves the subscription details for a user.
func (s *Service) GetSubscription(ctx context.Context, userID string) (*database.Subscription, error) {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, fmt.Errorf("parse user id: %w", err)
		}
		row, err := s.pgQueries.GetSubscriptionByUser(ctx, uid)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrNoSubscription
			}
			return nil, fmt.Errorf("get subscription: %w", err)
		}
		return &database.Subscription{
			ID:                   row.ID,
			UserID:               row.UserID,
			StripeCustomerID:     row.StripeCustomerID,
			StripeSubscriptionID: row.StripeSubscriptionID,
			Status:               row.Status,
			PlanID:               row.PlanID,
			CurrentPeriodEnd:     dbtime.NullableTimeFromPG(row.CurrentPeriodEnd),
			CreatedAt:            row.CreatedAt,
			UpdatedAt:            row.UpdatedAt,
		}, nil
	}

	row, err := s.sqliteQueries.GetSubscriptionByUser(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNoSubscription
		}
		return nil, fmt.Errorf("get subscription: %w", err)
	}
	periodEnd, err := dbtime.NullableTimeFromSQLite(row.CurrentPeriodEnd)
	if err != nil {
		return nil, err
	}
	createdAt, err := dbtime.ParseSQLiteTime(row.CreatedAt)
	if err != nil {
		return nil, err
	}
	updatedAt, err := dbtime.ParseSQLiteTime(row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &database.Subscription{
		ID:                   row.ID,
		UserID:               row.UserID,
		StripeCustomerID:     row.StripeCustomerID,
		StripeSubscriptionID: row.StripeSubscriptionID,
		Status:               row.Status,
		PlanID:               row.PlanID,
		CurrentPeriodEnd:     periodEnd,
		CreatedAt:            createdAt,
		UpdatedAt:            updatedAt,
	}, nil
}

// CreateOrUpdateSubscription upserts a subscription record.
func (s *Service) CreateOrUpdateSubscription(ctx context.Context, sub *database.Subscription) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(sub.UserID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		periodEnd := sql.NullTime{}
		if sub.CurrentPeriodEnd != nil {
			periodEnd = sql.NullTime{Valid: true, Time: *sub.CurrentPeriodEnd}
		}
		return s.pgQueries.UpsertSubscription(ctx, pgsqlc.UpsertSubscriptionParams{
			Column1:              uid,
			StripeCustomerID:     sub.StripeCustomerID,
			StripeSubscriptionID: sub.StripeSubscriptionID,
			Status:               sub.Status,
			PlanID:               sub.PlanID,
			CurrentPeriodEnd:     periodEnd,
		})
	}
	periodEnd := sql.NullString{}
	if sub.CurrentPeriodEnd != nil {
		periodEnd = sql.NullString{Valid: true, String: dbtime.FormatSQLiteTime(*sub.CurrentPeriodEnd)}
	}
	return s.sqliteQueries.UpsertSubscription(ctx, sqliteqlc.UpsertSubscriptionParams{
		UserID:               sub.UserID,
		StripeCustomerID:     sub.StripeCustomerID,
		StripeSubscriptionID: sub.StripeSubscriptionID,
		Status:               sub.Status,
		PlanID:               sub.PlanID,
		CurrentPeriodEnd:     periodEnd,
	})
}

// GrantPremiumByAdmin grants premium access without Stripe.
func (s *Service) GrantPremiumByAdmin(ctx context.Context, userID string) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		if err := s.pgQueries.SetUserPremiumTrue(ctx, uid); err != nil {
			return err
		}
	} else {
		if err := s.sqliteQueries.SetUserPremiumTrue(ctx, userID); err != nil {
			return err
		}
	}

	return s.CreateOrUpdateSubscription(ctx, &database.Subscription{
		UserID: userID,
		Status: "admin_granted",
		PlanID: "admin",
	})
}

// RevokePremiumByAdmin removes admin-granted premium.
func (s *Service) RevokePremiumByAdmin(ctx context.Context, userID string) error {
	if s.pgQueries != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return fmt.Errorf("parse user id: %w", err)
		}
		if err := s.pgQueries.SetUserPremiumFalse(ctx, uid); err != nil {
			return err
		}
		return s.pgQueries.CancelSubscriptionByUser(ctx, uid)
	}
	if err := s.sqliteQueries.SetUserPremiumFalse(ctx, userID); err != nil {
		return err
	}
	return s.sqliteQueries.CancelSubscriptionByUser(ctx, userID)
}

// StripeEnabled returns whether Stripe integration is active.
func (s *Service) StripeEnabled() bool {
	return s.cfg.StripeEnabled
}

// PremiumMode returns the current premium mode.
func (s *Service) PremiumMode() string {
	return s.cfg.PremiumMode
}

// CreateCheckoutSession creates a Stripe checkout session URL.
// This is a stub that will be wired to the Stripe SDK when STRIPE_ENABLED=true.
func (s *Service) CreateCheckoutSession(ctx context.Context, userID, username, successURL, cancelURL string) (string, error) {
	if !s.cfg.StripeEnabled {
		return "", ErrStripeNotEnabled
	}

	// TODO: Integrate stripe-go SDK
	// stripe.Key = s.cfg.StripeSecretKey
	// params := &stripe.CheckoutSessionParams{
	//     ClientReferenceID: stripe.String(username),
	//     Mode:          stripe.String("subscription"),
	//     LineItems: []*stripe.CheckoutSessionLineItemParams{{
	//         Price:    stripe.String(s.cfg.StripePriceID),
	//         Quantity: stripe.Int64(1),
	//     }},
	//     SuccessURL: stripe.String(successURL),
	//     CancelURL:  stripe.String(cancelURL),
	//     ClientReferenceID: stripe.String(userID),
	// }
	// session, err := checkoutsession.New(params)
	// return session.URL, err

	return "", fmt.Errorf("stripe checkout not yet implemented")
}

// HandleWebhook processes a Stripe webhook event.
// This is a stub that will be wired to the Stripe SDK.
func (s *Service) HandleWebhook(ctx context.Context, payload []byte, signature string) error {
	if !s.cfg.StripeEnabled {
		return ErrStripeNotEnabled
	}

	// TODO: Integrate stripe-go SDK webhook verification and event handling
	// event, err := webhook.ConstructEvent(payload, signature, s.cfg.StripeWebhookSecret)
	// switch event.Type {
	// case "checkout.session.completed": ...
	// case "customer.subscription.updated": ...
	// case "customer.subscription.deleted": ...
	// }

	return fmt.Errorf("stripe webhook handling not yet implemented")
}

// Ensure time is used.
var _ = time.Now
