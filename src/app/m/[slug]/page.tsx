import { cookies } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { TABLE_COOKIE, verifySessionToken } from "@/lib/qr/session";
import { endTableSession, cancelCustomerOrder, sendServiceRequest } from "@/app/m/[slug]/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { CustomerOrderForm, StartSessionForm } from "@/app/m/[slug]/forms";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getT } from "@/lib/i18n/server";

export const instant = false;

type MenuPageProps = {
  params: Promise<{ slug: string }>;
};

type PublicMenu = {
  business_id: string;
  name: string;
  business_type: string;
  location: string;
  currency_code: string;
  ordering_enabled: boolean;
  public_description: string | null;
  public_image_url: string | null;
  tables: string[];
  categories: {
    id: string;
    name: string;
    description: string | null;
    items: {
      id: string;
      name: string;
      description: string | null;
      price: number;
      image_url: string | null;
    }[];
  }[];
};

type SessionOrder = {
  order_code: string;
  status: string;
  created_at: string;
  items: { name: string; quantity: number; unit_price: number; status: string }[];
};

const slugPattern = /^[a-z0-9][a-z0-9-]{0,80}$/;

export async function generateMetadata({ params }: MenuPageProps) {
  const { slug } = await params;
  return { title: `Menu · ${slug}`, robots: { index: false } };
}

export default async function PublicMenuPage({ params }: MenuPageProps) {
  const { slug } = await params;
  if (!slugPattern.test(slug)) {
    notFound();
  }
  const { t, locale } = await getT();
  const { url, key } = getSupabaseConfig();
  const publicClient = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: menuData, error } = await publicClient.rpc("public_menu", { p_slug: slug });
  if (error) {
    console.error("Public menu failed:", error.message);
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center text-sm text-[#64736a]">
        {t("The menu could not be loaded. Please try again shortly.")}
      </main>
    );
  }
  const menu = menuData as PublicMenu | null;
  if (!menu) {
    notFound();
  }

  const orderingAvailable = isAdminConfigured() && Boolean(process.env.ORDER_SESSION_SECRET);
  const admin = orderingAvailable ? createAdminClient() : null;
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(TABLE_COOKIE)?.value, slug);
  let orders: SessionOrder[] = [];
  let openRequests: string[] = [];
  let sessionActive = false;
  if (session && menu.ordering_enabled && admin) {
    const { data, error: ordersError } = await admin.rpc("customer_session_orders", {
      p_session_id: session.sessionId,
      p_nonce_hash: session.nonceHash,
    });
    if (!ordersError) {
      sessionActive = true;
      orders = (data as SessionOrder[]) ?? [];
      const { data: requestData } = await admin.rpc("customer_open_requests", {
        p_session_id: session.sessionId,
        p_nonce_hash: session.nonceHash,
      });
      openRequests = (requestData as string[]) ?? [];
    }
  }

  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: menu.currency_code,
  });
  const status = (value: string) => t(value.replaceAll("_", " "));

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <section className="mx-auto max-w-2xl px-5 py-10">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
            {menu.location}
          </p>
          <LanguageSwitcher />
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{menu.name}</h1>
        {menu.public_image_url && (
          <Image
            alt=""
            className="mt-4 max-h-64 w-full rounded-xl object-cover"
            height={512}
            src={menu.public_image_url}
            unoptimized
            width={1024}
          />
        )}
        {menu.public_description && (
          <p className="mt-3 text-sm leading-6 text-[#64736a]">{menu.public_description}</p>
        )}

        {!menu.ordering_enabled && (
          <p className="mt-4 rounded-lg bg-[#fff8e8] px-4 py-3 text-sm text-[#7a5a1d]">
            {t("Online ordering is currently turned off. Please ask a member of staff.")}
          </p>
        )}

        {menu.ordering_enabled && !orderingAvailable && (
          <p className="mt-4 rounded-lg bg-[#fff8e8] px-4 py-3 text-sm text-[#7a5a1d]">
            {t("Online ordering is not available right now.")}
          </p>
        )}

        {menu.ordering_enabled && orderingAvailable && !sessionActive && (
          <div className="mt-6 rounded-xl border border-[#e3e9e4] bg-white p-5">
            <h2 className="font-semibold">{t("Order from your table")}</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              {t("No account needed. Enter your table number to start.")}
            </p>
            <StartSessionForm slug={slug} tables={menu.tables} />
          </div>
        )}

        {menu.ordering_enabled && orderingAvailable && sessionActive && (
          <>
            <div className="mt-6 flex items-center justify-between rounded-xl border border-[#e3e9e4] bg-white px-5 py-3 text-sm">
              <span>{t("Ordering as a guest at your table.")}</span>
              <form action={endTableSession}>
                <input name="slug" type="hidden" value={slug} />
                <button className="font-semibold text-[#153d32] hover:underline">
                  {t("End session")}
                </button>
              </form>
            </div>
            <AutoRefresh />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  ["call_waiter", "Call a waiter"],
                  ["request_bill", "Request the bill"],
                ] as const
              ).map(([type, label]) => {
                const requested = openRequests.includes(type);
                return (
                  <form action={sendServiceRequest} key={type}>
                    <input name="slug" type="hidden" value={slug} />
                    <input name="type" type="hidden" value={type} />
                    <button
                      className="w-full rounded-xl border border-[#d6ded8] bg-white px-3 py-3 text-sm font-semibold text-[#153d32] hover:bg-[#f2f6f3] disabled:bg-[#e8f4ee] disabled:text-[#53635a]"
                      disabled={requested}
                    >
                      {requested ? t("Staff has been notified") : t(label)}
                    </button>
                  </form>
                );
              })}
            </div>
            {orders.length > 0 && (
              <section className="mt-6">
                <h2 className="font-semibold">{t("Your orders")}</h2>
                <ul className="mt-2 space-y-3">
                  {orders.map((order) => (
                    <li
                      key={order.order_code}
                      className="rounded-xl border border-[#e3e9e4] bg-white p-4 text-sm"
                    >
                      <div className="flex justify-between">
                        <span className="font-medium">{order.order_code}</span>
                        <span className="capitalize text-[#64736a]">{status(order.status)}</span>
                      </div>
                      <ul className="mt-2 space-y-1 text-[#29483c]">
                        {order.items.map((item, index) => (
                          <li key={`${item.name}-${index}`} className="flex justify-between">
                            <span>
                              {item.quantity} × {item.name}
                            </span>
                            <span className="capitalize text-[#64736a]">{status(item.status)}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between border-t border-[#eef2ef] pt-2">
                        <span className="font-medium">
                          {money.format(
                            order.items
                              .filter((item) => item.status !== "cancelled")
                              .reduce((sum, item) => sum + item.quantity * Number(item.unit_price), 0),
                          )}
                        </span>
                        {order.status === "submitted" &&
                          order.items.every((item) => item.status === "pending") && (
                            <form action={cancelCustomerOrder}>
                              <input name="slug" type="hidden" value={slug} />
                              <input name="orderCode" type="hidden" value={order.order_code} />
                              <button className="text-xs font-semibold text-[#9c392d] hover:underline">
                                {t("Cancel order")}
                              </button>
                            </form>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[#64736a]">
                  {t("Pay your server or the cashier. This page updates automatically.")}
                </p>
              </section>
            )}
          </>
        )}

        <section className="mt-8">
          <h2 className="font-semibold">{t("Menu")}</h2>
          {menu.categories.length === 0 && (
            <p className="mt-2 text-sm text-[#64736a]">{t("The menu has not been published yet.")}</p>
          )}
          {menu.ordering_enabled && orderingAvailable && sessionActive ? (
            <div className="mt-3">
              <CustomerOrderForm
                slug={slug}
                categories={menu.categories}
                currencyCode={menu.currency_code}
              />
            </div>
          ) : (
            menu.categories.map((category) => (
              <div key={category.id} className="mt-4">
                <h3 className="font-semibold">{category.name}</h3>
                <ul className="mt-2 divide-y divide-[#eef2ef] rounded-xl border border-[#e3e9e4] bg-white">
                  {category.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        {item.image_url && (
                          <Image
                            alt=""
                            className="h-14 w-14 rounded-lg object-cover"
                            height={56}
                            src={item.image_url}
                            unoptimized
                            width={56}
                          />
                        )}
                        <div>
                        <p className="font-medium">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-[#64736a]">{item.description}</p>
                        )}
                        </div>
                      </div>
                      <span>{money.format(Number(item.price))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
