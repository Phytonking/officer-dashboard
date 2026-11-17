/**
 * /launchpad: the builder or mentor portal, chosen by the signed-in portal account. No portal
 * session → /launchpad/login. Portal calls never touch the officer session (lib/api/client.ts).
 */
import { useEffect } from "preact/hooks";
import { ApiCallError } from "../../lib/api/client";
import { useApi } from "../../lib/api/useApi";
import { interceptSamePageLinks } from "../../lib/nav";
import { ErrorState, Loading } from "../components/states";
import { BuilderHome } from "./Builder";
import { MentorHome } from "./Mentor";
import { PortalHeader } from "./shared";

export default function PortalApp() {
  const me = useApi("portalMe");
  useEffect(() => interceptSamePageLinks(), []);
  const signedOut = me.status === "error" && me.error instanceof ApiCallError && me.error.status === 401;
  useEffect(() => {
    if (signedOut) location.replace("/launchpad/login");
  }, [signedOut]);
  if (me.status === "loading" || signedOut) return <Loading rows={6} label="Loading Launchpad" />;
  if (me.status === "error") return <ErrorState error={me.error} onRetry={me.reload} />;
  const m = me.data;
  return (
    <div class="portal" data-portal={m.account.kind}>
      <PortalHeader me={m} />
      {m.account.status === "disabled" ? (
        <ErrorState title="Your Launchpad access is off" error={new Error("An officer has disabled this account. Ask them if you think that’s a mistake.")} />
      ) : m.account.kind === "mentor" ? (
        <MentorHome me={m} />
      ) : (
        <BuilderHome me={m} refreshMe={me.reload} />
      )}
    </div>
  );
}
