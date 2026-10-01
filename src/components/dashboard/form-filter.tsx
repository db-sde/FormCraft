"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

/** Narrows a list to one form via `?form=<id>`, keeping any other
 * filters (like a search) and starting back on the first page. */
export function FormFilter({
  forms,
  value,
}: {
  forms: { id: string; title: string }[];
  value?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("page");
        if (next === ALL) params.delete("form");
        else params.set("form", next);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    >
      <SelectTrigger className="w-full sm:w-64" aria-label="Filter by form">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All forms</SelectItem>
        {forms.map((form) => (
          <SelectItem key={form.id} value={form.id}>
            {form.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
