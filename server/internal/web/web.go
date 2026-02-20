package web

import (
	"encoding/json"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fly-on-the-wall/server/internal/auth"
	"github.com/fly-on-the-wall/server/internal/billing"
	"github.com/fly-on-the-wall/server/internal/database"
	"github.com/fly-on-the-wall/server/internal/middleware"
	"github.com/fly-on-the-wall/server/internal/sync"
)

type Handler struct {
	auth         *auth.Service
	sync         *sync.Service
	billing      *billing.Service
	templatesDir string
}

// NewHandler creates a new web handler with authentication, sync, and billing services.
func NewHandler(auth *auth.Service, sync *sync.Service, billing *billing.Service) *Handler {
	return &Handler{
		auth:         auth,
		sync:         sync,
		billing:      billing,
		templatesDir: "templates",
	}
}

// Register sets up the HTTP routes for the web handler.
func (h *Handler) Register(mux *http.ServeMux) {
	authMw := middleware.RequireAuth(h.auth)

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

	// notes
	mux.Handle("GET /notes", authMw(http.HandlerFunc(h.handleNotesList)))
	mux.Handle("GET /notes/new", authMw(http.HandlerFunc(h.handleNotesNew)))
	mux.Handle("POST /notes", authMw(http.HandlerFunc(h.handleNotesCreate)))
	mux.Handle("GET /notes/{id}", authMw(http.HandlerFunc(h.handleNotesView)))
	mux.Handle("POST /notes/{id}", authMw(http.HandlerFunc(h.handleNotesUpdate)))
	mux.Handle("POST /notes/{id}/delete", authMw(http.HandlerFunc(h.handleNotesDelete)))

	// devices
	mux.Handle("GET /devices", authMw(http.HandlerFunc(h.handleDevices)))
	mux.Handle("POST /devices/{id}/revoke", authMw(http.HandlerFunc(h.handleDevicesRevoke)))
}

type pageData struct {
	Title   string
	User    interface{}
	Data    interface{}
	Error   string
	Success string
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

	h.render(w, "home", pageData{Title: "Fly on the Wall"})
}

func (h *Handler) handleLoginPage(w http.ResponseWriter, r *http.Request) {
	h.render(w, "login", pageData{Title: "Login"})
}

func (h *Handler) handleLoginSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		h.render(w, "login", pageData{Title: "Login", Error: "Invalid form data"})
		return
	}

	username := r.FormValue("username")
	password := r.FormValue("password")

	user, session, err := h.auth.Login(r.Context(), username, password, "")
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
	h.render(w, "register", pageData{Title: "Create Account"})
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

	session, err := h.auth.CreateSession(r.Context(), user.ID, "")
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
	h.render(w, "settings", pageData{
		Title: "Settings",
		User:  user,
	})
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
	Version   int
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
			notes = append(notes, NoteListItem{
				ID:        n.ID,
				Version:   n.Version,
				CreatedAt: n.CreatedAt,
				UpdatedAt: n.UpdatedAt,
			})
		}
	}

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

	noteID := r.FormValue("note_id")
	transcription := r.FormValue("transcription")
	summary := r.FormValue("summary")

	if noteID == "" && transcription == "" {
		h.render(w, "notes/form", pageData{
			Title: "New Note",
			User:  user,
			Error: "At least one field is required",
		})
		return
	}

	noteData := map[string]interface{}{
		"transcription": transcription,
		"summary":       summary,
	}
	if noteID != "" {
		noteData["id"] = noteID
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
	metadata, _ := noteData["metadata"].(map[string]interface{})

	if noteIDFromJSON != "" {
		noteID = noteIDFromJSON
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

	transcription := r.FormValue("transcription")
	summary := r.FormValue("summary")
	noteIDFromForm := r.FormValue("note_id")

	if noteIDFromForm == "" && transcription == "" {
		h.render(w, "notes/view", pageData{
			Title: "Note",
			User:  user,
			Error: "At least one field is required",
		})
		return
	}

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

	h.render(w, "devices", pageData{
		Title: "Devices",
		User:  user,
		Data: map[string]interface{}{
			"sessions": sessions,
		},
	})
}

func (h *Handler) handleDevicesRevoke(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	sessionID := r.PathValue("id")

	err := h.auth.RevokeSession(r.Context(), sessionID, user.ID)
	if err != nil {
		slog.Error("revoke session failed", "error", err)
	}

	http.Redirect(w, r, "/devices", http.StatusSeeOther)
}

// render executes the specified template with the given data and writes it to the response.
func (h *Handler) render(w http.ResponseWriter, name string, data pageData) {
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
