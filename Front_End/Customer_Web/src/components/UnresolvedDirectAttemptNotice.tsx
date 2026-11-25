"use client";

import React, { FC, useSyncExternalStore } from "react";
import ButtonSecondary from "@/shared/ButtonSecondary";
import { getDirectAttemptMarker } from "@/lib/api/directAttemptMarker";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** True while this tab's marker says a "pay at the property" attempt may be unresolved. False on the server and while hydrating. */
export function useUnresolvedDirectAttempt(): boolean {
  const marker = getDirectAttemptMarker();
  return useSyncExternalStore(marker.subscribe, marker.isSet, () => false);
}

/**
 * BHA-CHECKOUT-001-PR08: shown after a reload (or whenever no in-memory attempt is left) when the marker is set. It
 * cannot verify anything — the credential never left tab memory — so it says so, points to the property, and lets the
 * guest acknowledge it. It never creates or resends a booking.
 */
const UnresolvedDirectAttemptNotice: FC<{ className?: string }> = ({ className = "" }) => {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      data-testid="unresolved-direct-attempt"
      className={`space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100 ${className}`}
    >
      <p className="font-medium">{t("customer.direct.unresolved.title")}</p>
      <p>{t("customer.direct.unresolved.body")}</p>
      <ButtonSecondary type="button" onClick={() => getDirectAttemptMarker().clear()}>
        {t("customer.direct.unresolved.dismiss")}
      </ButtonSecondary>
    </div>
  );
};

export default UnresolvedDirectAttemptNotice;
