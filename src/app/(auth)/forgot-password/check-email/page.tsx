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
          If an account exists for that address, we&apos;ve sent a link to reset your
          password.
        </CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
