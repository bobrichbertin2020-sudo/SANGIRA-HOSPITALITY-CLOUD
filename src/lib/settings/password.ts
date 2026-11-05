export const passwordRules = [
  { id: "length", label: "12 to 128 characters", test: (p: string) => p.length >= 12 && p.length <= 128 },
  { id: "lower", label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { id: "upper", label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { id: "number", label: "A number", test: (p: string) => /\d/.test(p) },
] as const;

export function passwordMeetsRules(password: string) {
  return passwordRules.every((rule) => rule.test(password));
}

export function passwordStrength(password: string) {
  if (!password) return { score: 0, label: "" };
  let score = passwordRules.filter((rule) => rule.test(password)).length - 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length >= 16) score += 1;
  score = Math.max(0, Math.min(4, score));
  return { score, label: ["Very weak", "Weak", "Fair", "Good", "Strong"][score] };
}
