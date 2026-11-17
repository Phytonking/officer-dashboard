//go:build dev

package api

import (
	"net/url"
	"testing"
)

func TestDevLoginAsBuilderAndMentorGivesPortalSessions(t *testing.T) {
	e := newEnv(t, func(c *Config) { c.DevAuth = true })
	for kind, account := range map[string]string{"builder": "lp-account-alex", "mentor": "lp-account-maya"} {
		r := e.devPost(url.Values{"as": {kind}}, anon)
		if r.Status != 303 || r.Header.Get("Location") != "/launchpad" {
			t.Fatalf("%s → %d %s", kind, r.Status, r.Header.Get("Location"))
		}
		ck := cookieNamed(setCookies(r), e.srv.portalCookieName())
		if ck == nil || cookieNamed(setCookies(r), e.srv.sessionCookieName()) != nil {
			t.Fatalf("%s: portal cookie only", kind)
		}
		me := e.mustOK(e.get("/api/portal/me", actor{cookie: ck}))
		if me.str("account", "id") != account {
			t.Fatalf("%s me %s", kind, me.Raw)
		}
		expectStatus(t, kind+" on officer API", e.get("/api/me", actor{cookie: ck}), 401)
	}
	expectStatus(t, "unknown account", e.devPost(url.Values{"as": {"builder"}, "user": {"lp-invite-sky"}}, anon), 400)
	off := newEnv(t, func(c *Config) { c.DevAuth = false })
	expectStatus(t, "DEV_AUTH unset", off.devPost(url.Values{"as": {"builder"}}, anon), 404)
}

func TestDevLoginAcceptsLaunchpadInviteLikeTheCallback(t *testing.T) {
	e := newEnv(t, func(c *Config) { c.DevAuth = true })
	form := url.Values{"launchpad": {"demo-launchpad-invite-sky"}, "discord": {"300000000000000077"}}
	r := e.devPost(form, anon)
	if r.Status != 302 || r.Header.Get("Location") != "/launchpad" {
		t.Fatalf("accept → %d %s", r.Status, r.Header.Get("Location"))
	}
	ck := cookieNamed(setCookies(r), e.srv.portalCookieName())
	if ck == nil {
		t.Fatal("no portal cookie")
	}
	me := e.mustOK(e.get("/api/portal/me", actor{cookie: ck}))
	if me.str("account", "id") != "lp-invite-sky" || me.str("account", "status") != "active" {
		t.Fatalf("me %s", me.Raw)
	}
	// The same link with another Discord account is refused like a real second sign-in.
	r = e.devPost(url.Values{"launchpad": {"demo-launchpad-invite-sky"}, "discord": {"300000000000000078"}}, anon)
	if r.Header.Get("Location") != "/launchpad/join?error=used" {
		t.Fatalf("reuse → %s", r.Header.Get("Location"))
	}
	expectStatus(t, "bad discord id", e.devPost(url.Values{"launchpad": {"x"}, "discord": {"abc"}}, anon), 400)
	off := newEnv(t, func(c *Config) { c.DevAuth = false })
	expectStatus(t, "DEV_AUTH unset", off.devPost(form, anon), 404)
}
