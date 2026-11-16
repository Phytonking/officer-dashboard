package calendar

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestBuildWithoutICSIsPlainText(t *testing.T) {
	m := string(Build("from@x.test", Message{To: "to@x.test", Subject: "You're invited", Text: "Accept: https://x.test/launchpad/join?token=abc"}, time.Now()))
	if strings.Contains(m, "text/calendar") || strings.Contains(m, "multipart") || !strings.Contains(m, "Content-Type: text/plain; charset=utf-8") {
		t.Fatalf("not a plain text email:\n%s", m)
	}
	body := m[strings.Index(m, "\r\n\r\n")+4:]
	raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.TrimSpace(body), "\r\n", ""))
	if err != nil || !strings.Contains(string(raw), "launchpad/join?token=abc") {
		t.Fatalf("body %q %v", raw, err)
	}
}
