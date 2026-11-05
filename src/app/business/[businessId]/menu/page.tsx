import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { MenuForms } from "@/app/business/[businessId]/menu/forms";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type MenuPageProps = {
  params: Promise<{ businessId: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function MenuPage({ params }: MenuPageProps) {
  const { businessId } = await params;
  if (!uuidPattern.test(businessId)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const [
    { data: canView, error: viewError },
    { data: canManage, error: manageError },
    { data: business, error: businessError },
    { data: categories, error: categoriesError },
    { data: menuItems, error: menuItemsError },
    { data: stockItems, error: stockItemsError },
    { data: recipes, error: recipesError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "menu.view",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "menu.manage",
    }),
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    supabase
      .from("menu_categories")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("menu_items")
      .select("id, category_id, name, description, price, department_key")
      .eq("business_id", businessId)
      .eq("is_available", true)
      .order("name"),
    supabase
      .from("stock_items")
      .select("id, name, sku, unit")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("menu_recipes")
      .select("menu_item_id, stock_item_id, quantity")
      .eq("business_id", businessId),
    supabase
      .from("business_settings")
      .select("currency_code")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const permissionErrors = [viewError, manageError, businessError].filter(Boolean);
  if (permissionErrors.length) {
    console.error(
      "Menu access verification failed:",
      permissionErrors.map((error) => error?.message).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Menu access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }

  if (!business) {
    notFound();
  }
  if (!canView && !canManage) {
    redirect("/dashboard");
  }

  const dataErrors = [
    categoriesError,
    menuItemsError,
    canManage ? stockItemsError : null,
    canManage ? recipesError : null,
    settingsError,
  ].filter(Boolean);
  if (dataErrors.length) {
    console.error(
      "Menu workspace data could not be loaded:",
      dataErrors.map((error) => error?.message).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Menu data could not be loaded. Confirm the menu migration is deployed and refresh the page.
        </p>
      </main>
    );
  }

  const categoryMap = new Map(
    (categories ?? []).map((category) => [category.id, category.name]),
  );
  const stockItemMap = new Map(
    (stockItems ?? []).map((stockItem) => [stockItem.id, stockItem]),
  );
  const recipesByItem = new Map<
    string,
    Array<{
      stockItemId: string;
      stockItemName: string;
      unit: string;
      quantity: number;
    }>
  >();

  if (canManage) {
    for (const recipe of recipes ?? []) {
      const stockItem = stockItemMap.get(recipe.stock_item_id);
      if (!stockItem) {
        continue;
      }
      const itemRecipes = recipesByItem.get(recipe.menu_item_id) ?? [];
      itemRecipes.push({
        stockItemId: stockItem.id,
        stockItemName: stockItem.name,
        unit: stockItem.unit,
        quantity: Number(recipe.quantity),
      });
      recipesByItem.set(recipe.menu_item_id, itemRecipes);
    }
  }

  const items = (menuItems ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    departmentKey: item.department_key,
    categoryName: categoryMap.get(item.category_id) ?? "Uncategorized",
    ingredients: recipesByItem.get(item.id) ?? [],
  }));
  const activeCategories = (categories ?? []).map((category) => ({
    id: category.id,
    name: category.name,
  }));
  const activeStockItems = canManage
    ? (stockItems ?? []).map((stockItem) => ({
        id: stockItem.id,
        name: stockItem.name,
        sku: stockItem.sku,
        unit: stockItem.unit,
      }))
    : [];

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-3">
            <AccountLink />
            <form action={signOut}>
              <button className="rounded-lg border border-[#d6ded8] px-4 py-2 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <Link
          className="text-sm font-semibold text-[#153d32] hover:underline"
          href="/dashboard"
        >
          ← Dashboard
        </Link>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          {business.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Menu catalog</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          Organize categories, prices, and one-serving inventory recipes.
        </p>
        <div className="mt-8">
          <MenuForms
            businessId={businessId}
            canManage={Boolean(canManage)}
            categories={activeCategories}
            currencyCode={settings?.currency_code ?? "UGX"}
            items={items}
            stockItems={activeStockItems}
          />
        </div>
      </section>
    </main>
  );
}
