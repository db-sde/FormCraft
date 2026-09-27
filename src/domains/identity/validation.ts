import { z } from "zod";

export const SignupInput = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email address").max(320),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});
export type SignupInput = z.infer<typeof SignupInput>;

export const LoginInput = z.object({
  email: z.string().trim().email("Enter a valid email address").max(320),
  password: z.string().min(1, "Password is required").max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ForgotPasswordInput = z.object({
  email: z.string().trim().email("Enter a valid email address").max(320),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;
