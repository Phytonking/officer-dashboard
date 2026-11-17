/**
 * /launchpad/join?token=… (invite landing) and /launchpad/login (returning builders and
 * mentors). Both hand off to Discord: the server binds the invite to that Discord account,
 * starts a portal session and returns to /launchpad (docs/launchpad-cohorts.md).
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../lib/api/client";
import type { ResponseOf } from "../../lib/api/client";
import { errorMessage } from "../components/states";

const JOIN_ERRORS: Record<string, string> = {
  expired: "This invite link has expired. Ask the officer who invited you to resend it.",
  used: "This invite was already accepted. Sign in with the Discord account you used then.",
  discord_taken: "That Discord account is already linked to another Launchpad account. Continue with a different Discord account, or ask an officer to sort it out.",
  disabled: "This Launchpad account is disabled. Ask an officer if you think that’s a mistake.",
  not_found: "This invite link isn’t valid. Check that you opened the whole link from your email.",
  invalid: "This invite link isn’t valid. Check that you opened the whole link from your email.",
  failed: "Something went wrong accepting your invite. Try again in a minute.",
  state: "The sign-in took too long. Try again.",
  discord: "Discord sign-in failed. Try again.",
};
const LOGIN_ERRORS: Record<string, string> = {
  not_found: "That Discord account isn’t linked to Launchpad yet. Open the invite link from your email first.",
  no_account: "That Discord account isn’t linked to Launchpad yet. Open the invite link from your email first.",
  not_allowlisted: "That Discord account isn’t linked to Launchpad yet. Open the invite link from your email first.",
  disabled: "Your Launchpad account is disabled. Ask an officer if you think that’s a mistake.",
  inactive: "Your Launchpad account is disabled. Ask an officer if you think that’s a mistake.",
  archived: "Your Launchpad access is paused because your builder record was archived. Ask an officer to restore it.",
  failed: "Sign-in failed. Try again in a minute.",
  state: "The sign-in took too long. Try again.",
  discord: "Discord sign-in failed. Try again.",
};

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"
      />
    </svg>
  );
}

export function PortalCard({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="auth-card portal-card" aria-labelledby="portal-card-h">
      <span class="portal-brand">
        <img class="wordmark-logo wordmark-logo--ink" src="/images/cseed-wordmark.png" alt="CSEED" width="78" height="18" />
        <img class="wordmark-logo wordmark-logo--white" src="/images/cseed-wordmark-white.png" alt="" width="78" height="18" />
        <span class="portal-brand-sub">Launchpad</span>
      </span>
      <h1 id="portal-card-h">{title}</h1>
      {children}
    </section>
  );
}

/** Signed in already (another tab, or a returning builder opening an old link)? Offer the way in. */
function useSignedIn() {
  const [me, setMe] = useState<ResponseOf<"portalMe"> | null>(null);
  useEffect(() => {
    api("portalMe").then(setMe, () => setMe(null));
  }, []);
  return me;
}

// A failed invite sign-in comes back as /launchpad/join?error=… without the token (the server
// only keeps its hash), so the tab remembers the token to offer "Continue" again.
const INVITE_KEY = "launchpad-invite-token";
function inviteToken(params: URLSearchParams): string {
  const fromUrl = params.get("token") ?? "";
  try {
    if (fromUrl) sessionStorage.setItem(INVITE_KEY, fromUrl);
    else if (params.get("error")) return sessionStorage.getItem(INVITE_KEY) ?? "";
  } catch {
    // Storage unavailable: fall back to the URL only.
  }
  return fromUrl;
}

export function JoinPage() {
  const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const token = typeof location === "undefined" ? "" : inviteToken(params);
  const error = params.get("error");
  const [preview, setPreview] = useState<ResponseOf<"portalInvitePreview"> | null>(null);
  const [failure, setFailure] = useState("");
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!token) return;
    api("portalInvitePreview", { query: { token } }).then(setPreview, (e) => setFailure(errorMessage(e)));
  }, [token]);
  const kind = preview?.kind === "mentor" ? "mentor" : "builder";
  const reason = error ?? (preview && !preview.valid ? preview.reason ?? "not_found" : null);
  const title = !token
    ? "This link is incomplete"
    : preview?.valid
      ? kind === "mentor"
        ? "You’re invited to mentor"
        : `You’re invited to ${preview.cohortName ?? "Launchpad"}`
      : reason
        ? "This invite can’t be used"
        : "Checking your invite…";
  return (
    <PortalCard title={title}>
      <div data-join-state={!token ? "missing" : reason ? "error" : preview?.valid ? "valid" : "loading"} class="stack stack--tight">
        {reason && (
          <p class="notice notice--negative" role="alert" data-join-error={reason}>
            {JOIN_ERRORS[reason] ?? "Something went wrong with this invite. Try again, or ask the officer who invited you."}
          </p>
        )}
        {failure && <p class="notice notice--negative" role="alert">{failure}</p>}
        {!token && <p class="muted">Open the full link from your invite email. If it still doesn’t work, ask the officer who invited you to resend it.</p>}
        {preview?.valid && (
          <>
            <p class="muted flush">
              {kind === "mentor"
                ? "CSEED Launchpad mentors see the projects they’re assigned to, their builders’ weekly updates, and can leave notes for the team."
                : "Launchpad is where your team keeps its project, weekly check-ins and mentors together. Setup takes about two minutes."}
            </p>
            <dl class="portal-facts">
              {preview.name && (
                <div>
                  <dt>Name</dt>
                  <dd>{preview.name}</dd>
                </div>
              )}
              {preview.cohortName && (
                <div>
                  <dt>Cohort</dt>
                  <dd>{preview.cohortName}</dd>
                </div>
              )}
              <div>
                <dt>Role</dt>
                <dd>{kind === "mentor" ? "Mentor" : "Builder"}</dd>
              </div>
              {preview.emailHint && (
                <div>
                  <dt>Sent to</dt>
                  <dd>{preview.emailHint}</dd>
                </div>
              )}
            </dl>
            <p class="small muted flush">You’ll sign in with Discord. The Discord account you choose becomes your Launchpad sign-in, so pick the one you use for CSEED.</p>
          </>
        )}
        {token && (preview?.valid || (error && error !== "used" && error !== "disabled")) && (
          <a class="btn btn--primary btn--block" href={`/auth/login?launchpad=${encodeURIComponent(token)}`} data-join-continue>
            <DiscordIcon />
            Continue with Discord
          </a>
        )}
        {(reason === "used" || signedIn) && (
          <a class="btn btn--block" href={signedIn ? "/launchpad" : "/launchpad/login"}>
            {signedIn ? `Go to Launchpad as ${signedIn.account.name || signedIn.account.email}` : "Sign in to Launchpad"}
          </a>
        )}
      </div>
    </PortalCard>
  );
}

export function LoginPage() {
  const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const error = params.get("error");
  const signedIn = useSignedIn();
  useEffect(() => {
    if (signedIn && !error) location.replace("/launchpad");
  }, [signedIn]);
  return (
    <PortalCard title="Sign in to Launchpad">
      <div class="stack stack--tight" data-portal-login>
        {error && (
          <p class="notice notice--negative" role="alert" data-login-error={error}>
            {LOGIN_ERRORS[error] ?? "Sign-in failed. Try again."}
          </p>
        )}
        <p class="muted flush">For Launchpad builders and mentors. Use the Discord account you joined with.</p>
        <a class="btn btn--primary btn--block" href="/auth/login?portal=1" data-portal-signin>
          <DiscordIcon />
          Sign in with Discord
        </a>
        <p class="small muted flush">
          New here? Open the invite link from your email. Officers sign in at <a href="/login">the officer dashboard</a>.
        </p>
      </div>
    </PortalCard>
  );
}
