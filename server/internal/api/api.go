package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/fly-on-the-wall/server/internal/auth"
	"github.com/fly-on-the-wall/server/internal/billing"
	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/jobs"
	"github.com/fly-on-the-wall/server/internal/middleware"
	"github.com/fly-on-the-wall/server/internal/sync"
)

// Handler manages JSON API routes for the desktop client.
type Handler struct {
	auth    *auth.Service
	sync    *sync.Service
	billing *billing.Service
	jobs    *jobs.Service
}

func NewHandler(auth *auth.Service, sync *sync.Service, billing *billing.Service, jobs *jobs.Service) *Handler {
	return &Handler{auth: auth, sync: sync, billing: billing, jobs: jobs}
}

func (h *Handler) Register(mux *http.ServeMux) {
	authMw := middleware.RequireAuth(h.auth)

	mux.HandleFunc("POST /api/v1/auth/register", h.handleRegister)
	mux.HandleFunc("POST /api/v1/auth/login", h.handleLogin)

	mux.Handle("POST /api/v1/auth/logout", authMw(http.HandlerFunc(h.handleLogout)))
	mux.Handle("GET /api/v1/auth/me", authMw(http.HandlerFunc(h.handleMe)))

	mux.Handle("GET /api/v1/sync/delta", authMw(http.HandlerFunc(h.handleSyncDelta)))
	mux.Handle("PUT /api/v1/sync/cursor", authMw(http.HandlerFunc(h.handleUpdateCursor)))

	mux.Handle("POST /api/v1/notes", authMw(http.HandlerFunc(h.handleUpsertNote)))
	mux.Handle("GET /api/v1/notes/{id}", authMw(http.HandlerFunc(h.handleGetNote)))
	mux.Handle("DELETE /api/v1/notes/{id}", authMw(http.HandlerFunc(h.handleDeleteNote)))

	mux.Handle("POST /api/v1/recordings", authMw(http.HandlerFunc(h.handleCreateRecording)))
	mux.Handle("POST /api/v1/recordings/upload-url", authMw(http.HandlerFunc(h.handleGetUploadURL)))
	mux.Handle("POST /api/v1/recordings/download-url", authMw(http.HandlerFunc(h.handleGetDownloadURL)))
	mux.Handle("DELETE /api/v1/recordings/{id}", authMw(http.HandlerFunc(h.handleDeleteRecording)))

	mux.Handle("POST /api/v1/jobs", authMw(http.HandlerFunc(h.handleCreateJob)))
	mux.Handle("GET /api/v1/jobs/{id}", authMw(http.HandlerFunc(h.handleGetJob)))
	mux.Handle("GET /api/v1/jobs", authMw(http.HandlerFunc(h.handleListJobs)))

	mux.Handle("GET /api/v1/billing/status", authMw(http.HandlerFunc(h.handleBillingStatus)))
	mux.Handle("POST /api/v1/billing/checkout", authMw(http.HandlerFunc(h.handleCreateCheckout)))

	mux.HandleFunc("POST /api/v1/billing/webhook", h.handleStripeWebhook)
}

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username      string `json:"username"`
		Password      string `json:"password"`
		DeviceID      string `json:"device_id"`
		DeviceOS      string `json:"device_os"`
		DeviceVersion string `json:"device_version"`
		DeviceName    string `json:"device_name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Username == "" || req.Password == "" {
		jsonError(w, "Username and password are required", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		jsonError(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	user, err := h.auth.Register(r.Context(), req.Username, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrUsernameTaken) {
			jsonError(w, "Username already taken", http.StatusConflict)
			return
		}
		slog.Error("register failed", "error", err)
		jsonError(w, "Registration failed", http.StatusInternalServerError)
		return
	}

	session, err := h.auth.CreateSession(r.Context(), user.ID, req.DeviceID, req.DeviceOS, req.DeviceVersion, req.DeviceName)
	if err != nil {
		slog.Error("create session failed", "error", err)
		jsonError(w, "Registration succeeded but login failed", http.StatusInternalServerError)
		return
	}

	setSessionCookie(w, session, h.auth.Config())
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"user":  sanitizeUser(user),
		"token": session.Token,
	})
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username      string `json:"username"`
		Password      string `json:"password"`
		DeviceID      string `json:"device_id"`
		DeviceOS      string `json:"device_os"`
		DeviceVersion string `json:"device_version"`
		DeviceName    string `json:"device_name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	user, session, err := h.auth.Login(r.Context(), req.Username, req.Password, req.DeviceID, req.DeviceOS, req.DeviceVersion, req.DeviceName)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			jsonError(w, "Invalid username or password", http.StatusUnauthorized)
			return
		}
		slog.Error("login failed", "error", err)
		jsonError(w, "Login failed", http.StatusInternalServerError)
		return
	}

	setSessionCookie(w, session, h.auth.Config())
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"user":  sanitizeUser(user),
		"token": session.Token,
	})
}

func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	session := middleware.SessionFromContext(r.Context())
	if session != nil {
		h.auth.Logout(r.Context(), session.Token)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	jsonResponse(w, http.StatusOK, map[string]string{"status": "logged out"})
}

func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	premium, _ := h.billing.IsPremium(r.Context(), user.ID)
	resp := sanitizeUser(user)
	resp["is_premium"] = premium
	jsonResponse(w, http.StatusOK, resp)
}

func (h *Handler) handleSyncDelta(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	sinceStr := r.URL.Query().Get("since")
	var since time.Time
	if sinceStr != "" {
		var err error
		since, err = time.Parse(time.RFC3339Nano, sinceStr)
		if err != nil {
			jsonError(w, "Invalid 'since' timestamp", http.StatusBadRequest)
			return
		}
	}

	delta, err := h.sync.GetDelta(r.Context(), user.ID, since, 100)
	if err != nil {
		slog.Error("sync delta failed", "error", err)
		jsonError(w, "Failed to get sync delta", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, delta)
}

func (h *Handler) handleUpdateCursor(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req struct {
		DeviceID string    `json:"device_id"`
		Entity   string    `json:"entity"`
		Cursor   time.Time `json:"cursor"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.sync.UpdateSyncCursor(r.Context(), user.ID, req.DeviceID, req.Entity, req.Cursor); err != nil {
		jsonError(w, "Failed to update cursor", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handler) handleUpsertNote(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req struct {
		ID           string `json:"id"`
		Content      []byte `json:"content,omitempty"`
		Deprecated   []byte `json:"encrypted_content,omitempty"` // Deprecated: use content instead
		RecordingRef string `json:"recording_ref"`
		Version      int    `json:"version"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	content := req.Content
	if len(content) == 0 && len(req.Deprecated) > 0 {
		slog.Warn("encrypted_content is deprecated, use content instead")
		content = req.Deprecated
	}

	note := &database.Note{
		ID:           req.ID,
		UserID:       user.ID,
		Content:      content,
		RecordingRef: req.RecordingRef,
		Version:      req.Version,
	}

	result, err := h.sync.UpsertNote(r.Context(), note)
	if err != nil {
		if errors.Is(err, sync.ErrVersionConflict) {
			jsonError(w, "Version conflict", http.StatusConflict)
			return
		}
		slog.Error("upsert note failed", "error", err)
		jsonError(w, "Failed to save note", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func (h *Handler) handleGetNote(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	noteID := r.PathValue("id")

	note, err := h.sync.GetNote(r.Context(), noteID, user.ID)
	if err != nil {
		if errors.Is(err, sync.ErrNotFound) {
			jsonError(w, "Note not found", http.StatusNotFound)
			return
		}
		jsonError(w, "Failed to get note", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, note)
}

func (h *Handler) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	noteID := r.PathValue("id")

	if err := h.sync.DeleteNote(r.Context(), noteID, user.ID); err != nil {
		if errors.Is(err, sync.ErrNotFound) {
			jsonError(w, "Note not found", http.StatusNotFound)
			return
		}
		jsonError(w, "Failed to delete note", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) handleCreateRecording(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req struct {
		ObjectKey  string `json:"object_key"`
		SizeBytes  int64  `json:"size_bytes"`
		Meta       []byte `json:"meta,omitempty"`
		Deprecated []byte `json:"encrypted_meta,omitempty"` // Deprecated: use meta instead
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	meta := req.Meta
	if len(meta) == 0 && len(req.Deprecated) > 0 {
		slog.Warn("encrypted_meta is deprecated, use meta instead")
		meta = req.Deprecated
	}

	rec := &database.Recording{
		UserID:    user.ID,
		ObjectKey: req.ObjectKey,
		SizeBytes: req.SizeBytes,
		Meta:      meta,
	}

	result, err := h.sync.CreateRecordingMeta(r.Context(), rec)
	if err != nil {
		slog.Error("create recording failed", "error", err)
		jsonError(w, "Failed to create recording", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, result)
}

func (h *Handler) handleGetUploadURL(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ObjectKey string `json:"object_key"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	url, err := h.sync.GetRecordingUploadURL(r.Context(), req.ObjectKey)
	if err != nil {
		jsonError(w, "Failed to generate upload URL", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"upload_url": url})
}

func (h *Handler) handleGetDownloadURL(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req struct {
		ObjectKey string `json:"object_key"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	url, err := h.sync.GetRecordingDownloadURL(r.Context(), req.ObjectKey, user.ID)
	if err != nil {
		if errors.Is(err, sync.ErrNotFound) {
			jsonError(w, "Recording not found", http.StatusNotFound)
			return
		}
		jsonError(w, "Failed to generate download URL", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"download_url": url})
}

func (h *Handler) handleDeleteRecording(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	recID := r.PathValue("id")

	if err := h.sync.DeleteRecording(r.Context(), recID, user.ID); err != nil {
		if errors.Is(err, sync.ErrNotFound) {
			jsonError(w, "Recording not found", http.StatusNotFound)
			return
		}
		jsonError(w, "Failed to delete recording", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	// Check premium access
	premium, err := h.billing.IsPremium(r.Context(), user.ID)
	if err != nil {
		jsonError(w, "Failed to check premium status", http.StatusInternalServerError)
		return
	}
	if !premium {
		jsonError(w, "Premium subscription required for cloud processing", http.StatusForbidden)
		return
	}

	var req struct {
		Type     string `json:"type"`
		InputRef string `json:"input_ref"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Type != "transcription" && req.Type != "summarization" {
		jsonError(w, "Type must be 'transcription' or 'summarization'", http.StatusBadRequest)
		return
	}

	job, err := h.jobs.CreateJob(r.Context(), user.ID, req.Type, req.InputRef)
	if err != nil {
		slog.Error("create job failed", "error", err)
		jsonError(w, "Failed to create job", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, job)
}

func (h *Handler) handleGetJob(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	jobID := r.PathValue("id")

	job, err := h.jobs.GetJob(r.Context(), jobID, user.ID)
	if err != nil {
		if errors.Is(err, jobs.ErrJobNotFound) {
			jsonError(w, "Job not found", http.StatusNotFound)
			return
		}
		jsonError(w, "Failed to get job", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, job)
}

func (h *Handler) handleListJobs(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	jobType := r.URL.Query().Get("type")

	jobList, err := h.jobs.ListJobs(r.Context(), user.ID, jobType)
	if err != nil {
		jsonError(w, "Failed to list jobs", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, jobList)
}

func (h *Handler) handleBillingStatus(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	premium, _ := h.billing.IsPremium(r.Context(), user.ID)
	resp := map[string]interface{}{
		"is_premium":     premium,
		"premium_mode":   h.billing.PremiumMode(),
		"stripe_enabled": h.billing.StripeEnabled(),
	}

	sub, err := h.billing.GetSubscription(r.Context(), user.ID)
	if err == nil {
		resp["subscription"] = sub
	}

	jsonResponse(w, http.StatusOK, resp)
}

func (h *Handler) handleCreateCheckout(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req struct {
		SuccessURL string `json:"success_url"`
		CancelURL  string `json:"cancel_url"`
	}
	if err := decodeJSON(r, &req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	url, err := h.billing.CreateCheckoutSession(r.Context(), user.ID, user.Username, req.SuccessURL, req.CancelURL)
	if err != nil {
		if errors.Is(err, billing.ErrStripeNotEnabled) {
			jsonError(w, "Stripe billing is not enabled", http.StatusBadRequest)
			return
		}
		jsonError(w, "Failed to create checkout session", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"checkout_url": url})
}

func (h *Handler) handleStripeWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 65536))
	if err != nil {
		jsonError(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	signature := r.Header.Get("Stripe-Signature")
	if err := h.billing.HandleWebhook(r.Context(), body, signature); err != nil {
		slog.Error("stripe webhook failed", "error", err)
		jsonError(w, "Webhook processing failed", http.StatusBadRequest)
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Helpers ---

func decodeJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, message string, status int) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func sanitizeUser(user *database.User) map[string]interface{} {
	return map[string]interface{}{
		"id":         user.ID,
		"username":   user.Username,
		"is_premium": user.IsPremium,
		"is_admin":   user.IsAdmin,
		"created_at": user.CreatedAt,
	}
}

func setSessionCookie(w http.ResponseWriter, session *database.Session, cfg auth.ServiceConfig) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    session.Token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		Secure:   cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   cfg.CookieDomain,
	})
}
