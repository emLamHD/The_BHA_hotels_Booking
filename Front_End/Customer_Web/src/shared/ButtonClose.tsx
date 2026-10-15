import React from "react";
import { XMarkIcon } from "@heroicons/react/24/solid";
import twFocusClass from "@/utils/twFocusClass";

import { useT } from "@/lib/i18n/I18nProvider";
export interface ButtonCloseProps {
  className?: string;
  onClick?: () => void;
}

const ButtonClose: React.FC<ButtonCloseProps> = ({
  className = "",
  onClick = () => {},
}) => {
  const t = useT();
  return (
    <button
      className={
        `w-8 h-8 flex items-center justify-center rounded-full text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 ${className} ` +
        twFocusClass()
      }
      onClick={onClick}
    >
      <span className="sr-only">{t("customer.shared.buttonClose.close")}</span>
      <XMarkIcon className="w-5 h-5" />
    </button>
  );
};

export default ButtonClose;
