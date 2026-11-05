"use client";

import { useActionState } from "react";
import { setMenuItemDepartment } from "@/app/business/[businessId]/orders/actions";
import {
  createMenuCategory,
  createMenuItem,
  saveMenuRecipe,
  type MenuActionState,
} from "@/app/business/[businessId]/menu/actions";

type CategoryOption = {
  id: string;
  name: string;
};

type MenuItemOption = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  departmentKey: string;
  categoryName: string;
  ingredients: Array<{
    stockItemId: string;
    stockItemName: string;
    unit: string;
    quantity: number;
  }>;
};

type StockItemOption = {
  id: string;
  name: string;
  sku: string;
  unit: string;
};

const initialState: MenuActionState = {};
const inputClass = "form-input";
const buttonClass =
  "rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#205443] disabled:cursor-wait disabled:opacity-60";

function ActionMessage({ state }: { state: MenuActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mb-4 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="mb-4 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
        {state.success}
      </p>
    );
  }
  return null;
}

function CategoryForm({ businessId }: { businessId: string }) {
  const [state, formAction, pending] = useActionState(
    createMenuCategory,
    initialState,
  );

  return (
    <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6">
      <h2 className="text-lg font-semibold">Add a category</h2>
      <div className="mt-4">
        <ActionMessage state={state} />
      </div>
      <form action={formAction} className="mt-4 space-y-4">
        <input name="businessId" type="hidden" value={businessId} />
        <label className="block text-sm font-medium text-[#33463a]">
          Category name
          <input className={inputClass} maxLength={100} name="name" required />
        </label>
        <label className="block text-sm font-medium text-[#33463a]">
          Description (optional)
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            maxLength={500}
            name="description"
          />
        </label>
        <button className={buttonClass} disabled={pending}>
          {pending ? "Saving..." : "Add category"}
        </button>
      </form>
    </section>
  );
}

function MenuItemForm({
  businessId,
  categories,
  currencyCode,
}: {
  businessId: string;
  categories: CategoryOption[];
  currencyCode: string;
}) {
  const [state, formAction, pending] = useActionState(createMenuItem, initialState);

  return (
    <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6">
      <h2 className="text-lg font-semibold">Add a menu item</h2>
      {!categories.length ? (
        <p className="mt-3 text-sm text-[#64736a]">
          Create a category before adding menu items.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <ActionMessage state={state} />
          </div>
          <form action={formAction} className="mt-4 space-y-4">
            <input name="businessId" type="hidden" value={businessId} />
            <label className="block text-sm font-medium text-[#33463a]">
              Category
              <select
                className={inputClass}
                defaultValue=""
                name="categoryId"
                required
              >
                <option disabled value="">
                  Select a category
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-[#33463a]">
              Item name
              <input className={inputClass} maxLength={160} name="name" required />
            </label>
            <label className="block text-sm font-medium text-[#33463a]">
              Description (optional)
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                maxLength={1000}
                name="description"
              />
            </label>
            <label className="block text-sm font-medium text-[#33463a]">
              Image URL (optional, HTTPS)
              <input
                className={inputClass}
                maxLength={2048}
                name="imageUrl"
                placeholder="https://example.com/item.jpg"
                type="url"
              />
            </label>
            <label className="block text-sm font-medium text-[#33463a]">
              Price ({currencyCode})
              <input
                className={inputClass}
                min="0"
                name="price"
                required
                step="0.01"
                type="number"
              />
            </label>
            <button className={buttonClass} disabled={pending}>
              {pending ? "Saving..." : "Add menu item"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function RecipeForm({
  businessId,
  item,
  stockItems,
}: {
  businessId: string;
  item: MenuItemOption;
  stockItems: StockItemOption[];
}) {
  const [state, formAction, pending] = useActionState(saveMenuRecipe, initialState);
  const rowCount = Math.max(5, item.ingredients.length);

  return (
    <details className="rounded-xl border border-[#e3e9e4] bg-white p-4">
      <summary className="cursor-pointer font-semibold">
        Recipe for {item.name}
      </summary>
      <div className="mt-4">
        {item.ingredients.length ? (
          <ul className="mb-4 space-y-1 text-sm text-[#64736a]">
            {item.ingredients.map((ingredient) => (
              <li key={ingredient.stockItemId}>
                {ingredient.quantity} {ingredient.unit} · {ingredient.stockItemName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-[#64736a]">
            No recipe is configured. Recipe quantities use each stock item&apos;s unit.
          </p>
        )}
        <ActionMessage state={state} />
        {!stockItems.length ? (
          <p className="text-sm text-[#64736a]">
            Add active products to inventory before configuring recipe ingredients.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <input name="businessId" type="hidden" value={businessId} />
            <input name="menuItemId" type="hidden" value={item.id} />
            <div className="space-y-3">
              {Array.from({ length: rowCount }, (_, index) => {
                const ingredient = item.ingredients[index];
                return (
                  <div
                    className="grid gap-3 sm:grid-cols-[1fr_9rem]"
                    key={`${item.id}-${index}`}
                  >
                    <label className="sr-only" htmlFor={`${item.id}-stock-${index}`}>
                      Ingredient {index + 1}
                    </label>
                    <select
                      className={inputClass}
                      defaultValue={ingredient?.stockItemId ?? ""}
                      id={`${item.id}-stock-${index}`}
                      name="stockItemIds"
                    >
                      <option value="">Select a stock item</option>
                      {stockItems.map((stockItem) => (
                        <option key={stockItem.id} value={stockItem.id}>
                          {stockItem.name} · {stockItem.sku} ({stockItem.unit})
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor={`${item.id}-quantity-${index}`}>
                      Ingredient quantity {index + 1}
                    </label>
                    <input
                      className={inputClass}
                      defaultValue={ingredient?.quantity ?? ""}
                      id={`${item.id}-quantity-${index}`}
                      min="0"
                      name="quantities"
                      placeholder="Quantity"
                      step="0.001"
                      type="number"
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-xs leading-5 text-[#64736a]">
              Saving replaces this recipe. Use one row per stock item; quantities
              are for one serving.
            </p>
            <div className="flex flex-wrap gap-3">
              <button className={buttonClass} disabled={pending}>
                {pending ? "Saving recipe..." : "Save recipe"}
              </button>
              {item.ingredients.length > 0 && (
                <button
                  className="rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6] disabled:opacity-60"
                  disabled={pending}
                  name="clearRecipe"
                  onClick={(event) => {
                    if (!window.confirm("Remove all ingredients from this recipe?")) {
                      event.preventDefault();
                    }
                  }}
                  type="submit"
                  value="true"
                >
                  Clear recipe
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

export function MenuForms({
  businessId,
  categories,
  items,
  stockItems,
  canManage,
  currencyCode,
}: {
  businessId: string;
  categories: CategoryOption[];
  items: MenuItemOption[];
  stockItems: StockItemOption[];
  canManage: boolean;
  currencyCode: string;
}) {
  return (
    <div className="space-y-8">
      {canManage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <CategoryForm businessId={businessId} />
          <MenuItemForm
            businessId={businessId}
            categories={categories}
            currencyCode={currencyCode}
          />
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold">Menu items</h2>
        {items.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <article
                className="rounded-2xl border border-[#e3e9e4] bg-white p-5"
                key={item.id}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-[#a46f38]">
                  {item.categoryName}
                </p>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <h3 className="font-semibold">{item.name}</h3>
                  <span className="shrink-0 text-sm font-semibold">
                    {new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: currencyCode,
                    }).format(item.price)}
                  </span>
                </div>
                {item.description && (
                  <p className="mt-2 text-sm leading-6 text-[#64736a]">
                    {item.description}
                  </p>
                )}
                {canManage ? (
                  <form action={setMenuItemDepartment} className="mt-3 flex items-center gap-2">
                    <input name="businessId" type="hidden" value={businessId} />
                    <input name="menuItemId" type="hidden" value={item.id} />
                    <select
                      aria-label={`Preparation department for ${item.name}`}
                      className="form-input !mt-0 w-32"
                      defaultValue={item.departmentKey}
                      name="departmentKey"
                    >
                      <option value="kitchen">Kitchen</option>
                      <option value="bar">Bar</option>
                    </select>
                    <button className="rounded-lg border border-[#d6ded8] px-3 py-2 text-xs font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                      Save routing
                    </button>
                  </form>
                ) : (
                  <p className="mt-2 text-xs capitalize text-[#64736a]">
                    Prepared by {item.departmentKey}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-[#d6ded8] px-5 py-8 text-center text-sm text-[#64736a]">
            No menu items yet.
          </p>
        )}
      </section>

      {canManage && (
        <section>
          <h2 className="text-lg font-semibold">Recipe configuration</h2>
          <p className="mt-1 text-sm text-[#64736a]">
            Recipes map one serving to inventory quantities. Automatic stock
            consumption will be connected to order fulfilment in a later phase.
          </p>
          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <RecipeForm
                businessId={businessId}
                item={item}
                key={item.id}
                stockItems={stockItems}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
