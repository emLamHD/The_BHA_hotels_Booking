"use client";

import React, { FC, useEffect } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCustomerSession } from "@/app/CustomerSessionProvider";
import { CustomerSessionNotice } from "@/components/CustomerAuthNotice";
import { HOME_PAGE } from "@/lib/customerAuthUi";
import { LOGIN_FOR_ACCOUNT_HREF } from "@/lib/authReturnTarget";
import { describeAccountView } from "@/lib/customerAccountUi";
import ButtonSecondary from "@/shared/ButtonSecondary";

/**
 * CUST-WEB-001-CP04. The read-only account page. What it shows is `describeAccountView` of the provider's
 * `me` state and identity phase, re-derived on every render: no copy of the email is kept here, the page
 * does not read the session itself, and it never starts or repeats an auth request. The email appears only
 * for a verified, idle session; the login redirect only for a verified-anonymous, idle one. Logging out is
 * the header's guarded command, not a second button here.
 *
 * CUST-WEB-001-CP08a-C2: the login redirect carries `returnTo=/account` (`lib/authReturnTarget`), so a visitor who
 * chose "Tài khoản của tôi" while signed out comes back here after signing in.
 */
const AccountSessionPanel: FC = () => {
  const router = useRouter();
  const { state, identityChange } = useCustomerSession();
  const view = describeAccountView(state, identityChange.phase);

  useEffect(() => {
    if (view.kind === "redirect-login") router.replace(LOGIN_FOR_ACCOUNT_HREF as Route);
  }, [view.kind, router]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <h2 className="text-3xl font-semibold">Tài khoản</h2>
      <div className="w-14 border-b border-neutral-200 dark:border-neutral-700"></div>
      <div className="max-w-2xl space-y-6">
        <CustomerSessionNotice />
        {view.kind === "redirect-login" && (
          <p role="status" className="text-sm text-neutral-600 dark:text-neutral-300">
            Bạn chưa đăng nhập. Đang chuyển tới trang đăng nhập…
          </p>
        )}
        {view.kind === "ready" && (
          <section aria-label="Thông tin tài khoản" className="space-y-4 rounded-2xl border border-neutral-200 p-6 dark:border-neutral-700">
            <div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Email tài khoản</p>
              <p className="break-all text-lg font-semibold text-neutral-900 dark:text-neutral-100">{view.email}</p>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Hiện chỉ xem email tài khoản; chỉnh sửa hồ sơ và lịch sử đặt phòng chưa được hỗ trợ.
            </p>
            <ButtonSecondary href={HOME_PAGE as Route}>Về trang chủ</ButtonSecondary>
          </section>
        )}
      </div>
    </div>
  );
};

export default AccountSessionPanel;
