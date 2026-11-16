package store

import (
	"context"
	"database/sql"
	"encoding/json"
)

// OAuthClient is an oauth_clients row: an MCP client (Claude Code, Cursor, …) that
// registered itself. Clients are public (no secret); PKCE protects the code exchange.
type OAuthClient struct {
	ID           string
	Name         string
	RedirectURIs []string
	CreatedAt    Ms
}

// InsertOAuthClient stores a dynamically registered client.
func (q *Queries) InsertOAuthClient(ctx context.Context, c OAuthClient) error {
	uris, err := json.Marshal(c.RedirectURIs)
	if err != nil {
		return err
	}
	_, err = q.q.ExecContext(ctx, `INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)`, c.ID, c.Name, string(uris), int64(c.CreatedAt))
	return err
}

// OAuthClientByID returns ErrNotFound for an unknown client.
func (q *Queries) OAuthClientByID(ctx context.Context, id string) (*OAuthClient, error) {
	var c OAuthClient
	var uris string
	err := q.q.QueryRowContext(ctx, `SELECT id, name, redirect_uris, created_at FROM oauth_clients WHERE id = ?`, id).Scan(&c.ID, &c.Name, &uris, &c.CreatedAt)
	if err != nil {
		return nil, notFound(err)
	}
	if err := json.Unmarshal([]byte(uris), &c.RedirectURIs); err != nil {
		return nil, err
	}
	return &c, nil
}

// OAuthCode is a pending authorization code (single use, short-lived).
type OAuthCode struct {
	CodeHash      string
	ClientID      string
	UserID        string
	RedirectURI   string
	CodeChallenge string
	ExpiresAt     int64
}

// InsertOAuthCode stores a new authorization code.
func (q *Queries) InsertOAuthCode(ctx context.Context, c OAuthCode) error {
	_, err := q.q.ExecContext(ctx, `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at) VALUES (?,?,?,?,?,?)`,
		c.CodeHash, c.ClientID, c.UserID, c.RedirectURI, c.CodeChallenge, c.ExpiresAt)
	return err
}

// TakeOAuthCode deletes and returns a code, so it can be redeemed only once, and drops
// any other expired codes on the way. ErrNotFound when it is unknown or already used.
func (q *Queries) TakeOAuthCode(ctx context.Context, codeHash string, now int64) (*OAuthCode, error) {
	var c OAuthCode
	err := q.q.QueryRowContext(ctx, `DELETE FROM oauth_codes WHERE code_hash = ? RETURNING code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at`, codeHash).
		Scan(&c.CodeHash, &c.ClientID, &c.UserID, &c.RedirectURI, &c.CodeChallenge, &c.ExpiresAt)
	if err != nil {
		return nil, notFound(err)
	}
	if _, err := q.q.ExecContext(ctx, `DELETE FROM oauth_codes WHERE expires_at <= ?`, now); err != nil {
		return nil, err
	}
	return &c, nil
}

// OAuthGrant is one connected agent: an officer's consent to one client, with the current
// access and refresh token hashes (both rotate on refresh).
type OAuthGrant struct {
	ID               string
	ClientID         string
	ClientName       string
	UserID           string
	AccessHash       string
	AccessExpiresAt  int64
	RefreshHash      string
	RefreshExpiresAt int64
	CreatedAt        int64
	LastUsedAt       *int64
	RevokedAt        *int64
}

const grantCols = `g.id, g.client_id, c.name, g.user_id, g.access_hash, g.access_expires_at, g.refresh_hash, g.refresh_expires_at, g.created_at, g.last_used_at, g.revoked_at`
const grantFrom = ` FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id`

func scanGrant(s interface{ Scan(...any) error }) (*OAuthGrant, error) {
	var g OAuthGrant
	var used, rev sql.NullInt64
	if err := s.Scan(&g.ID, &g.ClientID, &g.ClientName, &g.UserID, &g.AccessHash, &g.AccessExpiresAt, &g.RefreshHash, &g.RefreshExpiresAt, &g.CreatedAt, &used, &rev); err != nil {
		return nil, err
	}
	if used.Valid {
		g.LastUsedAt = &used.Int64
	}
	if rev.Valid {
		g.RevokedAt = &rev.Int64
	}
	return &g, nil
}

// InsertOAuthGrant stores a new grant.
func (q *Queries) InsertOAuthGrant(ctx context.Context, g OAuthGrant) error {
	_, err := q.q.ExecContext(ctx, `INSERT INTO oauth_grants (id, client_id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)`,
		g.ID, g.ClientID, g.UserID, g.AccessHash, g.AccessExpiresAt, g.RefreshHash, g.RefreshExpiresAt, g.CreatedAt)
	return err
}

// GrantByAccessHash returns ErrNotFound for an unknown access token.
func (q *Queries) GrantByAccessHash(ctx context.Context, hash string) (*OAuthGrant, error) {
	g, err := scanGrant(q.q.QueryRowContext(ctx, `SELECT `+grantCols+grantFrom+` WHERE g.access_hash = ?`, hash))
	return g, notFound(err)
}

// GrantByRefreshHash returns ErrNotFound for an unknown (or already rotated) refresh token.
func (q *Queries) GrantByRefreshHash(ctx context.Context, hash string) (*OAuthGrant, error) {
	g, err := scanGrant(q.q.QueryRowContext(ctx, `SELECT `+grantCols+grantFrom+` WHERE g.refresh_hash = ?`, hash))
	return g, notFound(err)
}

// GrantByID returns ErrNotFound for an unknown grant.
func (q *Queries) GrantByID(ctx context.Context, id string) (*OAuthGrant, error) {
	g, err := scanGrant(q.q.QueryRowContext(ctx, `SELECT `+grantCols+grantFrom+` WHERE g.id = ?`, id))
	return g, notFound(err)
}

// UserGrants lists a user's live grants, newest first.
func (q *Queries) UserGrants(ctx context.Context, userID string) ([]OAuthGrant, error) {
	rows, err := q.q.QueryContext(ctx, `SELECT `+grantCols+grantFrom+` WHERE g.user_id = ? AND g.revoked_at IS NULL ORDER BY g.created_at DESC, g.rowid DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OAuthGrant
	for rows.Next() {
		g, err := scanGrant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *g)
	}
	return out, rows.Err()
}

// RotateGrant replaces both tokens of a grant (refresh-token rotation).
func (q *Queries) RotateGrant(ctx context.Context, id, accessHash string, accessExp int64, refreshHash string, refreshExp int64) error {
	_, err := q.q.ExecContext(ctx, `UPDATE oauth_grants SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?`,
		accessHash, accessExp, refreshHash, refreshExp, id)
	return err
}

// TouchGrant records that a grant's access token was used.
func (q *Queries) TouchGrant(ctx context.Context, id string, now int64) error {
	_, err := q.q.ExecContext(ctx, `UPDATE oauth_grants SET last_used_at = ? WHERE id = ?`, now, id)
	return err
}

// RevokeGrant disconnects one agent (the row stays for the audit trail).
func (q *Queries) RevokeGrant(ctx context.Context, id string, now int64) error {
	_, err := q.q.ExecContext(ctx, `UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, id)
	return err
}

// RevokeUserGrants disconnects every agent of a user.
func (q *Queries) RevokeUserGrants(ctx context.Context, userID string, now int64) error {
	_, err := q.q.ExecContext(ctx, `UPDATE oauth_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, now, userID)
	return err
}

// AgentNames maps grant ids to their client names, for the audit log.
func (q *Queries) AgentNames(ctx context.Context) (map[string]string, error) {
	rows, err := q.q.QueryContext(ctx, `SELECT g.id, c.name`+grantFrom)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}
