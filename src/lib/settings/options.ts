export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export const languages = [
  { value: "en", label: "English" },
  { value: "sw", label: "Kiswahili" },
  { value: "fr", label: "Français" },
  { value: "rw", label: "Kinyarwanda" },
] as const;

export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];

export const THEME_COOKIE = "sgr_theme";
export const RECOVERY_COOKIE = "sgr_recovery";

export const roleLabels: Record<string, string> = {
  business_owner: "Business owner",
  hotel_manager: "Hotel manager",
  kitchen_manager: "Kitchen manager",
  kitchen_staff: "Kitchen staff",
  bar_manager: "Bar manager",
  bartender: "Bartender",
  stock_manager: "Stock manager",
  cashier: "Cashier",
  server: "Server",
  receptionist: "Receptionist",
  housekeeper: "Housekeeper",
};

export const usernamePattern = /^[a-z0-9_.]{3,30}$/;
export const phonePattern = /^\+?[0-9 ()-]{7,20}$/;
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MyProfile = {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  username: string | null;
  phone: string | null;
  address: string | null;
  language: string | null;
  theme: string | null;
  avatar_path: string | null;
  email_order_updates: boolean;
  email_stock_alerts: boolean;
  email_payment_alerts: boolean;
  inapp_order_updates: boolean;
  inapp_stock_alerts: boolean;
  inapp_payment_alerts: boolean;
};
