import { MailCheck } from "lucide-react";
import { AuthCard, AuthFooter, AuthNotice } from "@/components/auth/auth-ui";

export default function CheckEmailPage() {
  return (
    <AuthCard
      icon={{ node: <MailCheck /> }}
      title="Check your inbox"
      subtitle="We sent a confirmation link to your email. Click it to activate your account, then come back here."
    >
      <AuthNotice tone="info">
        Nothing after a few minutes? Check your spam folder. The link works for 24 hours.
      </AuthNotice>
      <AuthFooter
        text="Wrong address?"
        link={{ href: "/login", label: "Back to log in" }}
      />
    </AuthCard>
  );
}
