import type { PurchaseRequestDetail } from '../../lib/contracts';
import { formatCents } from '../../lib/format';
import { Notice } from './states';

/**
 * Banner for a request whose agent settlement is held for director review (PR #6, M1). The next
 * step depends on the viewer: someone who can settle it is told to (or, above their ceiling, that
 * leadership must); everyone else, the requester included, is told who will.
 */
export function SettlementHoldNotice({ hold, canSettle, maxCents }: { hold: PurchaseRequestDetail['settlementHold']; canSettle: boolean; maxCents: number | null }) {
  if (!hold) return null;
  const next = !canSettle
    ? 'A director other than the requester settles it.'
    : maxCents !== null && hold.attemptedCents > maxCents
      ? `That is over the ${formatCents(maxCents)} you can record, so leadership settles it.`
      : 'Settle it below with the actual amount.';
  return (
    <div data-settlement-hold>
      <Notice tone="attention">
        <strong>Held for director review:</strong> the purchasing agent reported {formatCents(hold.attemptedCents)} vs{' '}
        {formatCents(hold.approvedCents)} approved. {next}
      </Notice>
    </div>
  );
}
