import { DateRage } from "@/app/(client-components)/type";

const converSelectedDateToString = ([startDate, endDate]: DateRage, locale: string = "en-US") => {
  const dateString =
    (startDate?.toLocaleDateString(locale, {
      month: "short",
      day: "2-digit",
    }) || "") +
    (endDate
      ? " - " +
        endDate?.toLocaleDateString(locale, {
          month: "short",
          day: "2-digit",
        })
      : "");
  return dateString;
};

export default converSelectedDateToString;
