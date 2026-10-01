import type { Metadata } from "next";
import { Send } from "lucide-react";
import { AuthCard, AuthFooter } from "@/components/auth/auth-ui";

export const metadata: Metadata = { title: "Check your inbox" };

export default function CheckEmailPage() {
  return (
    <AuthCard
      icon={{ node: <Send /> }}
      title="Check your email"
      subtitle="If an account exists for that address, we've sent a link to reset your password. It expires in 1 hour."
    >
      <AuthFooter text="Back to" link={{ href: "/login", label: "Log in" }} />
    </AuthCard>
  );
}
