import React, { FC } from "react";
import SectionSubscribe2 from "@/components/SectionSubscribe2";
import SocialsList from "@/shared/SocialsList";
import Label from "@/components/Label";
import Input from "@/shared/Input";
import Textarea from "@/shared/Textarea";
import ButtonPrimary from "@/shared/ButtonPrimary";

import { getT } from "@/lib/i18n/server";
import { Tpl } from "@/lib/i18n/Tpl";
export interface PageContactProps {}

const info = [
  {
    title: "🗺 ADDRESS",
    desc: "Photo booth tattooed prism, portland taiyaki hoodie neutra typewriter",
  },
  {
    title: "💌 EMAIL",
    desc: "nc.example@example.com",
  },
  {
    title: "☎ PHONE",
    desc: "000-123-456-7890",
  },
];

async function PageContact(_props: PageContactProps) {
  const t = await getT();
  return (
    <div className={`nc-PageContact overflow-hidden`}>
      <div className="mb-24 lg:mb-32">
        <h2 className="my-16 sm:my-20 flex items-center text-3xl leading-[115%] md:text-5xl md:leading-[115%] font-semibold text-neutral-900 dark:text-neutral-100 justify-center">{t("customer.contact.page.contact")}</h2>
        <div className="container max-w-7xl mx-auto">
          <div className="flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-12 ">
            <div className="max-w-sm space-y-8">
              {info.map((item, index) => (
                <div key={index}>
                  <h3 className="uppercase font-semibold text-sm dark:text-neutral-200 tracking-wider">
                    <Tpl text={item.title} />
                  </h3>
                  <span className="block mt-2 text-neutral-500 dark:text-neutral-400">
                    <Tpl text={item.desc} />
                  </span>
                </div>
              ))}
              <div>
                <h3 className="uppercase font-semibold text-sm dark:text-neutral-200 tracking-wider">{t("customer.contact.page.socials")}</h3>
                <SocialsList className="mt-2" />
              </div>
            </div>
            <div>
              <form className="grid grid-cols-1 gap-6" action="#" method="post">
                <label className="block">
                  <Label>{t("customer.contact.page.fullName")}</Label>

                  <Input
                    placeholder={t("customer.contact.page.exampleDoe")}
                    type="text"
                    className="mt-1"
                  />
                </label>
                <label className="block">
                  <Label>{t("customer.contact.page.emailAddress")}</Label>

                  <Input
                    type="email"
                    placeholder={t("customer.contact.page.exampleExampleCom")}
                    className="mt-1"
                  />
                </label>
                <label className="block">
                  <Label>{t("customer.contact.page.message")}</Label>

                  <Textarea className="mt-1" rows={6} />
                </label>
                <div>
                  <ButtonPrimary type="submit">{t("customer.contact.page.sendMessage")}</ButtonPrimary>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* OTHER SECTIONS */}
      <div className="container">
        <SectionSubscribe2 className="pb-24 lg:pb-32" />
      </div>
    </div>
  );
}

export default PageContact;
