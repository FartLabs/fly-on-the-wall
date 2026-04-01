package web

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/admin"
	"github.com/fly-on-the-wall/server/internal/auth"
	"github.com/fly-on-the-wall/server/internal/billing"
	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/middleware"
	"github.com/fly-on-the-wall/server/internal/sync"
)

type Handler struct {
	auth         *auth.Service
	admin        *admin.Service
	sync         *sync.Service
	billing      *billing.Service
	templatesDir string
}

// NewHandler creates a new web handler with authentication, sync, and billing services.
func NewHandler(auth *auth.Service, admin *admin.Service, sync *sync.Service, billing *billing.Service) *Handler {
	return &Handler{
		auth:         auth,
		admin:        admin,
		sync:         sync,
		billing:      billing,
		templatesDir: "templates",
	}
}

// Register sets up the HTTP routes for the web handler.
func (h *Handler) Register(mux *http.ServeMux) {
	authMw := middleware.RequireAuth(h.auth)
	adminMw := authMw
	adminMw = middleware.Chain(authMw, middleware.RequireAdmin)

	// public pages
	mux.HandleFunc("GET /", h.handleHome)
	mux.HandleFunc("GET /login", h.handleLoginPage)
	mux.HandleFunc("POST /login", h.handleLoginSubmit)
	mux.HandleFunc("GET /register", h.handleRegisterPage)
	mux.HandleFunc("POST /register", h.handleRegisterSubmit)
	mux.HandleFunc("POST /logout", h.handleLogoutSubmit)

	// protected pages
	mux.Handle("GET /dashboard", authMw(http.HandlerFunc(h.handleDashboard)))
	mux.Handle("GET /settings", authMw(http.HandlerFunc(h.handleSettings)))
	mux.Handle("GET /billing", authMw(http.HandlerFunc(h.handleBillingPage)))

	// admin pages
	mux.Handle("GET /admin", adminMw(http.HandlerFunc(h.handleAdminDashboard)))
	mux.Handle("GET /admin/users", adminMw(http.HandlerFunc(h.handleAdminUsers)))
	mux.Handle("POST /admin/users/premium", adminMw(http.HandlerFunc(h.handleAdminSetPremium)))
	mux.Handle("POST /admin/users/admin", adminMw(http.HandlerFunc(h.handleAdminSetAdmin)))

	// notes
	mux.Handle("GET /notes", authMw(http.HandlerFunc(h.handleNotesList)))
	mux.Handle("GET /notes/new", authMw(http.HandlerFunc(h.handleNotesNew)))
	mux.Handle("POST /notes", authMw(http.HandlerFunc(h.handleNotesCreate)))
	mux.Handle("GET /notes/{id}", authMw(http.HandlerFunc(h.handleNotesView)))
	mux.Handle("POST /notes/{id}", authMw(http.HandlerFunc(h.handleNotesUpdate)))
	mux.Handle("POST /notes/{id}/delete", authMw(http.HandlerFunc(h.handleNotesDelete)))
	mux.Handle("POST /notes/{id}/autosave", authMw(http.HandlerFunc(h.handleNotesAutoSave)))

	// devices
	mux.Handle("GET /devices", authMw(http.HandlerFunc(h.handleDevices)))
	mux.Handle("POST /devices/{id}/revoke", authMw(http.HandlerFunc(h.handleDevicesRevoke)))
	mux.Handle("POST /settings/devices/{id}/revoke", authMw(http.HandlerFunc(h.handleDeviceRevoke)))
}

type pageData struct {
	Title       string
	Description string
	OGImage     string
	URL         string
	User        interface{}
	Data        interface{}
	Error       string
	Success     string
}

func (h *Handler) handleHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	token := extractToken(r)
	if token != "" {
		if _, _, err := h.auth.ValidateSession(r.Context(), token); err == nil {
			http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
			return
		}
	}

	h.render(w, "home", pageData{
		Title:       "Fly on the Wall",
		Description: "An open-source, local-first AI tool for recording, transcribing, and summarizing meetings with privacy at its core.",
		OGImage:     "/static/img/og-image.png",
	})
}

func (h *Handler) handleLoginPage(w http.ResponseWriter, r *http.Request) {
	h.render(w, "login", pageData{
		Title:       "Login",
		Description: "Log in to your Fly on the Wall account to sync your notes and recordings.",
	})
}

func (h *Handler) handleLoginSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		h.render(w, "login", pageData{Title: "Login", Error: "Invalid form data"})
		return
	}

	username := r.FormValue("username")
	password := r.FormValue("password")

	ua := r.UserAgent()
	deviceOS, deviceName := parseUserAgent(ua)

	user, session, err := h.auth.Login(r.Context(), username, password, "", deviceOS, "", deviceName)
	if err != nil {
		h.render(w, "login", pageData{Title: "Login", Error: "Invalid username or password"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    session.Token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		Secure:   h.auth.Config().CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   h.auth.Config().CookieDomain,
	})
	_ = user
	http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
}

func (h *Handler) handleRegisterPage(w http.ResponseWriter, r *http.Request) {
	h.render(w, "register", pageData{
		Title:       "Create Account",
		Description: "Join Fly on the Wall to securely record and summarize your meetings with AI.",
	})
}

func (h *Handler) handleRegisterSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		h.render(w, "register", pageData{Title: "Create Account", Error: "Invalid form data"})
		return
	}

	username := r.FormValue("username")
	password := r.FormValue("password")
	confirm := r.FormValue("confirm_password")

	if password != confirm {
		h.render(w, "register", pageData{Title: "Create Account", Error: "Passwords do not match"})
		return
	}

	if len(password) < 8 {
		h.render(w, "register", pageData{Title: "Create Account", Error: "Password must be at least 8 characters"})
		return
	}

	user, err := h.auth.Register(r.Context(), username, password)
	if err != nil {
		h.render(w, "register", pageData{Title: "Create Account", Error: "Username already taken"})
		return
	}

	ua := r.UserAgent()
	deviceOS, deviceName := parseUserAgent(ua)

	session, err := h.auth.CreateSession(r.Context(), user.ID, "", deviceOS, "", deviceName)
	if err != nil {
		h.render(w, "login", pageData{Title: "Login", Error: "Account created. Please log in."})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    session.Token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		Secure:   h.auth.Config().CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   h.auth.Config().CookieDomain,
	})
	http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
}

func (h *Handler) handleLogoutSubmit(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("session_token"); err == nil {
		h.auth.Logout(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func (h *Handler) handleDashboard(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	premium, _ := h.billing.IsPremium(r.Context(), user.ID)

	h.render(w, "dashboard", pageData{
		Title: "Dashboard",
		User:  user,
		Data: map[string]interface{}{
			"is_premium": premium,
		},
	})
}

func (h *Handler) handleSettings(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	sessions, err := h.auth.ListUserSessions(r.Context(), user.ID)
	if err != nil {
		slog.Error("list sessions failed", "error", err)
		h.render(w, "settings", pageData{
			Title: "Settings",
			User:  user,
			Error: "Failed to load devices",
		})
		return
	}

	type Device struct {
		DeviceID      string
		DeviceOS      string
		DeviceVersion string
		DeviceName    string
		DisplayName   string
		RevokeKey     string
		LastActive    string
		SessionCount  int
	}

	devices := make(map[string]*Device)
	for _, s := range sessions {
		key := s.DeviceID
		if key == "" {
			key = "web-" + s.DeviceName
		}

		if d, exists := devices[key]; exists {
			d.SessionCount++
		} else {
			displayName := formatDeviceName(s.DeviceName, s.DeviceOS, s.DeviceVersion)
			if displayName == "" {
				if s.DeviceID == "" {
					displayName = s.DeviceName
					if displayName == "" {
						displayName = "Web Session"
					}
				} else {
					displayName = s.DeviceID
				}
			}
			revokeKey := s.DeviceID
			if revokeKey == "" {
				revokeKey = "web"
			}
			devices[key] = &Device{
				DeviceID:      s.DeviceID,
				DeviceOS:      s.DeviceOS,
				DeviceVersion: s.DeviceVersion,
				DeviceName:    s.DeviceName,
				DisplayName:   displayName,
				RevokeKey:     revokeKey,
				LastActive:    s.CreatedAt.Format("Jan 2, 2006 3:04pm"),
				SessionCount:  1,
			}
		}
	}

	deviceList := make([]*Device, 0, len(devices))
	for _, d := range devices {
		deviceList = append(deviceList, d)
	}

	h.render(w, "settings", pageData{
		Title: "Settings",
		User:  user,
		Data: map[string]interface{}{
			"devices": deviceList,
		},
	})
}

func formatDeviceName(name, os, version string) string {
	if name == "" && os == "" {
		return ""
	}

	if name != "" && os != "" && version != "" {
		return fmt.Sprintf("%s (%s %s)", name, os, version)
	}
	if name != "" && os != "" {
		return fmt.Sprintf("%s (%s)", name, os)
	}
	if name != "" {
		return name
	}
	if os != "" && version != "" {
		return fmt.Sprintf("%s %s", os, version)
	}
	if os != "" {
		return os
	}
	return ""
}

func (h *Handler) handleBillingPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	premium, _ := h.billing.IsPremium(r.Context(), user.ID)

	sub, _ := h.billing.GetSubscription(r.Context(), user.ID)

	h.render(w, "billing", pageData{
		Title: "Billing",
		User:  user,
		Data: map[string]interface{}{
			"is_premium":     premium,
			"subscription":   sub,
			"stripe_enabled": h.billing.StripeEnabled(),
			"premium_mode":   h.billing.PremiumMode(),
		},
	})
}

type NoteListItem struct {
	ID        string
	Filename  string
	Preview   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (h *Handler) handleNotesList(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	delta, err := h.sync.GetDelta(r.Context(), user.ID, time.Time{}, 100)
	if err != nil {
		slog.Error("get notes delta failed", "error", err)
		h.render(w, "notes/list", pageData{
			Title: "Notes",
			User:  user,
			Error: "Failed to load notes",
		})
		return
	}

	notes := make([]NoteListItem, 0, len(delta.Notes))
	for _, n := range delta.Notes {
		if n.DeletedAt == nil {
			filename := ""
			preview := ""

			if n.ObjectKey != "" {
				note, err := h.sync.GetNote(r.Context(), n.ID, user.ID)
				if err == nil && len(note.Content) > 0 {
					var noteData map[string]interface{}
					if err := json.Unmarshal(note.Content, &noteData); err == nil {
						if fn, ok := noteData["filename"].(string); ok && fn != "" {
							filename = fn
						}
						if noteIDStr, ok := noteData["id"].(string); ok && filename == "" && noteIDStr != "" {
							if idx := strings.Index(noteIDStr, "_recording_"); idx != -1 {
								filename = noteIDStr[:idx]
							} else {
								filename = noteIDStr
							}
						}
						if trans, ok := noteData["transcription"].(string); ok && trans != "" {
							preview = trans
							if len(preview) > 150 {
								preview = preview[:150] + "..."
							}
						}
					}
				}
			}

			if filename == "" && preview == "" {
				filename = "Untitled Note"
			} else if filename == "" && preview != "" {
				lines := strings.Split(preview, "\n")
				filename = strings.TrimSpace(lines[0])
				if len(filename) > 50 {
					filename = filename[:50] + "..."
				}
			}

			notes = append(notes, NoteListItem{
				ID:        n.ID,
				Filename:  filename,
				Preview:   preview,
				CreatedAt: n.CreatedAt,
				UpdatedAt: n.UpdatedAt,
			})
		}
	}

	sort.Slice(notes, func(i, j int) bool {
		return notes[i].UpdatedAt.After(notes[j].UpdatedAt)
	})

	h.render(w, "notes/list", pageData{
		Title: "Notes",
		User:  user,
		Data: map[string]interface{}{
			"notes": notes,
		},
	})
}

func (h *Handler) handleNotesNew(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	h.render(w, "notes/form", pageData{
		Title: "New Note",
		User:  user,
		Data:  map[string]interface{}{"note": nil},
	})
}

func (h *Handler) handleNotesCreate(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	if err := r.ParseForm(); err != nil {
		h.render(w, "notes/form", pageData{
			Title: "New Note",
			User:  user,
			Error: "Invalid form data",
		})
		return
	}

	filename := r.FormValue("filename")
	noteID := r.FormValue("note_id")
	transcription := r.FormValue("transcription")
	summary := r.FormValue("summary")

	if noteID == "" && transcription == "" && filename == "" {
		h.render(w, "notes/form", pageData{
			Title: "New Note",
			User:  user,
			Error: "At least one field is required",
		})
		return
	}

	noteData := map[string]interface{}{}
	if filename != "" {
		noteData["filename"] = filename
	}
	if noteID != "" {
		noteData["id"] = noteID
	}
	if transcription != "" {
		noteData["transcription"] = transcription
	}
	if summary != "" {
		noteData["summary"] = summary
	}

	content, err := json.Marshal(noteData)
	if err != nil {
		slog.Error("marshal note failed", "error", err)
		h.render(w, "notes/form", pageData{
			Title: "New Note",
			User:  user,
			Error: "Failed to create note",
		})
		return
	}

	note := &database.Note{
		UserID:  user.ID,
		Content: content,
	}

	result, err := h.sync.UpsertNote(r.Context(), note)
	if err != nil {
		slog.Error("create note failed", "error", err)
		h.render(w, "notes/form", pageData{
			Title: "New Note",
			User:  user,
			Error: "Failed to create note",
		})
		return
	}

	http.Redirect(w, r, "/notes/"+result.ID, http.StatusSeeOther)
}

func (h *Handler) handleNotesView(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	noteID := r.PathValue("id")

	note, err := h.sync.GetNote(r.Context(), noteID, user.ID)
	if err != nil {
		if err == sync.ErrNotFound {
			http.NotFound(w, r)
			return
		}
		slog.Error("get note failed", "error", err)
		h.render(w, "notes/view", pageData{
			Title: "Note",
			User:  user,
			Error: "Failed to load note",
		})
		return
	}

	var noteData map[string]interface{}
	if len(note.Content) > 0 {
		if err := json.Unmarshal(note.Content, &noteData); err != nil {
			slog.Warn("parse note content failed", "error", err)
			noteData = map[string]interface{}{"raw": string(note.Content)}
		}
	} else {
		noteData = map[string]interface{}{}
	}

	transcription, _ := noteData["transcription"].(string)
	summary, _ := noteData["summary"].(string)
	noteIDFromJSON, _ := noteData["id"].(string)
	filename, _ := noteData["filename"].(string)
	metadata, _ := noteData["metadata"].(map[string]interface{})

	if noteIDFromJSON != "" {
		noteID = noteIDFromJSON
	}

	if filename == "" && noteID != "" {
		if idx := strings.Index(noteID, "_recording_"); idx != -1 {
			filename = noteID[:idx]
		} else {
			filename = noteID
		}
	}

	h.render(w, "notes/view", pageData{
		Title: "Note",
		User:  user,
		Data: map[string]interface{}{
			"note": map[string]interface{}{
				"id":            note.ID,
				"version":       note.Version,
				"created_at":    note.CreatedAt,
				"updated_at":    note.UpdatedAt,
				"note_id":       noteID,
				"filename":      filename,
				"transcription": transcription,
				"summary":       summary,
				"metadata":      metadata,
			},
		},
	})
}

func (h *Handler) handleNotesUpdate(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	noteID := r.PathValue("id")

	if err := r.ParseForm(); err != nil {
		h.render(w, "notes/view", pageData{
			Title: "Note",
			User:  user,
			Error: "Invalid form data",
		})
		return
	}

	filename := r.FormValue("filename")
	transcription := r.FormValue("transcription")
	summary := r.FormValue("summary")
	noteIDFromForm := r.FormValue("note_id")

	existing, err := h.sync.GetNote(r.Context(), noteID, user.ID)
	if err != nil {
		if err == sync.ErrNotFound {
			http.NotFound(w, r)
			return
		}
		h.render(w, "notes/view", pageData{
			Title: "Note",
			User:  user,
			Error: "Failed to load note",
		})
		return
	}

	var existingData map[string]interface{}
	if len(existing.Content) > 0 {
		if err := json.Unmarshal(existing.Content, &existingData); err != nil {
			existingData = map[string]interface{}{}
		}
	} else {
		existingData = map[string]interface{}{}
	}

	if filename != "" {
		existingData["filename"] = filename
	}
	if transcription != "" || existingData["transcription"] != nil {
		existingData["transcription"] = transcription
	}
	if summary != "" || existingData["summary"] != nil {
		existingData["summary"] = summary
	}
	if noteIDFromForm != "" {
		existingData["id"] = noteIDFromForm
	}

	content, err := json.Marshal(existingData)
	if err != nil {
		slog.Error("marshal note failed", "error", err)
		h.render(w, "notes/view", pageData{
			Title: "Note",
			User:  user,
			Error: "Failed to save note",
		})
		return
	}

	note := &database.Note{
		ID:      noteID,
		UserID:  user.ID,
		Content: content,
		Version: existing.Version,
	}

	_, err = h.sync.UpsertNote(r.Context(), note)
	if err != nil {
		slog.Error("update note failed", "error", err)
		h.render(w, "notes/view", pageData{
			Title: "Note",
			User:  user,
			Error: "Failed to update note",
		})
		return
	}

	http.Redirect(w, r, "/notes/"+noteID, http.StatusSeeOther)
}

func (h *Handler) handleNotesAutoSave(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	noteID := r.PathValue("id")

	var req struct {
		Filename      string `json:"filename"`
		Transcription string `json:"transcription"`
		Summary       string `json:"summary"`
		NoteID        string `json:"note_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	existing, err := h.sync.GetNote(r.Context(), noteID, user.ID)
	if err != nil {
		if err == sync.ErrNotFound {
			jsonError(w, "Note not found", http.StatusNotFound)
			return
		}
		slog.Error("get note for autosave failed", "error", err)
		jsonError(w, "Failed to save note", http.StatusInternalServerError)
		return
	}

	var existingData map[string]interface{}
	if len(existing.Content) > 0 {
		if err := json.Unmarshal(existing.Content, &existingData); err != nil {
			existingData = map[string]interface{}{}
		}
	} else {
		existingData = map[string]interface{}{}
	}

	if req.Filename != "" {
		existingData["filename"] = req.Filename
	}
	if req.Transcription != "" || existingData["transcription"] != nil {
		existingData["transcription"] = req.Transcription
	}
	if req.Summary != "" || existingData["summary"] != nil {
		existingData["summary"] = req.Summary
	}
	if req.NoteID != "" {
		existingData["id"] = req.NoteID
	}

	content, err := json.Marshal(existingData)
	if err != nil {
		slog.Error("marshal note for autosave failed", "error", err)
		jsonError(w, "Failed to save note", http.StatusInternalServerError)
		return
	}

	note := &database.Note{
		ID:      noteID,
		UserID:  user.ID,
		Content: content,
		Version: existing.Version,
	}

	result, err := h.sync.UpsertNote(r.Context(), note)
	if err != nil {
		if err == sync.ErrVersionConflict {
			jsonError(w, "Version conflict", http.StatusConflict)
			return
		}
		slog.Error("autosave note failed", "error", err)
		jsonError(w, "Failed to save note", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success":    true,
		"version":    result.Version,
		"updated_at": result.UpdatedAt,
	})
}

func (h *Handler) handleNotesDelete(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	noteID := r.PathValue("id")

	err := h.sync.DeleteNote(r.Context(), noteID, user.ID)
	if err != nil {
		slog.Error("delete note failed", "error", err)
	}

	http.Redirect(w, r, "/notes", http.StatusSeeOther)
}

func (h *Handler) handleDevices(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	sessions, err := h.auth.ListUserSessions(r.Context(), user.ID)
	if err != nil {
		slog.Error("list sessions failed", "error", err)
		h.render(w, "devices", pageData{
			Title: "Devices",
			User:  user,
			Error: "Failed to load devices",
		})
		return
	}

	type Device struct {
		DeviceID      string
		DeviceOS      string
		DeviceVersion string
		DeviceName    string
		DisplayName   string
		RevokeKey     string
		LastActive    string
		SessionCount  int
	}

	devices := make(map[string]*Device)
	for _, s := range sessions {
		key := s.DeviceID
		if key == "" {
			key = "web-" + s.DeviceName
		}

		if d, exists := devices[key]; exists {
			d.SessionCount++
		} else {
			displayName := formatDeviceName(s.DeviceName, s.DeviceOS, s.DeviceVersion)
			if displayName == "" {
				if s.DeviceID == "" {
					displayName = s.DeviceName
					if displayName == "" {
						displayName = "Web Session"
					}
				} else {
					displayName = s.DeviceID
				}
			}
			revokeKey := s.DeviceID
			if revokeKey == "" {
				revokeKey = "web"
			}
			devices[key] = &Device{
				DeviceID:      s.DeviceID,
				DeviceOS:      s.DeviceOS,
				DeviceVersion: s.DeviceVersion,
				DeviceName:    s.DeviceName,
				DisplayName:   displayName,
				RevokeKey:     revokeKey,
				LastActive:    s.CreatedAt.Format("Jan 2, 2006 3:04pm"),
				SessionCount:  1,
			}
		}
	}

	deviceList := make([]*Device, 0, len(devices))
	for _, d := range devices {
		deviceList = append(deviceList, d)
	}

	h.render(w, "devices", pageData{
		Title: "Devices",
		User:  user,
		Data: map[string]interface{}{
			"devices": deviceList,
		},
	})
}

func (h *Handler) handleDevicesRevoke(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	currentSession := middleware.SessionFromContext(r.Context())
	deviceID := r.PathValue("id")

	isCurrentSessionRevoked := false

	if deviceID == "" || deviceID == "web" {
		sessions, err := h.auth.ListUserSessions(r.Context(), user.ID)
		if err == nil {
			for _, s := range sessions {
				if s.DeviceID == "" {
					h.auth.RevokeSession(r.Context(), s.ID, user.ID)
					if currentSession != nil && s.ID == currentSession.ID {
						isCurrentSessionRevoked = true
					}
				}
			}
		}
	} else {
		sessions, err := h.auth.ListUserSessions(r.Context(), user.ID)
		if err == nil {
			for _, s := range sessions {
				if s.DeviceID == deviceID {
					h.auth.RevokeSession(r.Context(), s.ID, user.ID)
					if currentSession != nil && s.ID == currentSession.ID {
						isCurrentSessionRevoked = true
					}
				}
			}
		}
	}

	if isCurrentSessionRevoked {
		http.SetCookie(w, &http.Cookie{
			Name:     "session_token",
			Value:    "",
			Path:     "/",
			Expires:  time.Now().Add(-time.Hour),
			HttpOnly: true,
		})
		http.Redirect(w, r, "/", http.StatusSeeOther)
	} else {
		http.Redirect(w, r, "/devices", http.StatusSeeOther)
	}
}

func (h *Handler) handleDeviceRevoke(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	currentSession := middleware.SessionFromContext(r.Context())
	deviceID := r.PathValue("id")

	isCurrentSessionRevoked := false

	if deviceID == "web" {
		sessions, err := h.auth.ListUserSessions(r.Context(), user.ID)
		if err == nil {
			for _, s := range sessions {
				if s.DeviceID == "" {
					h.auth.RevokeSession(r.Context(), s.ID, user.ID)
					if currentSession != nil && s.ID == currentSession.ID {
						isCurrentSessionRevoked = true
					}
				}
			}
		}
	} else {
		sessions, err := h.auth.ListUserSessions(r.Context(), user.ID)
		if err == nil {
			for _, s := range sessions {
				if s.DeviceID == deviceID {
					h.auth.RevokeSession(r.Context(), s.ID, user.ID)
					if currentSession != nil && s.ID == currentSession.ID {
						isCurrentSessionRevoked = true
					}
				}
			}
		}
	}

	if isCurrentSessionRevoked {
		http.SetCookie(w, &http.Cookie{
			Name:     "session_token",
			Value:    "",
			Path:     "/",
			Expires:  time.Now().Add(-time.Hour),
			HttpOnly: true,
		})
		http.Redirect(w, r, "/", http.StatusSeeOther)
	} else {
		http.Redirect(w, r, "/settings", http.StatusSeeOther)
	}
}

func (h *Handler) handleAdminDashboard(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	result, err := h.admin.GetUsers(r.Context(), 1, 10)
	if err != nil {
		slog.Error("get users failed", "error", err)
		h.render(w, "admin/dashboard", pageData{
			Title: "Admin Dashboard",
			User:  user,
			Error: "Failed to load users",
		})
		return
	}

	h.render(w, "admin/dashboard", pageData{
		Title: "Admin Dashboard",
		User:  user,
		Data: map[string]interface{}{
			"total_users": result.TotalCount,
		},
	})
}

func (h *Handler) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	page := 1
	pageStr := r.URL.Query().Get("page")
	if pageStr != "" {
		fmt.Sscanf(pageStr, "%d", &page)
	}

	result, err := h.admin.GetUsers(r.Context(), page, 20)
	if err != nil {
		slog.Error("get users failed", "error", err)
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  user,
			Error: "Failed to load users",
		})
		return
	}

	h.render(w, "admin/users", pageData{
		Title: "User Management",
		User:  user,
		Data: map[string]interface{}{
			"users":       result.Users,
			"total_count": result.TotalCount,
			"page":        result.Page,
			"page_size":   result.PageSize,
			"total_pages": result.TotalPages,
		},
	})
}

func (h *Handler) handleAdminSetPremium(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())

	if err := r.ParseForm(); err != nil {
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  user,
			Error: "Invalid form data",
		})
		return
	}

	userID := r.FormValue("user_id")
	isPremium := r.FormValue("is_premium") == "true"

	if userID == "" {
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  user,
			Error: "User ID required",
		})
		return
	}

	err := h.admin.SetUserPremium(r.Context(), userID, isPremium)
	if err != nil {
		slog.Error("set user premium failed", "error", err, "user_id", userID)
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  user,
			Error: "Failed to update user premium status",
		})
		return
	}

	http.Redirect(w, r, "/admin/users", http.StatusSeeOther)
}

func (h *Handler) handleAdminSetAdmin(w http.ResponseWriter, r *http.Request) {
	currentUser := middleware.UserFromContext(r.Context())

	if err := r.ParseForm(); err != nil {
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  currentUser,
			Error: "Invalid form data",
		})
		return
	}

	userID := r.FormValue("user_id")
	isAdmin := r.FormValue("is_admin") == "true"

	if userID == "" {
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  currentUser,
			Error: "User ID required",
		})
		return
	}

	if userID == currentUser.ID {
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  currentUser,
			Error: "Cannot modify your own admin status",
		})
		return
	}

	err := h.admin.SetUserAdmin(r.Context(), userID, isAdmin)
	if err != nil {
		slog.Error("set user admin failed", "error", err, "user_id", userID)
		h.render(w, "admin/users", pageData{
			Title: "User Management",
			User:  currentUser,
			Error: "Failed to update user admin status",
		})
		return
	}

	http.Redirect(w, r, "/admin/users", http.StatusSeeOther)
}

// render executes the specified template with the given data and writes it to the response.
func (h *Handler) render(w http.ResponseWriter, name string, data pageData) {
	if data.URL == "" {
		data.URL = "https://fly-on-the-wall.com" // TODO: get from config
	}
	tpl, err := h.pageTemplate(name)
	if err != nil {
		slog.Error("template parse error", "template", name, "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if err := tpl.ExecuteTemplate(w, name, data); err != nil {
		slog.Error("template render error", "template", name, "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

// pageTemplate loads and parses the specified template along with the base layout and partials.
func (h *Handler) pageTemplate(name string) (*template.Template, error) {
	pagePath := filepath.Join(h.templatesDir, templatePathFor(name))
	basePath := filepath.Join(h.templatesDir, "layouts", "base.html")
	partialPath := filepath.Join(h.templatesDir, "partials", "nav.html")

	if _, err := os.Stat(pagePath); err != nil {
		return nil, err
	}

	// add common template functions
	funcMap := template.FuncMap{
		"CurrentYear": func() int {
			return time.Now().Year()
		},
		"add": func(a, b int) int {
			return a + b
		},
		"sub": func(a, b int) int {
			return a - b
		},
	}

	return template.New(name).Funcs(funcMap).ParseFiles(basePath, partialPath, pagePath)
}

// templatePathFor returns the relative path to the template file for a given page name.
func templatePathFor(name string) string {
	switch name {
	case "home", "login", "register":
		return filepath.Join("auth", name+".html")
	case "dashboard", "settings":
		return filepath.Join("dashboard", name+".html")
	case "billing":
		return filepath.Join("billing", "billing.html")
	case "notes/list", "notes/form", "notes/view":
		return filepath.Join("notes", name[strings.LastIndex(name, "/")+1:]+".html")
	case "devices":
		return "devices.html"
	case "admin/dashboard":
		return filepath.Join("admin", "dashboard.html")
	case "admin/users":
		return filepath.Join("admin", "users.html")
	default:
		return filepath.Join("auth", "home.html")
	}
}

func extractToken(r *http.Request) string {
	if cookie, err := r.Cookie("session_token"); err == nil {
		return cookie.Value
	}
	return ""
}

func parseUserAgent(ua string) (deviceOS, deviceName string) {
	if ua == "" {
		return "Web", "Web Session"
	}

	switch {
	case strings.Contains(ua, "Firefox/"):
		if strings.Contains(ua, "Windows") {
			return "Windows", "Firefox on Windows"
		} else if strings.Contains(ua, "Mac OS X") {
			return "macOS", "Firefox on macOS"
		} else if strings.Contains(ua, "Linux") {
			return "Linux", "Firefox on Linux"
		}
		return "Web", "Firefox Browser"
	case strings.Contains(ua, "Edg/"):
		if strings.Contains(ua, "Windows") {
			return "Windows", "Edge on Windows"
		} else if strings.Contains(ua, "Mac OS X") {
			return "macOS", "Edge on macOS"
		} else if strings.Contains(ua, "Linux") {
			return "Linux", "Edge on Linux"
		}
		return "Web", "Edge Browser"
	case strings.Contains(ua, "Chrome/"):
		if strings.Contains(ua, "Windows") {
			return "Windows", "Chrome on Windows"
		} else if strings.Contains(ua, "Mac OS X") {
			return "macOS", "Chrome on macOS"
		} else if strings.Contains(ua, "Linux") {
			return "Linux", "Chrome on Linux"
		}
		return "Web", "Chrome Browser"
	case strings.Contains(ua, "Safari/") && !strings.Contains(ua, "Chrome"):
		if strings.Contains(ua, "Mac OS X") {
			return "macOS", "Safari on macOS"
		}
		return "Web", "Safari Browser"
	default:
		return "Web", "Web Browser"
	}
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("encode json response failed", "error", err)
	}
}

func jsonError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
