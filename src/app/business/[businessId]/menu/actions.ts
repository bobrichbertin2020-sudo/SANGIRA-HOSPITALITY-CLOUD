"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type MenuActionState = {
  error?: string;
  success?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function menuPath(businessId: string) {
  return `/business/${encodeURIComponent(businessId)}/menu`;
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/sign-in");
  }

  return supabase;
}

export async function createMenuCategory(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (
    !uuidPattern.test(businessId) ||
    name.length < 2 ||
    name.length > 100 ||
    description.length > 500
  ) {
    return { error: "Enter a valid category name and description." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("create_menu_category", {
    p_business_id: businessId,
    p_name: name,
    p_description: description || null,
  });

  if (error) {
    console.error("Menu category creation failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "A category with this name already exists."
          : "The category could not be created. Check your menu permissions.",
    };
  }

  revalidatePath(menuPath(businessId));
  return { success: "Menu category created." };
}

export async function createMenuItem(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const rawPrice = String(formData.get("price") ?? "");
  const price = Number(rawPrice);

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(categoryId) ||
    name.length < 2 ||
    name.length > 160 ||
    description.length > 1000 ||
    imageUrl.length > 2048 ||
    (imageUrl !== "" && (!/^https:\/\//i.test(imageUrl) || /\s/.test(imageUrl))) ||
    !/^\d{1,12}(\.\d{1,2})?$/.test(rawPrice) ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    return { error: "Enter a valid menu item, category, and price." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("create_menu_item_with_image", {
    p_business_id: businessId,
    p_category_id: categoryId,
    p_name: name,
    p_description: description || null,
    p_price: price,
    p_image_url: imageUrl || null,
  });

  if (error) {
    console.error("Menu item creation failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "A menu item with this name already exists for the business."
          : "The menu item could not be created. Check the category and your permissions.",
    };
  }

  revalidatePath(menuPath(businessId));
  return { success: "Menu item added." };
}

export async function saveMenuRecipe(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const stockItemIds = formData.getAll("stockItemIds").map(String);
  const rawQuantities = formData.getAll("quantities").map(String);
  const clearRecipe = formData.get("clearRecipe") === "true";

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(menuItemId) ||
    stockItemIds.length !== rawQuantities.length ||
    stockItemIds.length > 50
  ) {
    return { error: "Review the recipe details and try again." };
  }

  const ingredients = [];
  for (let index = 0; !clearRecipe && index < stockItemIds.length; index += 1) {
    const stockItemId = stockItemIds[index];
    const rawQuantity = rawQuantities[index];
    if (!stockItemId && !rawQuantity) {
      continue;
    }

    const quantity = Number(rawQuantity);
    if (
      !uuidPattern.test(stockItemId) ||
      !/^\d{1,11}(\.\d{1,3})?$/.test(rawQuantity) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return {
        error: "Each recipe ingredient needs a stock item and positive quantity.",
      };
    }
    ingredients.push({ stock_item_id: stockItemId, quantity });
  }

  if (
    (!clearRecipe && !ingredients.length) ||
    new Set(ingredients.map((ingredient) => ingredient.stock_item_id)).size !==
      ingredients.length
  ) {
    return {
      error: "Add at least one unique stock item to the recipe.",
    };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("save_menu_recipe", {
    p_business_id: businessId,
    p_menu_item_id: menuItemId,
    p_ingredients: ingredients,
  });

  if (error) {
    console.error("Menu recipe save failed:", error.message);
    return {
      error:
        error.code === "22023"
          ? "Use active stock items from this business and valid quantities."
          : "The recipe could not be saved. Check your menu permissions and try again.",
    };
  }

  revalidatePath(menuPath(businessId));
  return { success: "Recipe ingredients saved." };
}
