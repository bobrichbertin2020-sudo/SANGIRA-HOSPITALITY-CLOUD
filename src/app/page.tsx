import Link from "next/link";
import Image from "next/image";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";
import { getT } from "@/lib/i18n/server";
import { BusinessSearch } from "@/components/business-search";
import { searchPublicBusinesses } from "@/lib/public-businesses";
import type { PublicBusiness } from "@/lib/public-businesses/types";

export const instant = false;

const platformAreas = [
  {
    number: "01",
    title: "One workspace per business",
    description:
      "Keep each hotel, restaurant, bar, and lounge’s people and operations separated.",
  },
  {
    number: "02",
    title: "Clear department handoffs",
    description:
      "Connect stock, kitchen, bar, cashier, and service work through accountable workflows.",
  },
  {
    number: "03",
    title: "Operations you can audit",
    description:
      "Build around explicit permissions, traceable changes, and reliable business records.",
  },
];

export default async function Home() {
  const { t } = await getT();
  const { data: featuredData, error: featuredError } = await searchPublicBusinesses(null, 4);
  if (featuredError) {
    console.error("Featured businesses could not be loaded:", featuredError.message);
  }
  const featured = (featuredData ?? []) as PublicBusiness[];
  const isConfigured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <main className="min-h-screen bg-[#f7f8f6] text-[#17211c]">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Logo href="/" priority />
        <nav className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            className="rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#205443]"
            href="/sign-in"
          >
            {t("Sign in")}
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-7xl gap-12 px-6 pb-20 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:pb-28 lg:pt-20">
        <div>
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-[#a46f38]">
            {t("Hospitality, working in sync")}
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            {t("The calm behind a great guest experience.")}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#64736a]">
            {t("Sangira brings hotel and restaurant teams together across stock, kitchen, bar, service, and payments — with each business in its own secure workspace.")}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              className="rounded-lg bg-[#153d32] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#205443]"
              href="#discover"
            >
              {t("Explore hotels and restaurants")}
            </Link>
          </div>
          {!isConfigured && (
            <p className="mt-6 max-w-xl rounded-lg border border-[#ead7b9] bg-[#fff9ed] px-4 py-3 text-sm leading-6 text-[#765321]">
              {t("Setup needed: add your Supabase project URL and publishable key to .env.local and apply the database migration before enabling registration.")}
            </p>
          )}
        </div>

        <div className="relative">
          <div className="absolute -inset-5 rounded-[2rem] bg-[#e6ede7]" />
          <div className="relative mb-5 flex justify-center">
            <Logo size="seal" priority />
          </div>
          <div className="relative overflow-hidden rounded-[1.5rem] border border-[#dce5dd] bg-white p-6 shadow-[0_28px_70px_-45px_rgba(21,61,50,0.5)] sm:p-8">
            <div className="flex items-start justify-between border-b border-[#edf0ed] pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#85938a]">
                  {t("Sangira platform")}
                </p>
                <h2 className="mt-2 text-xl font-semibold">{t("Connected operations")}</h2>
              </div>
              <span className="rounded-full bg-[#edf6ef] px-3 py-1 text-xs font-semibold text-[#34714d]">
                {t("Multi-business")}
              </span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {["Management", "Kitchen", "Bar", "Stock", "Cashier", "Service"].map(
                (department, index) => (
                  <div
                    className="rounded-xl border border-[#edf0ed] bg-[#fbfcfb] p-4"
                    key={department}
                  >
                    <span className="text-xs font-semibold text-[#a46f38]">
                      0{index + 1}
                    </span>
                    <p className="mt-3 text-sm font-semibold">{t(department)}</p>
                  </div>
                ),
              )}
            </div>
            <div className="mt-4 rounded-xl bg-[#153d32] p-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#b8d2c3]">
                {t("Designed around the handoff")}
              </p>
              <p className="mt-2 text-lg font-medium leading-7">
                {t("The right task, with the right team, at the right moment.")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#e5e9e5] bg-white" id="discover">
        <div className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
              {t("Find your next experience")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              {t("Discover Hotels & Restaurants")}
            </h2>
            <p className="mt-2 text-sm text-[#64736a]">
              {t("Search a business to explore its own menu and offerings.")}
            </p>
            <BusinessSearch />
          </div>

          <div className="mt-12 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a46f38]">
                {t("A few places to start")}
              </p>
              <h3 className="mt-2 text-xl font-semibold">{t("Featured businesses")}</h3>
            </div>
          </div>
          {featuredError ? (
            <p className="mt-5 rounded-xl border border-[#ead7b9] bg-[#fff9ed] px-4 py-3 text-sm text-[#765321]">
              {t("Businesses could not be loaded right now. Please try search again shortly.")}
            </p>
          ) : featured.length ? (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((business) => (
                <li key={business.business_id}>
                  <Link
                    className="group block h-full overflow-hidden rounded-2xl border border-[#e3e9e4] bg-white transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#153d32]"
                    href={`/business/${business.business_id}`}
                  >
                    {business.public_image_url ? (
                      <Image
                        alt=""
                        className="h-36 w-full object-cover"
                        height={288}
                        src={business.public_image_url}
                        unoptimized
                        width={512}
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-36 items-center justify-center bg-[#edf6ef] text-5xl font-semibold text-[#153d32]"
                      >
                        {business.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">
                        {business.business_type.replaceAll("_", " ")}
                      </p>
                      <h4 className="mt-1 truncate text-base font-semibold group-hover:text-[#153d32]">
                        {business.name}
                      </h4>
                      <p className="mt-1 truncate text-sm text-[#64736a]">{business.location}</p>
                      {business.public_description && (
                        <p className="mt-3 line-clamp-2 text-sm leading-5 text-[#64736a]">
                          {business.public_description}
                        </p>
                      )}
                      <span className="mt-4 inline-block text-sm font-semibold text-[#153d32]">
                        {t("Explore business")} →
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-[#d6ded8] bg-[#fbfcfb] px-5 py-8 text-center text-sm text-[#64736a]">
              {t("No featured hotels or restaurants are available yet. Search again soon.")}
            </p>
          )}
        </div>
      </section>

      <section className="border-y border-[#e5e9e5] bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-12 md:grid-cols-3 lg:px-10 lg:py-16">
          {platformAreas.map((area) => (
            <article key={area.number}>
              <p className="text-sm font-bold text-[#a46f38]">{area.number}</p>
              <h2 className="mt-3 text-lg font-semibold">{t(area.title)}</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#64736a]">
                {t(area.description)}
              </p>
            </article>
          ))}
        </div>
      </section>
      <footer className="bg-[#153d32] text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-10 md:grid-cols-[1fr_auto] md:items-center lg:px-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b8d2c3]">
              {t("For Hotels & Restaurants")}
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {t("Are you a Hotel or Restaurant Owner?")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d3e2d8]">
              {t("Bring your hospitality business to Sangira. Register your hotel or restaurant, manage your operations and connect with customers through one platform.")}
            </p>
          </div>
          <Link
            className="inline-flex w-fit rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#153d32] transition hover:bg-[#edf6ef]"
            href="/business/apply"
          >
            {t("Register Your Business")}
          </Link>
          <div className="flex flex-col gap-2 border-t border-white/15 pt-5 text-xs text-[#d3e2d8] md:col-span-2 md:flex-row md:items-center md:justify-between">
            <p>Sangira Hospitality Cloud</p>
            <p>{t("Independent workspaces. Connected teams.")}</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
