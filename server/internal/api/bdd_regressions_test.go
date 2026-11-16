package api

import (
	"strings"
	"testing"
)

// Regressions from persona (BDD) runs: how officers, directors, hosts and tokens hand work to each other.

// A director moves an invitee to another subteam mid-setup; the invitee's next setup save keeps it.
func TestInviteeSubteamMoveSurvivesSetupSave(t *testing.T) {
	e, alex, _ := newInvitee(t, nil)
	e.mustOK(e.do("PUT", "/api/me/profile", validProfile, alex))
	id := e.mustOK(e.get("/api/me", alex)).str("user", "id")
	e.mustOK(e.do("PATCH", "/api/officers/"+id, map[string]any{"subteamId": "team-design"}, e.director()))
	e.mustOK(e.do("PUT", "/api/me/profile", validProfile, alex))
	if got := e.mustOK(e.get("/api/me", alex)).str("onboarding", "subteam", "id"); got != "team-design" {
		t.Fatalf("subteam after setup save = %q, want team-design", got)
	}
}

// An expired invite no longer blocks adding the same Discord account from Access.
func TestAdminCreateReplacesExpiredInvite(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"name": "Kim", "discordId": "100000000000000888", "subteamId": "team-events"}
	e.mustOK(e.post("/api/invites", body, e.director()))
	expectStatus(t, "pending invite", e.post("/api/admin/users", body, e.director()), 409)
	if _, err := e.db.W.Exec(`UPDATE invites SET expires_at=1 WHERE discord_id='100000000000000888'`); err != nil {
		t.Fatal(err)
	}
	created := e.mustOK(e.post("/api/admin/users", body, e.director()))
	if created.str("user", "name") != "Kim" {
		t.Fatalf("created %s", created.Raw)
	}
}

// Only the host or a director+ hands an event to another host, so the "host may rule out
// design" rule can't be bypassed by an officer naming themselves host.
func TestOnlyHostOrDirectorChangesTheHost(t *testing.T) {
	e := newEnv(t)
	priya, marcus := e.officer(), e.as("user-marcus")
	id := e.mustOK(e.post("/api/events", map[string]any{"name": "Hosted", "startsAt": "2026-12-04T02:00:00Z", "hostUserId": "user-priya"}, priya)).str("event", "id")
	expectStatus(t, "non-host takes over", e.do("PATCH", "/api/events/"+id, map[string]any{"hostUserId": "user-marcus"}, marcus), 403)
	expectStatus(t, "non-host rules out design", e.do("PUT", "/api/events/"+id+"/design-need", map[string]any{"designNeed": "not_needed"}, marcus), 403)
	// Other edits by any officer, re-sending the same host included, still work.
	e.mustOK(e.do("PATCH", "/api/events/"+id, map[string]any{"location": "Atrium", "hostUserId": "user-priya"}, marcus))
	e.mustOK(e.do("PATCH", "/api/events/"+id, map[string]any{"hostUserId": "user-marcus"}, priya))
	e.mustOK(e.do("PATCH", "/api/events/"+id, map[string]any{"hostUserId": "user-ava"}, e.director()))
}

// A Luma import for an event whose page an officer already linked (lu.ma/event/evt-…) lands on
// that event and publishes it, instead of creating a duplicate.
func TestLumaIngestUsesTheLinkedEvent(t *testing.T) {
	e := newEnv(t)
	id := e.mustOK(e.post("/api/events", map[string]any{"name": "Linked", "startsAt": "2026-12-04T02:00:00Z", "lumaUrl": "https://lu.ma/event/evt-Linked42"}, e.officer())).str("event", "id")
	before := e.scalar(`SELECT count(*) FROM events`)
	token := e.mustOK(e.post("/api/admin/tokens", map[string]any{"name": "luma", "scopes": []string{"ingest:luma"}}, e.director())).str("plaintext")
	e.mustOK(e.post("/api/ingest/luma", map[string]any{
		"event":  map[string]any{"lumaId": "evt-Linked42", "name": "Linked", "startsAt": "2026-12-04T02:00:00Z"},
		"guests": []any{map[string]any{"email": "q@example.org"}},
	}, bearer(token)))
	if after := e.scalar(`SELECT count(*) FROM events`); after != before {
		t.Fatalf("events %v → %v: ingest created a duplicate", before, after)
	}
	if st := e.scalar(`SELECT status FROM events WHERE id=?`, id); st != "published" {
		t.Fatalf("linked draft status %v", st)
	}
}

// The design brief and due date use the club's time zone, whoever drafts it.
func TestDesignDraftUsesClubZone(t *testing.T) {
	e := newEnv(t)
	traveller := e.as("user-marcus")
	e.mustOK(e.do("PUT", "/api/me/prefs", map[string]any{"timezoneMode": "manual", "timezone": "Pacific/Kiritimati"}, traveller))
	home := e.mustOK(e.get("/api/events/event-hack-night/design-request-draft", e.officer()))
	away := e.mustOK(e.get("/api/events/event-hack-night/design-request-draft", traveller))
	if home.str("draft", "brief") != away.str("draft", "brief") || home.str("draft", "dueDate") != away.str("draft", "dueDate") {
		t.Fatalf("drafts differ by viewer zone:\n%s\n%s", home.Raw, away.Raw)
	}
	if !strings.Contains(away.str("draft", "brief"), "PST") {
		t.Fatalf("brief not in club zone: %s", away.str("draft", "brief"))
	}
}

// A settlement amount past what the ledger can safely sum is refused, even for leadership.
func TestSettlementAmountIsBounded(t *testing.T) {
	e := newEnv(t)
	id := e.mustOK(e.post("/api/requests", with(purchase, "submit", true), e.officer())).str("request", "id")
	e.mustOK(e.post("/api/requests/"+id+"/approve", map[string]any{}, e.director()))
	e.mustOK(e.post("/api/requests/"+id+"/transition", map[string]any{"to": "fulfilling"}, e.director()))
	lead := e.as("user-leadership")
	expectStatus(t, "unsafe actual", e.post("/api/requests/"+id+"/transition", map[string]any{"to": "fulfilled", "actualTotalCents": 9007199254740991}, lead), 400)
	e.mustOK(e.post("/api/requests/"+id+"/transition", map[string]any{"to": "fulfilled", "actualTotalCents": 9500}, lead))
}

// A request stuck in "buying" (a manual move or a stale agent claim) goes back to approved:
// allowedTransitions offers it and the API accepts it, the claimed job is cancelled, and a
// queued job is only listed to the agent while its request is approved.
func TestBuyingRequestGoesBackToApproved(t *testing.T) {
	e := newEnv(t)
	token := e.mustOK(e.post("/api/admin/tokens", map[string]any{"name": "agent", "scopes": []string{"agent:jobs"}}, e.director())).str("plaintext")
	id := e.mustOK(e.post("/api/requests", with(purchase, "submit", true), e.officer())).str("request", "id")
	e.mustOK(e.post("/api/requests/"+id+"/approve", map[string]any{}, e.director()))
	jobID := findJob(e.get("/api/agent/jobs", bearer(token)), id)
	// A director marks it as buying by hand: the agent no longer sees a job it can't claim.
	e.mustOK(e.post("/api/requests/"+id+"/transition", map[string]any{"to": "fulfilling"}, e.director()))
	if findJob(e.get("/api/agent/jobs", bearer(token)), id) != "" {
		t.Fatal("queued job listed while the request is being bought")
	}
	expectStatus(t, "approve via transition on submitted", e.post("/api/requests/"+id+"/transition", map[string]any{"to": "approved"}, e.officer()), 403)
	other := e.as("user-leadership")
	if !strings.Contains(string(e.mustOK(e.get("/api/requests/"+id, other)).Raw), `"allowedTransitions":["fulfilled","approved"]`) {
		t.Fatal("approved not offered")
	}
	e.mustOK(e.post("/api/requests/"+id+"/transition", map[string]any{"to": "approved"}, e.director()))
	if findJob(e.get("/api/agent/jobs", bearer(token)), id) != jobID {
		t.Fatal("queued job not listed again once approved")
	}
	// Claimed by the agent, then sent back: the claim is cancelled, so nothing is bought twice.
	e.mustOK(e.post("/api/agent/jobs/"+jobID+"/claim", nil, bearer(token)))
	e.mustOK(e.post("/api/requests/"+id+"/transition", map[string]any{"to": "approved"}, e.director()))
	if st := e.scalar(`SELECT status FROM fulfillment_jobs WHERE id=?`, jobID); st != "cancelled" {
		t.Fatalf("claimed job %v after send-back", st)
	}
	expectStatus(t, "stale complete", e.post("/api/agent/jobs/"+jobID+"/complete", map[string]any{"outcome": "done", "actualTotalCents": 9000}, bearer(token)), 409)
	// /transition never stands in for a decision on a submitted request.
	id2 := e.mustOK(e.post("/api/requests", with(purchase, "submit", true), e.officer())).str("request", "id")
	expectStatus(t, "decision via transition", e.post("/api/requests/"+id2+"/transition", map[string]any{"to": "approved"}, e.director()), 409)
}
