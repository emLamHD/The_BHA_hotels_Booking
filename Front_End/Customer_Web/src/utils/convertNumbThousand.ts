const convertNumbThousand = (x?: number, locale: string = "en-US"): string => {
  if (!x) {
    return "0";
  }
  return x.toLocaleString(locale);
};
export default convertNumbThousand;
