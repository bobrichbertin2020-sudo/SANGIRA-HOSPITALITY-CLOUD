"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { PublicBusiness } from "@/lib/public-businesses/types";
import { useT } from "@/lib/i18n/client";

type SearchState = {
  businesses: PublicBusiness[];
  error: string | null;
  loading: boolean;
};

export function BusinessSearch() {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({
    businesses: [],
    error: null,
    loading: false,
  });
  const active = query.trim().length >= 2;

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await fetch(
          `/api/public/businesses?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as {
          businesses?: PublicBusiness[];
          error?: string;
        };
        if (!response.ok) {
          setState({ businesses: [], error: result.error ?? "Search failed.", loading: false });
          return;
        }
        setState({ businesses: result.businesses ?? [], error: null, loading: false });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          businesses: [],
          error: "Search is temporarily unavailable. Please try again.",
          loading: false,
        });
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, query]);

  return (
    <div className="relative mx-auto mt-6 w-full max-w-2xl">
      <label className="sr-only" htmlFor="business-search">
        {t("Search hotels and restaurants")}
      </label>
      <input
        aria-autocomplete="list"
        aria-controls="business-search-results"
        aria-expanded={active}
        autoComplete="off"
        className="form-input w-full rounded-xl bg-white px-4 py-3 shadow-sm"
        id="business-search"
        onChange={(event) => {
          setQuery(event.target.value);
          setState({ businesses: [], error: null, loading: false });
        }}
        placeholder={t("Search hotels and restaurants by name")}
        role="combobox"
        value={query}
      />
      {active && (
        <div
          className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-[#e3e9e4] bg-white p-2 shadow-lg"
          id="business-search-results"
          role="listbox"
        >
          {state.loading && (
            <p className="px-3 py-2 text-sm text-[#64736a]" role="status">
              {t("Searching…")}
            </p>
          )}
          {state.error && (
            <p className="px-3 py-2 text-sm text-[#9c392d]" role="alert">
              {t(state.error)}
            </p>
          )}
          {!state.loading && !state.error && state.businesses.length === 0 && (
            <p className="px-3 py-2 text-sm text-[#64736a]">
              {t("No matching businesses found.")}
            </p>
          )}
          {state.businesses.map((business) => (
            <Link
              aria-label={t("Open {name}", { name: business.name })}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#f2f6f3] focus:bg-[#f2f6f3] focus:outline-none"
              href={`/business/${business.business_id}`}
              key={business.business_id}
              role="option"
            >
              {business.public_image_url ? (
                <Image
                  alt=""
                  className="h-10 w-10 rounded-lg object-cover"
                  height={40}
                  src={business.public_image_url}
                  unoptimized
                  width={40}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf6ef] text-sm font-bold text-[#153d32]"
                >
                  {business.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#17211c]">
                  {business.name}
                </span>
                <span className="block truncate text-xs capitalize text-[#64736a]">
                  {business.business_type.replaceAll("_", " ")} · {business.location}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
