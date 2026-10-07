import CreateReservationForm from "@/components/reservations/create-reservation/CreateReservationForm";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Create Reservation | The BHA Admin",
  description:
    "Direct Admin / walk-in Create Reservation workspace — local demo data only.",
};

export default function Page() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageBreadcrumb pageTitle="Create Reservation" />
      <CreateReservationForm />
    </div>
  );
}
