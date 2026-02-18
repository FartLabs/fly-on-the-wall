package web

import (
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/fly-on-the-wall/server/internal/auth"
	"github.com/fly-on-the-wall/server/internal/billing"
	"github.com/fly-on-the-wall/server/internal/middleware"
)

type Handler struct {
	auth         *auth.Service
	billing      *billing.Service
	templatesDir string
}

// NewHandler creates a new web handler with authentication and billing services.
func NewHandler(auth *auth.Service, billing *billing.Service) *Handler {
	return &Handler{
		auth:         auth,
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

	user, session, err := h.auth.Login(r.Context(), username, password)
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

	session, err := h.auth.CreateSession(r.Context(), user.ID)
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
