/** Feature switch names and labels (safe for client code; flags.ts
 * reads them on the server). */
export const FEATURE_FLAGS = [
  "form_archiving",
  "link_preview_seo",
  "api_free",
  "font_library",
  "email_templates",
  "checkout",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const FLAG_LABEL: Record<FeatureFlag, string> = {
  form_archiving: "Form archiving",
  link_preview_seo: "Link preview and SEO",
  api_free: "API on the Free plan",
  font_library: "Font library",
  email_templates: "Custom email templates",
  checkout: "Checkout (Stripe and Razorpay)",
};
