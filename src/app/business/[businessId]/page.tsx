import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createPublicClient } from "@/lib/public-businesses";
import { getT } from "@/lib/i18n/server";

type PublicBusinessRouteProps = {
  params: Promise<{ businessId: string }>;
};

export const instant = false;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,80}$/;

export default async function PublicBusinessRoute({ params }: PublicBusinessRouteProps) {
  const { businessId } = await params;
  if (!uuidPattern.test(businessId)) {
    notFound();
  }

  const { t } = await getT();
  const { data, error } = await createPublicClient().rpc("public_business_by_id", {
    p_business_id: businessId,
  });
  if (error) {
    console.error("Public business lookup failed:", error.message);
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="text-xl font-semibold">{t("This business could not be loaded.")}</h1>
        <p className="mt-2 text-sm text-[#64736a]">{t("Please try again shortly.")}</p>
        <Link className="mt-5 inline-block font-semibold text-[#153d32] hover:underline" href="/">
          {t("Return to Sangira")}
        </Link>
      </main>
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    !("slug" in data) ||
    typeof data.slug !== "string" ||
    !slugPattern.test(data.slug)
  ) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="text-xl font-semibold">{t("This business is currently unavailable.")}</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          {t("It may no longer be accepting public visits.")}
        </p>
        <Link className="mt-5 inline-block font-semibold text-[#153d32] hover:underline" href="/">
          {t("Discover other businesses")}
        </Link>
      </main>
    );
  }

  redirect(`/m/${data.slug}`);
}
