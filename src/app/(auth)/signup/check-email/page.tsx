import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function CheckEmailPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We&apos;ve sent a verification link to your inbox. Click it to activate your
          account, then log in.
        </CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
