package api

// /mcp: the Model Context Protocol endpoint officers connect their own agents to
// (docs/mcp.md). Streamable HTTP transport, stateless: every POST carries one JSON-RPC
// message (or a batch) and gets a plain JSON answer; there are no SSE streams or sessions.
//
// Authentication is an OAuth access token (oauth.go) that resolves to the officer. A tool
// call becomes an in-process request to the existing API route, run through withAuth with
// that officer as the principal, so every permission check, validation rule and audit
// entry is exactly the one the dashboard UI gets. Tools are generated from the API
// contract into mcp_tools.json by scripts/gen-mcp-tools.mjs.

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"

	"officerdashboard/internal/auth"
	"officerdashboard/internal/store"
)

//go:embed mcp_tools.json
var mcpToolsJSON []byte

type mcpTool struct {
	Name        string          `json:"name"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Endpoint    string          `json:"endpoint"`
	Method      string          `json:"method"`
	Path        string          `json:"path"`
	MinRole     string          `json:"minRole"`
	QueryKeys   []string        `json:"queryKeys"`
	FieldKeys   []string        `json:"fieldKeys"`
	Multipart   string          `json:"multipart"` // "" | "file" | "csv"
	Response    string          `json:"response"`  // "json" | "text"
	Annotations json.RawMessage `json:"annotations"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

var (
	mcpTools      []mcpTool
	mcpToolByName = map[string]*mcpTool{}
)

func init() {
	var f struct {
		Tools []mcpTool `json:"tools"`
	}
	if err := json.Unmarshal(mcpToolsJSON, &f); err != nil {
		panic("mcp_tools.json: " + err.Error())
	}
	mcpTools = f.Tools
	for i := range mcpTools {
		mcpToolByName[mcpTools[i].Name] = &mcpTools[i]
	}
}

const (
	mcpMaxBody     = 16 << 20 // base64 of a 10 MB receipt fits
	mcpMaxResult   = 256 << 10
	mcpLatestProto = "2025-11-25"
	mcpInstruction = "You are acting as a CSEED club officer on the CSEED Officer Dashboard, with exactly that officer's permissions. " +
		"Call whoami first to learn their role and time zone. Use search or the list_* tools to find ids. " +
		"Money is integer cents; dates are YYYY-MM-DD; datetimes are ISO 8601 with offset. " +
		"Every change is recorded in the audit log as the officer, via this agent. " +
		"Confirm with the officer before deleting anything or approving, denying or settling money."
)

var mcpProtocols = map[string]bool{"2025-11-25": true, "2025-06-18": true, "2025-03-26": true, "2024-11-05": true}

// mcpAuthenticate resolves the bearer access token to its grant and (freshly loaded) user.
func (c *Ctx) mcpAuthenticate() (*store.OAuthGrant, *store.User, error) {
	m := bearerRE.FindStringSubmatch(c.R.Header.Get("Authorization"))
	if m == nil {
		return nil, nil, errors.New("missing")
	}
	ctx := c.Context()
	q := c.S.db.Read()
	g, err := q.GrantByAccessHash(ctx, auth.SHA256Hex(m[1]))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil, errors.New("invalid")
		}
		return nil, nil, err
	}
	now := c.S.nowMs()
	if g.RevokedAt != nil || g.AccessExpiresAt <= now {
		return nil, nil, errors.New("invalid")
	}
	u, err := q.UserByID(ctx, g.UserID)
	if err != nil || !u.Active {
		return nil, nil, errors.New("invalid")
	}
	if g.LastUsedAt == nil || now-*g.LastUsedAt > time.Minute.Milliseconds() {
		_ = c.S.db.Write(ctx, func(w *store.Queries) error { return w.TouchGrant(ctx, g.ID, now) })
	}
	return g, u, nil
}

func (c *Ctx) mcpUnauthorized(why string) error {
	allowCORS(c.W)
	v := `Bearer resource_metadata="` + c.baseURL() + `/.well-known/oauth-protected-resource", scope="` + mcpScope + `"`
	if why == "invalid" {
		v += `, error="invalid_token", error_description="The access token is invalid, expired or revoked"`
	}
	c.W.Header().Set("WWW-Authenticate", v)
	writeJSON(c.W, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "unauthenticated", "message": "Connect this agent to the dashboard first (OAuth)"}})
	return nil
}

// mcpNoStream answers GET/DELETE: this server has no SSE stream and no sessions.
func (c *Ctx) mcpNoStream() error {
	allowCORS(c.W)
	c.W.Header().Set("Allow", "POST, OPTIONS")
	http.Error(c.W, "Method not allowed: this MCP server is stateless; POST JSON-RPC messages", http.StatusMethodNotAllowed)
	return nil
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

func (c *Ctx) mcpPost() error {
	allowCORS(c.W)
	g, u, err := c.mcpAuthenticate()
	if err != nil {
		if err.Error() == "missing" || err.Error() == "invalid" {
			return c.mcpUnauthorized(err.Error())
		}
		return err
	}
	raw, err := io.ReadAll(http.MaxBytesReader(c.W, c.R.Body, mcpMaxBody))
	if err != nil {
		return fail(http.StatusRequestEntityTooLarge, "too_large", "Request too large")
	}
	raw = bytes.TrimSpace(raw)
	p := principal{user: u, agentID: g.ID}
	var msgs []rpcMessage
	batch := len(raw) > 0 && raw[0] == '['
	if batch {
		err = json.Unmarshal(raw, &msgs)
	} else {
		var m rpcMessage
		err = json.Unmarshal(raw, &m)
		msgs = []rpcMessage{m}
	}
	if err != nil {
		writeJSON(c.W, 400, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "Parse error"}})
		return nil
	}
	var out []rpcResponse
	for _, m := range msgs {
		if r := c.mcpHandle(p, m); r != nil {
			out = append(out, *r)
		}
	}
	c.W.Header().Set("Cache-Control", "no-store")
	switch {
	case len(out) == 0:
		// Only notifications or responses: 202 with no body (Streamable HTTP).
		c.W.WriteHeader(http.StatusAccepted)
	case batch:
		writeJSON(c.W, 200, out)
	default:
		writeJSON(c.W, 200, out[0])
	}
	return nil
}

// mcpHandle answers one JSON-RPC message; nil for notifications and client responses.
func (c *Ctx) mcpHandle(p principal, m rpcMessage) *rpcResponse {
	isRequest := m.Method != "" && len(m.ID) > 0 && string(m.ID) != "null"
	if !isRequest {
		return nil
	}
	res := &rpcResponse{JSONRPC: "2.0", ID: m.ID}
	switch m.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(m.Params, &params)
		proto := mcpLatestProto
		if mcpProtocols[params.ProtocolVersion] {
			proto = params.ProtocolVersion
		}
		res.Result = map[string]any{
			"protocolVersion": proto,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "cseed-dashboard", "title": "CSEED Officer Dashboard", "version": c.S.cfg.Version},
			"instructions":    mcpInstruction,
		}
	case "ping":
		res.Result = map[string]any{}
	case "tools/list":
		tools := []map[string]any{}
		for i := range mcpTools {
			t := &mcpTools[i]
			if !auth.HasRole(p.user.Role, t.MinRole) {
				continue // the officer could not use it; do not offer it
			}
			tools = append(tools, map[string]any{"name": t.Name, "title": t.Title, "description": t.Description, "inputSchema": t.InputSchema, "annotations": t.Annotations})
		}
		res.Result = map[string]any{"tools": tools}
	case "tools/call":
		var params struct {
			Name      string                     `json:"name"`
			Arguments map[string]json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(m.Params, &params); err != nil {
			res.Error = &rpcError{-32602, "Invalid params"}
			return res
		}
		t := mcpToolByName[params.Name]
		if t == nil {
			res.Error = &rpcError{-32602, "Unknown tool: " + params.Name}
			return res
		}
		res.Result = c.mcpCall(p, t, params.Arguments)
	case "resources/list":
		res.Result = map[string]any{"resources": []any{}}
	case "resources/templates/list":
		res.Result = map[string]any{"resourceTemplates": []any{}}
	case "prompts/list":
		res.Result = map[string]any{"prompts": []any{}}
	default:
		res.Error = &rpcError{-32601, "Method not found: " + m.Method}
	}
	return res
}

func toolText(text string, isError bool) map[string]any {
	return map[string]any{"content": []map[string]any{{"type": "text", "text": text}}, "isError": isError}
}

// argString renders a JSON argument as a query/form/path value.
func argString(raw json.RawMessage) ([]string, bool) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return []string{s}, true
	}
	var n json.Number
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if d.Decode(&n) == nil {
		return []string{n.String()}, true
	}
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return []string{strconv.FormatBool(b)}, true
	}
	var list []json.RawMessage
	if json.Unmarshal(raw, &list) == nil {
		var out []string
		for _, item := range list {
			v, ok := argString(item)
			if !ok {
				return nil, false
			}
			out = append(out, v...)
		}
		return out, true
	}
	if string(raw) == "null" {
		return nil, true
	}
	return nil, false
}

// mcpCall runs one tool as the officer and turns the API answer into a tool result.
func (c *Ctx) mcpCall(p principal, t *mcpTool, args map[string]json.RawMessage) map[string]any {
	if !auth.HasRole(p.user.Role, t.MinRole) {
		return toolText(fmt.Sprintf("Not allowed: %s requires the %s role and you are %s.", t.Name, t.MinRole, p.user.Role), true)
	}
	// Path parameters.
	path := t.Path
	for _, seg := range strings.Split(t.Path, "/") {
		if !strings.HasPrefix(seg, ":") {
			continue
		}
		vs, ok := argString(args[seg[1:]])
		if !ok || len(vs) != 1 || vs[0] == "" {
			return toolText("Missing required argument: "+seg[1:], true)
		}
		path = strings.Replace(path, seg, url.PathEscape(vs[0]), 1)
	}
	q := url.Values{}
	for _, k := range t.QueryKeys {
		if raw, ok := args[k]; ok {
			vs, ok := argString(raw)
			if !ok {
				return toolText("Argument "+k+" must be a string, number, boolean or list of them", true)
			}
			for _, v := range vs {
				q.Add(k, v)
			}
		}
	}
	target := path
	if len(q) > 0 {
		target += "?" + q.Encode()
	}
	var body io.Reader
	contentType := ""
	switch {
	case t.Multipart != "":
		b, ct, err := mcpMultipart(t, args)
		if err != nil {
			return toolText(err.Error(), true)
		}
		body, contentType = b, ct
	case args["body"] != nil:
		body, contentType = bytes.NewReader(args["body"]), "application/json"
	case t.Method == http.MethodPost || t.Method == http.MethodPut || t.Method == http.MethodPatch:
		body, contentType = strings.NewReader("{}"), "application/json"
	}
	ctx := context.WithValue(context.WithoutCancel(c.Context()), agentPrincipalKey{}, p)
	req, err := http.NewRequestWithContext(ctx, t.Method, target, body)
	if err != nil {
		return toolText("Invalid arguments: "+err.Error(), true)
	}
	req.Host = c.R.Host
	req.RemoteAddr = c.R.RemoteAddr
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "cseed-mcp")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := &recorder{header: http.Header{}, status: 200}
	c.S.inner.ServeHTTP(rec, req)
	text := rec.buf.String()
	if rec.truncated {
		text += "\n…(truncated: narrow the query or use limit/cursor)"
	}
	if rec.status >= 400 {
		var e struct {
			Error struct {
				Code    string          `json:"code"`
				Message string          `json:"message"`
				Details json.RawMessage `json:"details"`
			} `json:"error"`
		}
		msg := fmt.Sprintf("HTTP %d", rec.status)
		if json.Unmarshal(rec.buf.Bytes(), &e) == nil && e.Error.Message != "" {
			msg += " " + e.Error.Code + ": " + e.Error.Message
			if len(e.Error.Details) > 0 && string(e.Error.Details) != "null" {
				msg += "\nDetails: " + string(e.Error.Details)
			}
		} else if text != "" {
			msg += ": " + text
		}
		return toolText(msg, true)
	}
	if rec.status == http.StatusNoContent || strings.TrimSpace(text) == "" {
		text = `{"ok":true}`
	}
	return toolText(text, false)
}

// mcpMultipart builds the multipart/form-data body of an upload tool.
func mcpMultipart(t *mcpTool, args map[string]json.RawMessage) (io.Reader, string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, k := range t.FieldKeys {
		if raw, ok := args[k]; ok {
			vs, ok := argString(raw)
			if !ok {
				return nil, "", fmt.Errorf("argument %s must be a string", k)
			}
			for _, v := range vs {
				_ = mw.WriteField(k, v)
			}
		}
	}
	var filename, mimeType string
	_ = json.Unmarshal(args["filename"], &filename)
	var data []byte
	if t.Multipart == "csv" {
		var content string
		if json.Unmarshal(args["content"], &content) != nil || content == "" {
			return nil, "", errors.New("missing required argument: content (the CSV text)")
		}
		data, mimeType = []byte(content), "text/csv"
		if filename == "" {
			filename = "import.csv"
		}
	} else {
		var b64 string
		if json.Unmarshal(args["contentBase64"], &b64) != nil || b64 == "" {
			return nil, "", errors.New("missing required argument: contentBase64")
		}
		if json.Unmarshal(args["mimeType"], &mimeType) != nil || mimeType == "" {
			return nil, "", errors.New("missing required argument: mimeType")
		}
		b64 = strings.Map(func(r rune) rune {
			if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
				return -1
			}
			return r
		}, b64)
		var err error
		if data, err = base64.StdEncoding.DecodeString(b64); err != nil {
			if data, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(b64, "=")); err != nil {
				if data, err = base64.RawURLEncoding.DecodeString(strings.TrimRight(b64, "=")); err != nil {
					return nil, "", errors.New("contentBase64 is not valid base64")
				}
			}
		}
		if filename == "" {
			filename = "upload"
		}
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, strings.Map(func(r rune) rune {
		if r < 0x20 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, filename)))
	h.Set("Content-Type", mimeType)
	part, err := mw.CreatePart(h)
	if err != nil {
		return nil, "", err
	}
	if _, err := part.Write(data); err != nil {
		return nil, "", err
	}
	if err := mw.Close(); err != nil {
		return nil, "", err
	}
	return &buf, mw.FormDataContentType(), nil
}

// recorder captures an in-process API response, keeping at most mcpMaxResult bytes.
type recorder struct {
	header      http.Header
	status      int
	wroteHeader bool
	buf         bytes.Buffer
	truncated   bool
}

func (r *recorder) Header() http.Header { return r.header }

func (r *recorder) WriteHeader(code int) {
	if !r.wroteHeader {
		r.status, r.wroteHeader = code, true
	}
}

func (r *recorder) Write(p []byte) (int, error) {
	r.WriteHeader(http.StatusOK)
	if room := mcpMaxResult - r.buf.Len(); room < len(p) {
		if room > 0 {
			r.buf.Write(p[:room])
		}
		r.truncated = true
		return len(p), nil
	}
	return r.buf.Write(p)
}
